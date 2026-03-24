import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import { runEval, readEvalFile, type EvalResult } from "./harness.js";

// Load .env from repo root
const __dirname = fileURLToPath(new URL(".", import.meta.url));
config({ path: resolve(__dirname, "../../../.env") });

const API_KEY = process.env.ANTHROPIC_API_KEY;

function assertSessionCompleted(result: EvalResult) {
  expect(result.sessionComplete).not.toBeNull();
  expect(result.sessionComplete?.status).toBe("completed");
  expect(result.errorMessage).toBeNull();
}

function assertUsedTool(result: EvalResult, toolName: string) {
  const used = result.toolCalls.some((tc) => tc.name === toolName);
  expect(used, `Expected agent to use tool "${toolName}"`).toBe(true);
}

async function withEval(
  run: () => Promise<EvalResult>,
  assertions: (result: EvalResult) => Promise<void>
): Promise<void> {
  let result: EvalResult | null = null;
  try {
    result = await run();
    await assertions(result);
  } finally {
    if (result?.cleanup) await result.cleanup();
  }
}

const skipIfNoApiKey = !API_KEY
  ? "ANTHROPIC_API_KEY not set - skipping edge case evals"
  : undefined;

describe("Edge case evals", { skip: skipIfNoApiKey }, () => {
  // -----------------------------------------------------------------------
  // EC-1: Large file handling
  // -----------------------------------------------------------------------
  it("EC-1: Handles reading a large file gracefully", async () => {
    // Create a file just over 1MB to trigger the size limit
    const largeContent = "x".repeat(1024 * 1024 + 100);

    await withEval(
      () =>
        runEval({
          prompt:
            "Read the file large.txt and tell me what's in it. If you can't read it, explain why and suggest an alternative approach.",
          apiKey: API_KEY!,
          setupFiles: {
            "large.txt": largeContent,
          },
        }),
      async (result) => {
        assertSessionCompleted(result);
        // Agent should have attempted read_file
        assertUsedTool(result, "read_file");
        // Should mention the file is too large or provide an alternative
        const allText =
          result.textOutput +
          result.toolResults.map((r) => r.output).join(" ");
        expect(allText.toLowerCase()).toMatch(
          /too large|size|head|tail|alternative|portion/
        );
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-2: Binary file detection
  // -----------------------------------------------------------------------
  it("EC-2: Handles binary file read attempt gracefully", async () => {
    // Create a binary-looking file (PNG header)
    const binaryContent = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x48, 0x44, 0x52,
    ]).toString("latin1");

    await withEval(
      () =>
        runEval({
          prompt:
            "Read the file image.png and tell me about it. If it can't be read as text, explain why.",
          apiKey: API_KEY!,
          setupFiles: {
            "image.png": binaryContent,
          },
        }),
      async (result) => {
        assertSessionCompleted(result);
        // Should mention it's binary
        const allText =
          result.textOutput +
          result.toolResults.map((r) => r.output).join(" ");
        expect(allText.toLowerCase()).toMatch(/binary|cannot|can't/);
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-3: Path traversal attempt (agent should be blocked)
  // -----------------------------------------------------------------------
  it("EC-3: Blocks path traversal when agent tries to read outside workspace", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Try to read the file at path ../../../etc/hostname and tell me its contents. If access is denied, explain what happened.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        // The tool result should show an access denied error
        const toolErrors = result.toolResults.filter((r) => r.isError);
        const allOutput = result.toolResults
          .map((r) => r.output)
          .join(" ");
        // Either the agent got an access denied error OR it recognized
        // the path is outside workspace
        expect(
          toolErrors.length > 0 ||
            result.textOutput.toLowerCase().includes("denied") ||
            result.textOutput.toLowerCase().includes("outside") ||
            allOutput.toLowerCase().includes("denied") ||
            allOutput.toLowerCase().includes("outside")
        ).toBe(true);
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-4: Command timeout handling
  // -----------------------------------------------------------------------
  it("EC-4: Handles command timeout and recovers", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Run the command 'sleep 60' with a timeout of 2 seconds. When it times out, explain what happened and then create a file called done.txt with 'completed' in it.",
          apiKey: API_KEY!,
          timeoutMs: 120_000,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "execute_command");
        // Should have a timeout error in tool results
        const timeoutResult = result.toolResults.find(
          (r) => r.isError && r.output.toLowerCase().includes("timed out")
        );
        expect(timeoutResult).toBeDefined();
        // Should have recovered and created the file
        const content = await readEvalFile(result, "done.txt");
        expect(content.toLowerCase()).toContain("completed");
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-5: Non-existent file error recovery
  // -----------------------------------------------------------------------
  it("EC-5: Recovers from reading non-existent file", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Try to read the file missing.txt. If it doesn't exist, create it with the content 'Created because it was missing'.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "read_file");
        assertUsedTool(result, "write_file");
        // Should have an error from the read attempt
        const readError = result.toolResults.find((r) => r.isError);
        expect(readError).toBeDefined();
        // Should have created the file
        const content = await readEvalFile(result, "missing.txt");
        expect(content).toContain("missing");
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-6: Large directory listing
  // -----------------------------------------------------------------------
  it("EC-6: Handles listing a directory with many files", async () => {
    // Create 50 files (not 1000+ to avoid slow test setup, but enough
    // to verify the agent handles a non-trivial listing)
    const setupFiles: Record<string, string> = {};
    for (let i = 0; i < 50; i++) {
      setupFiles[`file_${String(i).padStart(3, "0")}.txt`] = `content ${i}`;
    }

    await withEval(
      () =>
        runEval({
          prompt:
            "List the current directory and tell me how many files there are.",
          apiKey: API_KEY!,
          setupFiles,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "list_directory");
        // Should mention the count
        expect(result.textOutput).toMatch(/50|fifty/i);
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-7: Multi-step task with error recovery
  // -----------------------------------------------------------------------
  it("EC-7: Handles multi-step task with intermediate errors", async () => {
    await withEval(
      () =>
        runEval({
          prompt: `Do these steps in order:
1. Try to read config.json (it doesn't exist, so this will fail)
2. Create config.json with {"version": 1}
3. Read config.json to verify it was created
4. Create result.txt with "All steps completed successfully"`,
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        // Should have errors from first read attempt
        const readErrors = result.toolResults.filter((r) => r.isError);
        expect(readErrors.length).toBeGreaterThan(0);
        // Should have created both files
        const config = await readEvalFile(result, "config.json");
        expect(JSON.parse(config).version).toBe(1);
        const resultFile = await readEvalFile(result, "result.txt");
        expect(resultFile.toLowerCase()).toContain("completed");
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-8: Command with large output
  // -----------------------------------------------------------------------
  it("EC-8: Handles command with large stdout gracefully", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Run a command that generates a lot of output: 'seq 1 10000'. Then create a file called summary.txt saying how many lines of output the command produced.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "execute_command");
        assertUsedTool(result, "write_file");
        const summary = await readEvalFile(result, "summary.txt");
        expect(summary).toMatch(/10.?000|ten thousand/i);
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-9: Empty prompt edge (minimal prompt)
  // -----------------------------------------------------------------------
  it("EC-9: Handles a very short, vague prompt", async () => {
    await withEval(
      () =>
        runEval({
          prompt: "Create a file.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        // Agent should create some file even with vague instructions
        assertUsedTool(result, "write_file");
      }
    );
  });

  // -----------------------------------------------------------------------
  // EC-10: Concurrent file operations
  // -----------------------------------------------------------------------
  it("EC-10: Handles creating and then immediately reading same file", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a file called verify.txt with the content 'checksum: abc123'. Then immediately read it back and confirm the content matches.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "write_file");
        assertUsedTool(result, "read_file");
        const content = await readEvalFile(result, "verify.txt");
        expect(content).toContain("abc123");
        // Agent should confirm the content matched
        expect(result.textOutput.toLowerCase()).toMatch(
          /match|confirm|correct|verified|same/
        );
      }
    );
  });
});

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

/** Runs eval, runs assertions, then cleans up. Use readEvalFile inside assertions. */
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
  ? "ANTHROPIC_API_KEY not set - skipping golden path evals"
  : undefined;

describe("Golden path evals", { skip: skipIfNoApiKey }, () => {
  it("1. Creates a simple text file when asked", async () => {
    await withEval(
      () =>
        runEval({
          prompt: "Create a file called hello.txt with the content 'Hello, World!'",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "write_file");
        const content = await readEvalFile(result, "hello.txt");
        expect(content).toContain("Hello");
        expect(content).toContain("World");
      }
    );
  });

  it("2. Lists directory and explores workspace structure", async () => {
    await withEval(
      () =>
        runEval({
          prompt: "List the current directory and tell me what files are in it.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "list_directory");
        expect(result.textOutput.length).toBeGreaterThan(0);
      }
    );
  });

  it("3. Reads an existing file and reports its contents", async () => {
    await withEval(
      () =>
        runEval({
          prompt: "Read the file secret.txt and tell me what it says.",
          apiKey: API_KEY!,
          setupFiles: {
            "secret.txt": "The secret number is 42.",
          },
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "read_file");
        expect(result.textOutput.toLowerCase()).toMatch(/42|secret/);
      }
    );
  });

  it("4. Creates a README file in a new directory", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a directory called my-project and inside it create a README.md file that says 'Welcome to my project'.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, "my-project/README.md");
        expect(content.toLowerCase()).toMatch(/welcome|project/);
      }
    );
  });

  it("5. Runs a simple shell command and reports output", async () => {
    await withEval(
      () =>
        runEval({
          prompt: "Run the command 'echo Hello from shell' and tell me the output.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "execute_command");
        const output =
          result.textOutput.toLowerCase() +
          result.toolResults.map((r) => r.output).join(" ");
        expect(output).toMatch(/hello from shell/);
      }
    );
  });

  it("6. Creates a Python script and optionally runs it", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a Python file called add.py that defines a function add(a, b) returning a+b. Then run it with python to verify it works.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "write_file");
        const content = await readEvalFile(result, "add.py");
        expect(content).toMatch(/def add/);
        expect(content).toMatch(/return|a \+ b|\+ b/);
      }
    );
  });

  it("7. Creates package.json with expected structure", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a package.json file with name 'test-app', version '1.0.0', and a scripts section with a 'start' script.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, "package.json");
        const parsed = JSON.parse(content);
        expect(parsed.name).toBe("test-app");
        expect(parsed.version).toBe("1.0.0");
        expect(parsed.scripts).toBeDefined();
        expect(parsed.scripts.start).toBeDefined();
      }
    );
  });

  it("8. Modifies an existing file", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "The file config.json has a single key 'debug' set to false. Change it to true.",
          apiKey: API_KEY!,
          setupFiles: {
            "config.json": '{"debug": false}',
          },
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "read_file");
        assertUsedTool(result, "write_file");
        const content = await readEvalFile(result, "config.json");
        const parsed = JSON.parse(content);
        expect(parsed.debug).toBe(true);
      }
    );
  });

  it("9. Creates a multi-file structure", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a src/index.js file that console.logs 'Hello' and a src/utils.js that exports a greet function.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const indexContent = await readEvalFile(result, "src/index.js");
        const utilsContent = await readEvalFile(result, "src/utils.js");
        expect(indexContent).toMatch(/console\.log/);
        expect(utilsContent).toMatch(/function greet|const greet|greet\s*=/);
        expect(utilsContent).toMatch(/export|module\.exports/);
      }
    );
  });

  it("10. Handles nested directory creation", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create the file deep/nested/path/file.txt with content 'Success'.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(
          result,
          "deep/nested/path/file.txt"
        );
        expect(content).toContain("Success");
      }
    );
  });

  it("11. Runs node/javascript and reports result", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a file script.js that prints 'Node works' with console.log, then run it with node.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "execute_command");
        const content = await readEvalFile(result, "script.js");
        expect(content).toMatch(/Node works|node works/);
      }
    );
  });

  it("12. Creates a TypeScript-like file with types", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a file types.ts that exports an interface User with id: number and name: string.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, "types.ts");
        expect(content).toMatch(/interface User|type User/);
        expect(content).toMatch(/id.*number|number.*id/);
        expect(content).toMatch(/name.*string|string.*name/);
      }
    );
  });

  it("13. Adds content to a file (appends or modifies)", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "The file log.txt contains 'Line 1'. Add 'Line 2' to it so it has both lines.",
          apiKey: API_KEY!,
          setupFiles: {
            "log.txt": "Line 1\n",
          },
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, "log.txt");
        expect(content).toContain("Line 1");
        expect(content).toContain("Line 2");
      }
    );
  });

  it("14. Creates an HTML file with basic structure", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create an index.html file with a proper HTML5 structure, a title 'My Page', and a body containing an h1 that says 'Welcome'.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, "index.html");
        expect(content.toLowerCase()).toMatch(/<!doctype|<html|html5/);
        expect(content).toMatch(/My Page|my page/);
        expect(content).toMatch(/<h1|Welcome|welcome/);
      }
    );
  });

  it("15. Uses list_directory before acting", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a new file called notes.md. First list the directory to see what's there, then create the file.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        assertUsedTool(result, "list_directory");
        assertUsedTool(result, "write_file");
        const content = await readEvalFile(result, "notes.md");
        expect(content.length).toBeGreaterThanOrEqual(0);
      }
    );
  });

  it("16. Creates a .env.example with placeholder vars", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a .env.example file with API_KEY=your_key_here and DATABASE_URL=your_url_here",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, ".env.example");
        expect(content).toMatch(/API_KEY/);
        expect(content).toMatch(/DATABASE_URL/);
      }
    );
  });

  it("17. Handles a combined read-modify-write workflow", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Read data.json, add a new key 'updated' with value true, and save it back.",
          apiKey: API_KEY!,
          setupFiles: {
            "data.json": '{"existing": "value"}',
          },
        }),
      async (result) => {
        assertSessionCompleted(result);
        const content = await readEvalFile(result, "data.json");
        const parsed = JSON.parse(content);
        expect(parsed.updated).toBe(true);
        expect(parsed.existing).toBe("value");
      }
    );
  });

  it("18. Explains what it is doing in text output", async () => {
    await withEval(
      () =>
        runEval({
          prompt:
            "Create a file called intro.txt with 'Hello'. Before and after creating it, briefly explain what you're doing.",
          apiKey: API_KEY!,
        }),
      async (result) => {
        assertSessionCompleted(result);
        expect(result.textOutput.length).toBeGreaterThan(20);
        const content = await readEvalFile(result, "intro.txt");
        expect(content).toContain("Hello");
      }
    );
  });
});

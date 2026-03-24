import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  executeTool,
  safePath,
  looksLikeBinary,
  MAX_READ_FILE_SIZE,
  MAX_DIR_ENTRIES,
} from "../tools/executor.js";

let workingDir: string;

beforeEach(async () => {
  workingDir = await mkdtemp(join(tmpdir(), "executor-test-"));
});

afterEach(async () => {
  await rm(workingDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// safePath
// ---------------------------------------------------------------------------

describe("safePath", () => {
  it("resolves relative paths within working dir", () => {
    const result = safePath(workingDir, "foo/bar.txt");
    expect(result).toBe(join(workingDir, "foo/bar.txt"));
  });

  it("rejects path traversal with ../", () => {
    expect(() => safePath(workingDir, "../../../etc/passwd")).toThrow(
      "Access denied"
    );
  });

  it("rejects absolute paths outside working dir", () => {
    expect(() => safePath(workingDir, "/etc/passwd")).toThrow(
      "Access denied"
    );
  });

  it("allows nested paths within working dir", () => {
    const result = safePath(workingDir, "a/b/c/d.txt");
    expect(result.startsWith(workingDir)).toBe(true);
  });

  it("rejects tricky traversal like foo/../../..", () => {
    expect(() =>
      safePath(workingDir, "foo/../../../etc/passwd")
    ).toThrow("Access denied");
  });
});

// ---------------------------------------------------------------------------
// looksLikeBinary
// ---------------------------------------------------------------------------

describe("looksLikeBinary", () => {
  it("returns false for text content", () => {
    const buffer = Buffer.from("Hello, world!\nThis is text.");
    expect(looksLikeBinary(buffer)).toBe(false);
  });

  it("returns true for binary content with null bytes", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]);
    expect(looksLikeBinary(buffer)).toBe(true);
  });

  it("returns false for empty buffer", () => {
    const buffer = Buffer.alloc(0);
    expect(looksLikeBinary(buffer)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeTool: read_file
// ---------------------------------------------------------------------------

describe("executeTool - read_file", () => {
  it("reads a normal file", async () => {
    await writeFile(join(workingDir, "test.txt"), "hello", "utf-8");
    const result = await executeTool(
      "read_file",
      { path: "test.txt" },
      workingDir
    );
    expect(result.isError).toBe(false);
    expect(result.output).toBe("hello");
  });

  it("rejects path traversal", async () => {
    const result = await executeTool(
      "read_file",
      { path: "../../../etc/passwd" },
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Access denied");
  });

  it("rejects files larger than MAX_READ_FILE_SIZE", async () => {
    const bigContent = "x".repeat(MAX_READ_FILE_SIZE + 100);
    await writeFile(join(workingDir, "big.txt"), bigContent, "utf-8");
    const result = await executeTool(
      "read_file",
      { path: "big.txt" },
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("too large");
  });

  it("rejects binary files", async () => {
    const binaryContent = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    await writeFile(join(workingDir, "image.png"), binaryContent);
    const result = await executeTool(
      "read_file",
      { path: "image.png" },
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("binary");
  });

  it("returns error for non-existent file", async () => {
    const result = await executeTool(
      "read_file",
      { path: "nonexistent.txt" },
      workingDir
    );
    expect(result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// executeTool: write_file
// ---------------------------------------------------------------------------

describe("executeTool - write_file", () => {
  it("writes a file successfully", async () => {
    const result = await executeTool(
      "write_file",
      { path: "output.txt", content: "test content" },
      workingDir
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("File written");
  });

  it("creates parent directories", async () => {
    const result = await executeTool(
      "write_file",
      { path: "deep/nested/file.txt", content: "nested" },
      workingDir
    );
    expect(result.isError).toBe(false);
  });

  it("rejects path traversal on write", async () => {
    const result = await executeTool(
      "write_file",
      { path: "../../../tmp/evil.txt", content: "bad" },
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Access denied");
  });
});

// ---------------------------------------------------------------------------
// executeTool: execute_command
// ---------------------------------------------------------------------------

describe("executeTool - execute_command", () => {
  it("executes a simple command", async () => {
    const result = await executeTool(
      "execute_command",
      { command: "echo hello" },
      workingDir
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("hello");
  });

  it("reports non-zero exit codes", async () => {
    const result = await executeTool(
      "execute_command",
      { command: "exit 1" },
      workingDir
    );
    expect(result.isError).toBe(true);
  });

  it("times out long-running commands", async () => {
    const result = await executeTool(
      "execute_command",
      { command: "sleep 60", timeout: 500 },
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("timed out");
  }, 10_000);

  it("truncates very large output", async () => {
    // Generate output larger than truncation limit
    const result = await executeTool(
      "execute_command",
      {
        command:
          'python3 -c "print(\\"x\\" * 200000)" 2>/dev/null || echo "x"',
      },
      workingDir
    );
    // The output should either be truncated or just "x" if python3 isn't available
    expect(result.output.length).toBeLessThan(200_000);
  });
});

// ---------------------------------------------------------------------------
// executeTool: list_directory
// ---------------------------------------------------------------------------

describe("executeTool - list_directory", () => {
  it("lists files in a directory", async () => {
    await writeFile(join(workingDir, "a.txt"), "a", "utf-8");
    await writeFile(join(workingDir, "b.txt"), "b", "utf-8");
    const result = await executeTool(
      "list_directory",
      { path: "." },
      workingDir
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("a.txt");
    expect(result.output).toContain("b.txt");
  });

  it("marks directories with trailing /", async () => {
    await mkdir(join(workingDir, "subdir"));
    const result = await executeTool(
      "list_directory",
      { path: "." },
      workingDir
    );
    expect(result.output).toContain("subdir/");
  });

  it("rejects path traversal on list", async () => {
    const result = await executeTool(
      "list_directory",
      { path: "../../../" },
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Access denied");
  });

  it("handles large directories with truncation notice", async () => {
    // Create MAX_DIR_ENTRIES + 10 files
    const count = MAX_DIR_ENTRIES + 10;
    const promises = [];
    for (let i = 0; i < count; i++) {
      promises.push(
        writeFile(join(workingDir, `file_${String(i).padStart(5, "0")}.txt`), "", "utf-8")
      );
    }
    await Promise.all(promises);

    const result = await executeTool(
      "list_directory",
      { path: "." },
      workingDir
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("more entries");
    expect(result.output).toContain(`${count} total`);
  });
});

// ---------------------------------------------------------------------------
// executeTool: unknown tool
// ---------------------------------------------------------------------------

describe("executeTool - unknown tool", () => {
  it("returns error for unknown tool name", async () => {
    const result = await executeTool(
      "nonexistent_tool",
      {},
      workingDir
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Unknown tool");
  });
});

import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { exec } from "child_process";
import { resolve, dirname, relative } from "path";
import { truncateToolResult } from "../context-window.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum file size we will read (1 MB). Larger files are rejected. */
export const MAX_READ_FILE_SIZE = 1024 * 1024; // 1 MB

/** Maximum entries returned by list_directory. */
export const MAX_DIR_ENTRIES = 1000;

/** Maximum command output buffer (10 MB). */
export const MAX_COMMAND_BUFFER = 1024 * 1024 * 10;

/** Default command timeout (30 seconds). */
export const DEFAULT_COMMAND_TIMEOUT = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolResult {
  output: string;
  isError: boolean;
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Resolve a path relative to workingDir and verify it does not escape
 * the sandbox.  Returns the resolved absolute path or throws.
 */
export function safePath(workingDir: string, filePath: string): string {
  const resolved = resolve(workingDir, filePath);
  const rel = relative(workingDir, resolved);

  // If the relative path starts with ".." the target is outside the sandbox
  if (rel.startsWith("..") || resolve(workingDir, rel) !== resolved) {
    throw new Error(
      `Path "${filePath}" resolves outside the working directory. Access denied.`
    );
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Binary detection
// ---------------------------------------------------------------------------

/** Quick heuristic: if the first 8 KB contain a null byte, it's binary. */
export function looksLikeBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  workingDir: string
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "read_file":
        return await readFileTool(input.path as string, workingDir);
      case "write_file":
        return await writeFileTool(
          input.path as string,
          input.content as string,
          workingDir
        );
      case "execute_command":
        return await executeCommandTool(
          input.command as string,
          workingDir,
          (input.timeout as number) || DEFAULT_COMMAND_TIMEOUT
        );
      case "list_directory":
        return await listDirectoryTool(
          (input.path as string) || ".",
          workingDir
        );
      default:
        return { output: `Unknown tool: ${toolName}`, isError: true };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { output: message, isError: true };
  }
}

async function readFileTool(
  path: string,
  workingDir: string
): Promise<ToolResult> {
  const fullPath = safePath(workingDir, path);

  // Check file size before reading
  const fileStat = await stat(fullPath);
  if (fileStat.size > MAX_READ_FILE_SIZE) {
    return {
      output: `File is too large (${(fileStat.size / 1024 / 1024).toFixed(1)} MB, max ${MAX_READ_FILE_SIZE / 1024 / 1024} MB). Use execute_command with head/tail to read portions.`,
      isError: true,
    };
  }

  // Read as buffer first to check for binary
  const buffer = await readFile(fullPath);
  if (looksLikeBinary(buffer)) {
    return {
      output: `File "${path}" appears to be a binary file and cannot be displayed as text.`,
      isError: true,
    };
  }

  const content = buffer.toString("utf-8");
  return { output: truncateToolResult(content), isError: false };
}

async function writeFileTool(
  path: string,
  content: string,
  workingDir: string
): Promise<ToolResult> {
  const fullPath = safePath(workingDir, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf-8");
  return { output: `File written: ${path}`, isError: false };
}

async function executeCommandTool(
  command: string,
  workingDir: string,
  timeout: number
): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    exec(
      command,
      {
        cwd: workingDir,
        timeout,
        maxBuffer: MAX_COMMAND_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolvePromise({
            output: `Command timed out after ${timeout}ms`,
            isError: true,
          });
          return;
        }

        // Detect maxBuffer exceeded
        if (
          error &&
          error.message &&
          error.message.includes("maxBuffer")
        ) {
          resolvePromise({
            output: `Command output exceeded maximum buffer size (${MAX_COMMAND_BUFFER / 1024 / 1024} MB). Try piping through head/tail or redirecting to a file.`,
            isError: true,
          });
          return;
        }

        const output = [
          stdout ? `stdout:\n${stdout}` : "",
          stderr ? `stderr:\n${stderr}` : "",
          error ? `exit code: ${error.code}` : "exit code: 0",
        ]
          .filter(Boolean)
          .join("\n");

        resolvePromise({
          output: truncateToolResult(output),
          isError: !!error,
        });
      }
    );
  });
}

async function listDirectoryTool(
  path: string,
  workingDir: string
): Promise<ToolResult> {
  const fullPath = safePath(workingDir, path);
  const entries = await readdir(fullPath);

  if (entries.length > MAX_DIR_ENTRIES) {
    // Only stat and return the first MAX_DIR_ENTRIES entries
    const limited = entries.slice(0, MAX_DIR_ENTRIES);
    const results: string[] = [];
    for (const entry of limited) {
      const entryStat = await stat(resolve(fullPath, entry));
      results.push(entryStat.isDirectory() ? `${entry}/` : entry);
    }
    results.push(
      `\n... and ${entries.length - MAX_DIR_ENTRIES} more entries (${entries.length} total). Use execute_command with ls/find for full listing.`
    );
    return { output: results.join("\n"), isError: false };
  }

  const results: string[] = [];
  for (const entry of entries) {
    const entryStat = await stat(resolve(fullPath, entry));
    results.push(entryStat.isDirectory() ? `${entry}/` : entry);
  }

  return { output: results.join("\n"), isError: false };
}

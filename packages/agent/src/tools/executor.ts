import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { exec } from "child_process";
import { resolve, dirname } from "path";

export interface ToolResult {
  output: string;
  isError: boolean;
}

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
          (input.timeout as number) || 30000
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
  const fullPath = resolve(workingDir, path);
  const content = await readFile(fullPath, "utf-8");
  return { output: content, isError: false };
}

async function writeFileTool(
  path: string,
  content: string,
  workingDir: string
): Promise<ToolResult> {
  const fullPath = resolve(workingDir, path);
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
        maxBuffer: 1024 * 1024 * 10, // 10MB
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          resolvePromise({
            output: `Command timed out after ${timeout}ms`,
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
          output,
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
  const fullPath = resolve(workingDir, path);
  const entries = await readdir(fullPath);
  const results: string[] = [];

  for (const entry of entries) {
    const entryStat = await stat(resolve(fullPath, entry));
    results.push(entryStat.isDirectory() ? `${entry}/` : entry);
  }

  return { output: results.join("\n"), isError: false };
}

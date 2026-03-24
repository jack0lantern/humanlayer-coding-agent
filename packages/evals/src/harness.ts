import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runAgentLoop } from "@codingagent/agent/agent-loop";
import type { SessionEvent } from "@codingagent/shared";

export interface EvalResult {
  success: boolean;
  events: SessionEvent[];
  textOutput: string;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  toolResults: Array<{ toolCallId: string; output: string; isError: boolean }>;
  sessionComplete: { status: string; summary?: string } | null;
  errorMessage: string | null;
  workingDir: string;
  /** Call to remove the temp working directory. Call after assertions. */
  cleanup: () => Promise<void>;
}

export async function runEval(options: {
  prompt: string;
  apiKey: string;
  setupFiles?: Record<string, string>;
  timeoutMs?: number;
}): Promise<EvalResult> {
  const { prompt, apiKey, setupFiles = {}, timeoutMs = 120_000 } = options;

  const workingDir = await mkdtemp(join(tmpdir(), "coding-agent-eval-"));
  const cleanup = async () => {
    await rm(workingDir, { recursive: true, force: true });
  };

  try {
    // Create any setup files
    const { writeFile, mkdir } = await import("fs/promises");
    const { dirname } = await import("path");
    for (const [path, content] of Object.entries(setupFiles)) {
      const fullPath = join(workingDir, path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, "utf-8");
    }

    const events: SessionEvent[] = [];
    const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
    const toolResults: Array<{
      toolCallId: string;
      output: string;
      isError: boolean;
    }> = [];

    let sessionComplete: EvalResult["sessionComplete"] = null;
    let errorMessage: string | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const shouldStop = () => false;

    await Promise.race([
      runAgentLoop({
        prompt,
        workingDir,
        apiKey,
        onEvent: (event) => {
          events.push(event);
          if (event.type === "tool_call") {
            toolCalls.push({
              name: event.toolName,
              input: event.input,
            });
          } else if (event.type === "tool_result") {
            toolResults.push({
              toolCallId: event.toolCallId,
              output: event.output,
              isError: event.isError,
            });
          } else if (event.type === "session_complete") {
            sessionComplete = {
              status: event.status,
              summary: event.summary,
            };
          } else if (event.type === "error") {
            errorMessage = event.message;
          }
        },
        shouldStop,
      }),
      new Promise<void>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Eval timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });

    const textOutput = events
      .filter((e): e is { type: "text"; content: string } => e.type === "text")
      .map((e) => e.content)
      .join("\n");

    return {
      success: sessionComplete?.status === "completed" && errorMessage === null,
      events,
      textOutput,
      toolCalls,
      toolResults,
      sessionComplete,
      errorMessage,
      workingDir,
      cleanup,
    };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export async function readEvalFile(
  result: EvalResult,
  path: string
): Promise<string> {
  const fullPath = join(result.workingDir, path);
  return readFile(fullPath, "utf-8");
}

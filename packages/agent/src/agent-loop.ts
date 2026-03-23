import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions } from "./tools/definitions.js";
import { executeTool } from "./tools/executor.js";
import type { SessionEvent } from "@codingagent/shared";

interface AgentLoopOptions {
  prompt: string;
  workingDir: string;
  apiKey: string;
  onEvent: (event: SessionEvent) => void;
  shouldStop: () => boolean;
}

const SYSTEM_PROMPT = `You are a coding agent running inside a workspace directory. You can read files, write files, execute shell commands, and list directories.

Your job is to help the user accomplish coding tasks. You have access to the following tools:

1. read_file - Read file contents
2. write_file - Write content to a file (creates parent directories as needed)
3. execute_command - Run shell commands (bash)
4. list_directory - List files and directories

Guidelines:
- Always start by understanding the workspace structure (list_directory)
- Read existing files before modifying them
- Write clean, well-structured code
- Test your changes when possible by running commands
- Explain what you're doing as you work
- If you encounter an error, try to understand and fix it

You are working in the directory that was provided to you. All file paths should be relative to this directory unless absolute paths are necessary.`;

export async function runAgentLoop(options: AgentLoopOptions): Promise<void> {
  const { prompt, workingDir, apiKey, onEvent, shouldStop } = options;

  const client = new Anthropic({ apiKey });

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: prompt },
  ];

  while (!shouldStop()) {
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8096,
        system: SYSTEM_PROMPT,
        tools: toolDefinitions,
        messages,
      });

      // Emit events for each content block
      for (const block of response.content) {
        if (block.type === "text") {
          onEvent({ type: "text", content: block.text });
        } else if (block.type === "tool_use") {
          onEvent({
            type: "tool_call",
            toolName: block.name,
            toolCallId: block.id,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // If the model wants to use tools, execute them all and continue
      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
        );

        // Execute all tools
        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of toolUseBlocks) {
          if (shouldStop()) break;

          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            workingDir
          );

          onEvent({
            type: "tool_result",
            toolCallId: block.id,
            output: result.output,
            isError: result.isError,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result.output,
            is_error: result.isError,
          });
        }

        // Add assistant response + tool results to conversation
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: toolResults });

        // Continue the loop
        continue;
      }

      // end_turn or other stop reason — we're done
      messages.push({ role: "assistant", content: response.content });

      onEvent({
        type: "session_complete",
        status: "completed",
        summary: "Agent completed the task",
      });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onEvent({ type: "error", message });
      onEvent({
        type: "session_complete",
        status: "failed",
        summary: `Agent error: ${message}`,
      });
      return;
    }
  }

  // Exited due to stop signal
  onEvent({
    type: "session_complete",
    status: "stopped",
    summary: "Agent was stopped by user",
  });
}

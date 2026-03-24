import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Approximate max tokens for the model context window (Claude Sonnet). */
export const MODEL_CONTEXT_LIMIT = 200_000;

/**
 * Reserve tokens for the system prompt, tool definitions, and the model's
 * response. We never let the message history consume more than
 * MODEL_CONTEXT_LIMIT - RESERVED_TOKENS.
 */
export const RESERVED_TOKENS = 30_000;

/** Maximum tokens a single user prompt may occupy. */
export const MAX_PROMPT_TOKENS = 100_000;

/** Maximum characters for a single tool result before truncation. */
export const MAX_TOOL_RESULT_CHARS = 80_000;

/** Maximum number of tool-call loop iterations before the agent gives up. */
export const MAX_ITERATIONS = 200;

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * Rough token count estimate.  4 chars ≈ 1 token is a widely-used heuristic
 * for English/code text with the Claude tokenizer.  This is intentionally
 * conservative (over-counts) so we truncate a little early rather than hit
 * the hard API limit.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** Estimate token count of a full messages array. */
export function estimateMessagesTokens(
  messages: Anthropic.MessageParam[]
): number {
  let total = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      total += estimateTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ("text" in block && typeof block.text === "string") {
          total += estimateTokens(block.text);
        } else if ("content" in block && typeof block.content === "string") {
          total += estimateTokens(block.content);
        } else if ("input" in block) {
          total += estimateTokens(JSON.stringify(block.input));
        }
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// Prompt validation
// ---------------------------------------------------------------------------

export interface PromptValidation {
  valid: boolean;
  error?: string;
  tokenEstimate: number;
}

export function validatePromptSize(prompt: string): PromptValidation {
  const tokenEstimate = estimateTokens(prompt);
  if (tokenEstimate > MAX_PROMPT_TOKENS) {
    return {
      valid: false,
      error: `Prompt is too large (~${tokenEstimate} tokens, max ${MAX_PROMPT_TOKENS}). Please shorten your request.`,
      tokenEstimate,
    };
  }
  return { valid: true, tokenEstimate };
}

// ---------------------------------------------------------------------------
// Tool result truncation
// ---------------------------------------------------------------------------

/**
 * Truncate a tool result string if it exceeds the character limit.
 * Preserves the head and tail of the output so the LLM can see both the
 * start and end of the content.
 */
export function truncateToolResult(
  output: string,
  maxChars: number = MAX_TOOL_RESULT_CHARS
): string {
  if (output.length <= maxChars) return output;

  const headSize = Math.floor(maxChars * 0.7);
  const tailSize = Math.floor(maxChars * 0.2);
  const truncatedCount = output.length - headSize - tailSize;

  return [
    output.slice(0, headSize),
    `\n\n--- TRUNCATED (${truncatedCount} characters omitted) ---\n\n`,
    output.slice(output.length - tailSize),
  ].join("");
}

// ---------------------------------------------------------------------------
// Context window compaction (summarize old messages via LLM)
// ---------------------------------------------------------------------------

/** Fraction of context budget at which we trigger compaction. */
export const COMPACTION_THRESHOLD = 0.75;

/**
 * Target size for the summary — we aim to compress the old messages down to
 * roughly this many tokens so there's plenty of room going forward.
 */
export const SUMMARY_TARGET_TOKENS = 2_000;

/**
 * Check whether the message history needs compaction.
 */
export function needsCompaction(
  messages: Anthropic.MessageParam[],
  budgetTokens: number = MODEL_CONTEXT_LIMIT - RESERVED_TOKENS
): boolean {
  return estimateMessagesTokens(messages) > budgetTokens * COMPACTION_THRESHOLD;
}

/**
 * Identify which messages to summarize. We always keep the first message
 * (original user prompt) and the most recent N message pairs. Everything
 * in between becomes input for summarization.
 *
 * Returns `{ toSummarize, toKeep }` where `toKeep` is the tail we preserve
 * verbatim, and `toSummarize` is the middle chunk to compress.
 */
export function partitionForCompaction(
  messages: Anthropic.MessageParam[],
  budgetTokens: number = MODEL_CONTEXT_LIMIT - RESERVED_TOKENS
): { firstMessage: Anthropic.MessageParam; toSummarize: Anthropic.MessageParam[]; toKeep: Anthropic.MessageParam[] } {
  const firstMessage = messages[0];

  // Keep enough recent messages to fill ~40% of the budget
  const recentBudget = budgetTokens * 0.4;
  let keepFromIndex = messages.length;
  let recentTokens = 0;

  for (let i = messages.length - 1; i >= 2; i--) {
    const msgTokens = estimateMessagesTokens([messages[i]]);
    if (recentTokens + msgTokens > recentBudget) break;
    recentTokens += msgTokens;
    keepFromIndex = i;
  }

  // Ensure keepFromIndex is at least 2 (we need something to summarize)
  if (keepFromIndex <= 1) keepFromIndex = 2;

  return {
    firstMessage,
    toSummarize: messages.slice(1, keepFromIndex),
    toKeep: messages.slice(keepFromIndex),
  };
}

/**
 * Build the prompt that asks the LLM to summarize the conversation chunk.
 */
export function buildSummaryPrompt(
  toSummarize: Anthropic.MessageParam[]
): string {
  const parts: string[] = [];

  for (const msg of toSummarize) {
    if (typeof msg.content === "string") {
      parts.push(`[${msg.role}]: ${msg.content}`);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ("text" in block && typeof block.text === "string") {
          parts.push(`[${msg.role} text]: ${block.text}`);
        } else if (block.type === "tool_use" && "name" in block) {
          parts.push(
            `[${msg.role} tool_use]: ${block.name}(${JSON.stringify(block.input).slice(0, 500)})`
          );
        } else if (block.type === "tool_result" && "content" in block) {
          const content =
            typeof block.content === "string"
              ? block.content.slice(0, 500)
              : JSON.stringify(block.content).slice(0, 500);
          const errorTag =
            "is_error" in block && block.is_error ? " [ERROR]" : "";
          parts.push(`[tool_result${errorTag}]: ${content}`);
        }
      }
    }
  }

  return parts.join("\n");
}

/**
 * Call the LLM to produce a compact summary of the conversation so far.
 */
export async function summarizeMessages(
  client: Anthropic,
  toSummarize: Anthropic.MessageParam[]
): Promise<string> {
  const conversationText = buildSummaryPrompt(toSummarize);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1500,
    system: `You are a conversation compactor. Summarize the following agent conversation history into a concise summary that preserves all critical information needed to continue the task. Include:
- What actions were taken (files read/written, commands run)
- Key results and outputs (file contents discovered, command outputs)
- Any errors encountered and how they were handled
- Current state of progress toward the task

Be concise but preserve actionable details. Use bullet points.`,
    messages: [
      {
        role: "user",
        content: `Summarize this conversation history:\n\n${conversationText}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "[Summary unavailable]";
}

/**
 * Compact the message history by summarizing old messages via the LLM.
 * Returns the compacted messages array with the summary injected.
 *
 * The result has the structure:
 *   [original prompt, assistant summary, ...recent messages]
 *
 * The summary is placed in an assistant message so the conversation
 * alternation (user/assistant) is maintained.
 */
export async function compactMessageHistory(
  client: Anthropic,
  messages: Anthropic.MessageParam[],
  budgetTokens: number = MODEL_CONTEXT_LIMIT - RESERVED_TOKENS
): Promise<Anthropic.MessageParam[]> {
  const currentTokens = estimateMessagesTokens(messages);
  if (currentTokens <= budgetTokens * COMPACTION_THRESHOLD) {
    return messages;
  }

  // Not enough messages to compact
  if (messages.length <= 3) {
    return messages;
  }

  const { firstMessage, toSummarize, toKeep } = partitionForCompaction(
    messages,
    budgetTokens
  );

  // Generate summary
  const summary = await summarizeMessages(client, toSummarize);

  // Build compacted history.
  // We need to maintain user/assistant alternation for the API.
  // firstMessage is role:user, so we follow with role:assistant (summary).
  // Then toKeep continues — if toKeep[0] is user, that works naturally.
  // If toKeep[0] is assistant, we insert a bridge user message.
  const compacted: Anthropic.MessageParam[] = [
    firstMessage,
    {
      role: "assistant",
      content: `[Conversation compacted — summary of ${toSummarize.length} earlier messages]\n\n${summary}`,
    },
  ];

  if (toKeep.length > 0) {
    // Ensure alternation: if next message is assistant, add a bridge
    if (toKeep[0].role === "assistant") {
      compacted.push({
        role: "user",
        content: "[Continuing from summary above. Proceed with the task.]",
      });
    }
    compacted.push(...toKeep);
  }

  return compacted;
}

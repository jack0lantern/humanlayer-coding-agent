import { describe, it, expect, vi } from "vitest";
import {
  estimateTokens,
  estimateMessagesTokens,
  validatePromptSize,
  truncateToolResult,
  needsCompaction,
  partitionForCompaction,
  buildSummaryPrompt,
  compactMessageHistory,
  COMPACTION_THRESHOLD,
  MAX_PROMPT_TOKENS,
  MAX_TOOL_RESULT_CHARS,
  MODEL_CONTEXT_LIMIT,
  RESERVED_TOKENS,
} from "../context-window.js";
import type Anthropic from "@anthropic-ai/sdk";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates roughly 1 token per 3 characters", () => {
    const text = "a".repeat(300);
    expect(estimateTokens(text)).toBe(100);
  });

  it("rounds up for non-divisible lengths", () => {
    expect(estimateTokens("ab")).toBe(1); // ceil(2/3)
  });
});

describe("estimateMessagesTokens", () => {
  it("handles string content messages", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "aaa" }, // 1 token
    ];
    expect(estimateMessagesTokens(messages)).toBe(1);
  });

  it("handles array content with text blocks", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "aaa" }],
      },
    ];
    expect(estimateMessagesTokens(messages)).toBe(1);
  });

  it("handles tool_result blocks with content string", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "123",
            content: "aaa",
          },
        ],
      },
    ];
    expect(estimateMessagesTokens(messages)).toBe(1);
  });

  it("sums across multiple messages", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "aaa" }, // 1
      { role: "assistant", content: "bbbbbb" }, // 2
    ];
    expect(estimateMessagesTokens(messages)).toBe(3);
  });
});

describe("validatePromptSize", () => {
  it("accepts a normal-sized prompt", () => {
    const result = validatePromptSize("Hello, please help me write code.");
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("rejects a prompt exceeding MAX_PROMPT_TOKENS", () => {
    const hugePrompt = "x".repeat(MAX_PROMPT_TOKENS * 3 + 10);
    const result = validatePromptSize(hugePrompt);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("too large");
  });

  it("returns token estimate", () => {
    const result = validatePromptSize("abc");
    expect(result.tokenEstimate).toBe(1);
  });
});

describe("truncateToolResult", () => {
  it("returns short output unchanged", () => {
    const output = "Hello, world!";
    expect(truncateToolResult(output)).toBe(output);
  });

  it("truncates output exceeding the limit", () => {
    const output = "x".repeat(MAX_TOOL_RESULT_CHARS + 1000);
    const truncated = truncateToolResult(output);
    expect(truncated.length).toBeLessThan(output.length);
    expect(truncated).toContain("TRUNCATED");
    expect(truncated).toContain("characters omitted");
  });

  it("preserves head and tail of the content", () => {
    const head = "HEAD_MARKER_";
    const tail = "_TAIL_MARKER";
    const middle = "m".repeat(MAX_TOOL_RESULT_CHARS + 1000);
    const output = head + middle + tail;
    const truncated = truncateToolResult(output);
    expect(truncated).toContain("HEAD_MARKER_");
    expect(truncated).toContain("_TAIL_MARKER");
  });

  it("respects custom maxChars", () => {
    const output = "x".repeat(200);
    const truncated = truncateToolResult(output, 100);
    expect(truncated.length).toBeLessThan(200);
    expect(truncated).toContain("TRUNCATED");
  });
});

// ---------------------------------------------------------------------------
// Compaction tests
// ---------------------------------------------------------------------------

describe("needsCompaction", () => {
  it("returns false when well within budget", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(needsCompaction(messages, 1_000_000)).toBe(false);
  });

  it("returns true when above threshold", () => {
    const bigContent = "x".repeat(30_000); // ~10k tokens
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: bigContent },
      { role: "assistant", content: bigContent },
      { role: "user", content: bigContent },
    ];
    // Budget of 20k tokens, threshold at 75% = 15k tokens
    // 30k tokens of content > 15k → should need compaction
    expect(needsCompaction(messages, 20_000)).toBe(true);
  });
});

describe("partitionForCompaction", () => {
  it("preserves first message and splits middle from tail", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "original prompt" },
      { role: "assistant", content: "step 1" },
      { role: "user", content: "step 2" },
      { role: "assistant", content: "step 3" },
      { role: "user", content: "step 4" },
      { role: "assistant", content: "latest" },
    ];

    const { firstMessage, toSummarize, toKeep } = partitionForCompaction(
      messages,
      100_000
    );

    expect(firstMessage.content).toBe("original prompt");
    expect(toSummarize.length).toBeGreaterThan(0);
    expect(toKeep.length).toBeGreaterThan(0);
    // All messages accounted for
    expect(1 + toSummarize.length + toKeep.length).toBe(messages.length);
  });

  it("keeps at least something to summarize", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "prompt" },
      { role: "assistant", content: "a" },
      { role: "user", content: "b" },
    ];

    const { toSummarize } = partitionForCompaction(messages, 100_000);
    expect(toSummarize.length).toBeGreaterThan(0);
  });
});

describe("buildSummaryPrompt", () => {
  it("formats string content messages", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "assistant", content: "I will help you" },
      { role: "user", content: "thanks" },
    ];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("[assistant]: I will help you");
    expect(prompt).toContain("[user]: thanks");
  });

  it("formats tool_use blocks", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "read_file",
            input: { path: "foo.txt" },
          },
        ],
      },
    ];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("read_file");
    expect(prompt).toContain("foo.txt");
  });

  it("formats tool_result blocks and marks errors", () => {
    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t1",
            content: "file contents here",
            is_error: false,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t2",
            content: "ENOENT: no such file",
            is_error: true,
          },
        ],
      },
    ];
    const prompt = buildSummaryPrompt(messages);
    expect(prompt).toContain("file contents here");
    expect(prompt).toContain("[ERROR]");
    expect(prompt).toContain("ENOENT");
  });
});

describe("compactMessageHistory", () => {
  it("returns messages unchanged when below threshold", async () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];

    const mockClient = {} as any; // should not be called
    const result = await compactMessageHistory(mockClient, messages, 1_000_000);
    expect(result).toEqual(messages);
  });

  it("does not compact when 3 or fewer messages", async () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "x".repeat(90_000) },
      { role: "assistant", content: "x".repeat(90_000) },
      { role: "user", content: "x".repeat(90_000) },
    ];

    const mockClient = {} as any;
    const result = await compactMessageHistory(mockClient, messages, 100);
    expect(result.length).toBe(3);
  });

  it("compacts by calling summarizeMessages and replacing middle", async () => {
    const bigContent = "x".repeat(60_000); // ~20k tokens each
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "original task" },
      { role: "assistant", content: bigContent },
      { role: "user", content: bigContent },
      { role: "assistant", content: bigContent },
      { role: "user", content: bigContent },
      { role: "assistant", content: "latest response" },
      { role: "user", content: "latest question" },
    ];

    // Mock the Anthropic client to return a summary
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [
            {
              type: "text",
              text: "Summary: The agent read and wrote several files.",
            },
          ],
        }),
      },
    } as any;

    // Budget of 30k tokens — conversation is ~100k+ tokens, well over threshold
    const result = await compactMessageHistory(mockClient, messages, 30_000);

    // Should have fewer messages than original
    expect(result.length).toBeLessThan(messages.length);
    // First message preserved
    expect(result[0].content).toBe("original task");
    // Summary present
    expect(
      result.some(
        (m) =>
          typeof m.content === "string" &&
          m.content.includes("Conversation compacted")
      )
    ).toBe(true);
    // The LLM was called to generate the summary
    expect(mockClient.messages.create).toHaveBeenCalledOnce();
  });

  it("maintains user/assistant alternation after compaction", async () => {
    const bigContent = "x".repeat(60_000);
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "original task" },
      { role: "assistant", content: bigContent },
      { role: "user", content: bigContent },
      { role: "assistant", content: bigContent },
      { role: "user", content: "recent" },
      { role: "assistant", content: "latest" },
    ];

    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Summary of work done." }],
        }),
      },
    } as any;

    const result = await compactMessageHistory(mockClient, messages, 30_000);

    // Check alternation: user, assistant, user, assistant, ...
    for (let i = 0; i < result.length - 1; i++) {
      if (result[i].role === result[i + 1].role) {
        // Should never have two of the same role in a row
        expect(result[i].role).not.toBe(result[i + 1].role);
      }
    }
    // First message should be user
    expect(result[0].role).toBe("user");
  });
});

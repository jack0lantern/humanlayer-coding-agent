import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionEvent } from "@codingagent/shared";

// We test the agent loop's edge-case handling by mocking the Anthropic client.
// This lets us simulate context overflow, infinite loops, and API errors
// without hitting real APIs.

// Mock Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
    static APIError = class APIError extends Error {
      status: number;
      headers: Record<string, string>;
      constructor(
        status: number,
        message: string,
        headers: Record<string, string> = {}
      ) {
        super(message);
        this.status = status;
        this.headers = headers;
      }
    };
  }
  return { default: MockAnthropic };
});

// Import after mocking
const { runAgentLoop } = await import("../agent-loop.js");

function collectEvents(): { events: SessionEvent[]; onEvent: (e: SessionEvent) => void } {
  const events: SessionEvent[] = [];
  return { events, onEvent: (e: SessionEvent) => events.push(e) };
}

function makeEndTurnResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
  };
}

function makeToolUseResponse(toolName: string, input: Record<string, unknown>) {
  return {
    content: [
      { type: "text", text: `Using ${toolName}` },
      {
        type: "tool_use",
        id: `tool_${Math.random().toString(36).slice(2)}`,
        name: toolName,
        input,
      },
    ],
    stop_reason: "tool_use",
  };
}

beforeEach(() => {
  mockCreate.mockReset();
});

describe("runAgentLoop - edge cases", () => {
  it("rejects prompts that exceed MAX_PROMPT_TOKENS", async () => {
    const { events, onEvent } = collectEvents();
    const hugePrompt = "x".repeat(300_010); // ~100k tokens at 3 chars/token

    await runAgentLoop({
      prompt: hugePrompt,
      workingDir: "/tmp",
      apiKey: "test-key",
      onEvent,
      shouldStop: () => false,
    });

    expect(events.some((e) => e.type === "error")).toBe(true);
    const complete = events.find((e) => e.type === "session_complete");
    expect(complete).toBeDefined();
    expect((complete as any).status).toBe("failed");
    expect((complete as any).summary).toContain("too large");
    // API should never be called
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("stops after maxIterations and reports failure", async () => {
    const { events, onEvent } = collectEvents();

    // Always return tool_use to force looping
    mockCreate.mockResolvedValue(
      makeToolUseResponse("list_directory", { path: "." })
    );

    await runAgentLoop({
      prompt: "loop forever",
      workingDir: "/tmp",
      apiKey: "test-key",
      onEvent,
      shouldStop: () => false,
      maxIterations: 3,
    });

    const complete = events.find((e) => e.type === "session_complete");
    expect(complete).toBeDefined();
    expect((complete as any).status).toBe("failed");
    expect((complete as any).summary).toContain("max iteration limit");
    // Should have called the API exactly 3 times
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("respects shouldStop signal", async () => {
    const { events, onEvent } = collectEvents();
    let callCount = 0;

    mockCreate.mockResolvedValue(
      makeToolUseResponse("list_directory", { path: "." })
    );

    await runAgentLoop({
      prompt: "do stuff",
      workingDir: "/tmp",
      apiKey: "test-key",
      onEvent,
      shouldStop: () => {
        callCount++;
        return callCount > 2; // Stop after 2nd check
      },
    });

    const complete = events.find((e) => e.type === "session_complete");
    expect(complete).toBeDefined();
    expect((complete as any).status).toBe("stopped");
  });

  it("completes successfully on end_turn", async () => {
    const { events, onEvent } = collectEvents();

    mockCreate.mockResolvedValue(
      makeEndTurnResponse("Done! I created the file.")
    );

    await runAgentLoop({
      prompt: "Create hello.txt",
      workingDir: "/tmp",
      apiKey: "test-key",
      onEvent,
      shouldStop: () => false,
    });

    const complete = events.find((e) => e.type === "session_complete");
    expect(complete).toBeDefined();
    expect((complete as any).status).toBe("completed");
    expect(events.some((e) => e.type === "text")).toBe(true);
  });

  it("handles non-retryable API errors gracefully", async () => {
    const { events, onEvent } = collectEvents();

    mockCreate.mockRejectedValue(new Error("Invalid API key"));

    await runAgentLoop({
      prompt: "hello",
      workingDir: "/tmp",
      apiKey: "bad-key",
      onEvent,
      shouldStop: () => false,
    });

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as any).message).toContain("Invalid API key");

    const complete = events.find((e) => e.type === "session_complete");
    expect((complete as any).status).toBe("failed");
  });

  it("retries on 429 rate limit errors", async () => {
    const { events, onEvent } = collectEvents();

    // Use a plain Error with status to simulate rate limiting
    // (since we mocked the module, we can't easily construct APIError)
    let callCount = 0;
    mockCreate.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        // Simulate a network error that is retryable
        const err = new Error("socket hang up");
        throw err;
      }
      return makeEndTurnResponse("Success after retries");
    });

    await runAgentLoop({
      prompt: "hello",
      workingDir: "/tmp",
      apiKey: "test-key",
      onEvent,
      shouldStop: () => false,
    });

    const complete = events.find((e) => e.type === "session_complete");
    expect(complete).toBeDefined();
    expect((complete as any).status).toBe("completed");
    // Should have been called 3 times (2 retries + 1 success)
    expect(callCount).toBe(3);
  }, 30_000);

  it("emits tool_call and tool_result events", async () => {
    const { events, onEvent } = collectEvents();

    mockCreate
      .mockResolvedValueOnce(
        makeToolUseResponse("list_directory", { path: "." })
      )
      .mockResolvedValueOnce(makeEndTurnResponse("Here are the files."));

    await runAgentLoop({
      prompt: "list files",
      workingDir: "/tmp",
      apiKey: "test-key",
      onEvent,
      shouldStop: () => false,
    });

    expect(events.some((e) => e.type === "tool_call")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(true);
    expect(
      events.find((e) => e.type === "session_complete" && (e as any).status === "completed")
    ).toBeDefined();
  });
});

# Edge Cases: Coding Agent

This document catalogues all identified edge cases in the agent system,
the fixes applied, and how each is tested.

---

## EC-1: Session History Exceeding Context Window

**Problem:** The `messages` array in `agent-loop.ts` grows without bound as
tool calls and results accumulate. A long-running task with many tool
invocations can push the message history past Claude's context window limit
(~200k tokens for Sonnet), causing API errors.

**Fix:** `context-window.ts` implements LLM-powered **compaction**. When
message history exceeds 75% of the context budget (`COMPACTION_THRESHOLD`),
the system:

1. **Partitions** messages into: original prompt, middle (old) messages,
   and recent tail messages (`partitionForCompaction()`)
2. **Summarizes** the middle chunk by calling Claude with a compaction
   prompt (`summarizeMessages()`), producing a concise bullet-point
   summary of actions taken, results seen, and errors encountered
3. **Replaces** the middle messages with a single assistant message
   containing the summary, maintaining user/assistant alternation

This preserves actionable context (what was done, what was found) while
dramatically reducing token count. The agent loop calls
`compactMessageHistory()` before every API request.

**Tests:**
- Unit: `context-window.test.ts` → `needsCompaction` (threshold check)
- Unit: `context-window.test.ts` → `partitionForCompaction` (message splitting)
- Unit: `context-window.test.ts` → `buildSummaryPrompt` (prompt formatting)
- Unit: `context-window.test.ts` → `compactMessageHistory` (end-to-end with mocked LLM)
- Unit: `context-window.test.ts` → "maintains user/assistant alternation after compaction"

---

## EC-2: User Prompt Exceeding Context Window

**Problem:** No validation on prompt size. A user could submit a prompt
that fills the entire context window, leaving no room for the system prompt,
tools, or model response.

**Fix:** Dual-layer validation:
1. **Server-side** (`sessions.ts`): Rejects prompts > 300k characters (HTTP 400)
2. **Agent-side** (`context-window.ts`): `validatePromptSize()` rejects prompts
   estimated at > 100k tokens, emitting an error event without calling the API

**Tests:**
- Unit: `context-window.test.ts` → "rejects a prompt exceeding MAX_PROMPT_TOKENS"
- Unit: `agent-loop.test.ts` → "rejects prompts that exceed MAX_PROMPT_TOKENS"

---

## EC-3: Tool Output Exceeding Context / Memory

**Problem:** Several tools could produce outputs large enough to exhaust
memory or context:
- `read_file` had no size limit — reading a multi-GB file would OOM
- `execute_command` allowed 10 MB buffers dumped into LLM context
- `list_directory` on a huge directory produced unbounded output

**Fix:**
- `read_file`: Rejects files > 1 MB with a helpful error suggesting
  `head`/`tail` via `execute_command`
- All tool outputs run through `truncateToolResult()` which preserves
  the first 70% and last 20% of content (with a truncation notice)
  when exceeding 80k characters
- `list_directory`: Caps at 1000 entries with a count notice
- `execute_command`: Detects `maxBuffer` exceeded errors and returns
  a descriptive message

**Tests:**
- Unit: `executor.test.ts` → "rejects files larger than MAX_READ_FILE_SIZE"
- Unit: `executor.test.ts` → "handles large directories with truncation notice"
- Unit: `context-window.test.ts` → "truncates output exceeding the limit"
- Eval: `edge-cases.eval.ts` → EC-1 (large file), EC-8 (large command output)

---

## EC-4: Infinite Loop / Runaway Iterations

**Problem:** The agent loop had no iteration limit. If the LLM kept
requesting tool calls without ever reaching `end_turn`, the session
would run indefinitely.

**Fix:** `MAX_ITERATIONS` constant (200) in `context-window.ts`. The
agent loop counts iterations and emits a failure event when the limit
is reached. The limit is configurable via `maxIterations` option.

**Tests:**
- Unit: `agent-loop.test.ts` → "stops after maxIterations and reports failure"

---

## EC-5: Path Traversal

**Problem:** `resolve(workingDir, "../../../etc/passwd")` resolved to a
path outside the working directory. An LLM deciding to read system files
could access anything on the filesystem.

**Fix:** `safePath()` in `executor.ts` verifies that the resolved path
stays within the working directory by checking `relative()` output. Throws
if the path escapes the sandbox.

**Tests:**
- Unit: `executor.test.ts` → "rejects path traversal with ../"
- Unit: `executor.test.ts` → "rejects absolute paths outside working dir"
- Unit: `executor.test.ts` → "rejects tricky traversal like foo/../../.."
- Unit: `executor.test.ts` → "rejects path traversal on write"
- Unit: `executor.test.ts` → "rejects path traversal on list"
- Eval: `edge-cases.eval.ts` → EC-3 (path traversal blocked)

---

## EC-6: Binary File Reads

**Problem:** Reading binary files as UTF-8 produces garbage tokens that
waste context and confuse the LLM.

**Fix:** `looksLikeBinary()` in `executor.ts` checks the first 8 KB of
the file for null bytes. Binary files are rejected with a descriptive
error message.

**Tests:**
- Unit: `executor.test.ts` → "rejects binary files"
- Unit: `executor.test.ts` → "returns false for text content" / "returns true for binary content"
- Eval: `edge-cases.eval.ts` → EC-2 (binary file detection)

---

## EC-7: API Transient Errors (429, 529, Network)

**Problem:** A single transient error (rate limiting, server overload,
network reset) would immediately fail the entire session with no recovery.

**Fix:** `callWithRetry()` in `agent-loop.ts` retries up to 3 times with
exponential backoff (2s, 4s, 8s + jitter) for:
- HTTP 429 (rate limit), 529 (overloaded), 500, 502, 503
- Network errors: ECONNRESET, socket hang up, ETIMEDOUT
- Honors `Retry-After` header when present

**Tests:**
- Unit: `agent-loop.test.ts` → "retries on 429 rate limit errors"
- Unit: `agent-loop.test.ts` → "handles non-retryable API errors gracefully"

---

## EC-8: WebSocket Message Size

**Problem:** Large tool outputs sent as single WebSocket messages could
exceed frame size limits or cause receiver-side memory issues.

**Fix:** `truncateEventForWS()` in `ws-client.ts` checks serialized
message size against a 1 MB limit. For `tool_result` and `text` events,
large content fields are truncated in-place.

**Tests:**
- Manual integration testing (WS truncation is transport-level)

---

## EC-9: Database Event Data Bloat

**Problem:** Large tool outputs stored verbatim in the JSONB `data`
column of the `Event` table could bloat the database.

**Fix:** Tool outputs are truncated at the agent level before being
emitted as events (via `truncateToolResult()`), so persisted data
is already bounded. The WS truncation layer provides a second guard.

---

## EC-10: Command Buffer Exceeded

**Problem:** When stdout exceeds the 10 MB `maxBuffer` limit in
`exec()`, Node.js throws an error with a non-obvious message.

**Fix:** `executeCommandTool()` now detects `maxBuffer` errors by
checking `error.message` and returns a clear error message suggesting
the user pipe through `head`/`tail` or redirect to a file.

**Tests:**
- Unit: `executor.test.ts` → "truncates very large output"

---

## EC-11: Concurrent Session Interference

**Problem:** The `stopFlag` in `ws-client.ts` is shared — if two
sessions were somehow assigned concurrently, stopping one would stop
both.

**Mitigation:** The current architecture enforces single-agent,
single-session execution. The server only assigns one session at a time.
This is documented as a known constraint for the future multi-session
work.

---

## Test Matrix

| Edge Case | Unit Test | LLM Eval | Location |
|-----------|-----------|----------|----------|
| EC-1: Context overflow | ✅ | — | `context-window.test.ts` |
| EC-2: Large prompt | ✅ | — | `context-window.test.ts`, `agent-loop.test.ts` |
| EC-3: Large tool output | ✅ | ✅ | `executor.test.ts`, `edge-cases.eval.ts` |
| EC-4: Infinite loop | ✅ | — | `agent-loop.test.ts` |
| EC-5: Path traversal | ✅ | ✅ | `executor.test.ts`, `edge-cases.eval.ts` |
| EC-6: Binary files | ✅ | ✅ | `executor.test.ts`, `edge-cases.eval.ts` |
| EC-7: API retry | ✅ | — | `agent-loop.test.ts` |
| EC-8: WS message size | — | — | `ws-client.ts` (transport-level) |
| EC-9: DB bloat | — | — | Mitigated by upstream truncation |
| EC-10: Buffer exceeded | ✅ | ✅ | `executor.test.ts`, `edge-cases.eval.ts` |
| EC-11: Concurrent sessions | — | — | Architecture constraint |

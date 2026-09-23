import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { loadTurns } from "../src/loader.js";
import { buildPrefilter } from "../src/prefilter.js";
import { resumeCommandFor } from "../src/source.js";
import { TOOL_MARK } from "../src/textExtract.js";

function meta(over = {}) {
  return JSON.stringify({
    timestamp: "2026-09-14T03:54:20.869Z",
    type: "session_meta",
    payload: {
      session_id: "parent-1",
      id: "thread-1",
      cwd: "/proj-a",
      thread_source: "user",
      ...over,
    },
  });
}

function message(role, text, over = {}) {
  return JSON.stringify({
    timestamp: "2026-09-14T04:00:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [
        { type: role === "assistant" ? "output_text" : "input_text", text },
      ],
      ...over,
    },
  });
}

async function withCodexFile(lines, fn, prefilter) {
  const dir = await mkdtemp(join(tmpdir(), "cg-codex-"));
  const file = join(dir, "rollout-2026-09-14T03-54-20-thread-1.jsonl");
  await writeFile(file, lines.join("\n"));
  try {
    const turns = [];
    for await (const t of loadTurns(file, prefilter, "codex")) turns.push(t);
    await fn(turns);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("reads user and assistant messages, inheriting the file's cwd and session id", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
      message("user", "find the needle"),
      message("assistant", "found it"),
    ],
    (turns) => {
      expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
      expect(turns.every((t) => t.source === "codex")).toBe(true);
      expect(turns[0].cwd).toBe("/proj-a");
      expect(turns[0].sessionId).toBe("parent-1");
      expect(turns[0].textLines).toEqual(["find the needle"]);
      expect(turns[0].isSidechain).toBe(false);
      expect(turns[0].timestampMs).toBe(Date.parse("2026-09-14T04:00:00.000Z"));
    },
  );
});

test("a later turn_context updates the cwd the following turns inherit", async () => {
  await withCodexFile(
    [
      meta(),
      message("user", "before"),
      JSON.stringify({
        type: "turn_context",
        payload: { cwd: "/proj-b" },
      }),
      message("user", "after"),
    ],
    (turns) => {
      expect(turns.map((t) => t.cwd)).toEqual(["/proj-a", "/proj-b"]);
    },
  );
});

test("a non-user thread_source marks every turn in the file as a subagent", async () => {
  await withCodexFile(
    [meta({ thread_source: "subagent" }), message("assistant", "sub work")],
    (turns) => {
      expect(turns[0].isSidechain).toBe(true);
      expect(turns[0].agentId).toBe("thread-1");
      expect(turns[0].sessionId).toBe("parent-1");
    },
  );
});

test("developer turns are meta, so they stay out of a default search", async () => {
  await withCodexFile(
    [meta(), message("developer", "injected instructions")],
    (turns) => {
      expect(turns[0].isMeta).toBe(true);
      expect(turns[0].role).toBe("user");
    },
  );
});

test("a tool call contributes its name and arguments as searchable lines", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:01:00.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          input: 'tools.exec_command({cmd:"rg needle"})',
        },
      }),
    ],
    (turns) => {
      expect(turns[0].role).toBe("assistant");
      expect(turns[0].toolCalls).toEqual([
        {
          name: "exec",
          paths: [],
          input: 'tools.exec_command({cmd:"rg needle"})',
        },
      ]);
      expect(turns[0].textLines[0]).toContain("exec");
      expect(turns[0].textLines[1]).toContain("rg needle");
    },
  );
});

function functionCall(args) {
  return JSON.stringify({
    timestamp: "2026-09-14T04:01:30.000Z",
    type: "response_item",
    payload: { type: "function_call", name: "shell", arguments: args },
  });
}

test("a function call's JSON arguments become its parsed input", async () => {
  const args = { command: ["rg", "needle"], workdir: "/proj-a" };
  await withCodexFile([meta(), functionCall(JSON.stringify(args))], (turns) => {
    expect(turns[0].toolCalls).toEqual([
      { name: "shell", paths: [], input: args },
    ]);
  });
});

test("a function call whose arguments are not JSON keeps the raw string", async () => {
  const args = "{not json: needle";
  await withCodexFile([meta(), functionCall(args)], (turns) => {
    expect(turns[0].toolCalls).toEqual([
      { name: "shell", paths: [], input: args },
    ]);
  });
});

test("a custom tool call keeps even JSON-shaped input as its string", async () => {
  const input = '{"cmd":"rg needle"}';
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:01:40.000Z",
        type: "response_item",
        payload: { type: "custom_tool_call", name: "exec", input },
      }),
    ],
    (turns) => {
      expect(turns[0].toolCalls).toEqual([{ name: "exec", paths: [], input }]);
    },
  );
});

test("tool output is searchable and attributed to the side that received it", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:02:00.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call_output",
          output: [{ type: "input_text", text: "needle found\nline two" }],
        },
      }),
    ],
    (turns) => {
      expect(turns[0].role).toBe("user");
      expect(turns[0].textLines).toEqual(["needle found", "line two"]);
    },
  );
});

// Worth extracting because the query is the only plaintext such a record
// carries, and what a session searched for is what a later search asks about.
test("a web search call contributes its queries", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:03:00.000Z",
        type: "response_item",
        payload: {
          type: "web_search_call",
          status: "completed",
          action: { type: "search", queries: ["needle release notes"] },
        },
      }),
    ],
    (turns) => {
      expect(turns[0].role).toBe("assistant");
      expect(turns[0].textLines[1]).toBe("needle release notes");
      expect(turns[0].toolCalls).toEqual([
        {
          name: "web_search_call",
          paths: [],
          input: { type: "search", queries: ["needle release notes"] },
        },
      ]);
    },
  );
});

test("a tool search call contributes its query", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:04:00.000Z",
        type: "response_item",
        payload: {
          type: "tool_search_call",
          arguments: { query: "serena initial_instructions", limit: 1 },
        },
      }),
    ],
    (turns) => {
      expect(turns[0].textLines[1]).toBe("serena initial_instructions");
      expect(turns[0].toolCalls).toEqual([
        {
          name: "tool_search_call",
          paths: [],
          input: { query: "serena initial_instructions", limit: 1 },
        },
      ]);
    },
  );
});

test("a search call with no query yields no turn", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:05:00.000Z",
        type: "response_item",
        payload: { type: "web_search_call", action: { type: "search" } },
      }),
    ],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

// Old rollouts put a one-line summary beside the encrypted body; current ones
// carry an empty array, which must not become a blank turn.
test("reasoning contributes its plaintext summary, and nothing when empty", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:06:00.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [{ type: "summary_text", text: "**Reading the needle**" }],
          encrypted_content: "opaque",
        },
      }),
      JSON.stringify({
        timestamp: "2026-09-14T04:07:00.000Z",
        type: "response_item",
        payload: {
          type: "reasoning",
          summary: [],
          encrypted_content: "opaque",
        },
      }),
    ],
    (turns) => {
      expect(turns.length).toBe(1);
      expect(turns[0].role).toBe("assistant");
      expect(turns[0].textLines).toEqual(["**Reading the needle**"]);
    },
  );
});

// A blank turn renders as a bare `>>` and matches an empty pattern, so every
// reader in this file drops empty text rather than passing one line of nothing.
test("a message whose content is an empty string yields no turn", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:08:00.000Z",
        type: "response_item",
        payload: { type: "message", role: "user", content: "" },
      }),
    ],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

// An `agent_message` is how a spawned agent reports back, so it carries the
// handoff text a search for "what did that subagent conclude" needs.
test("an agent_message is an assistant turn", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:09:00.000Z",
        type: "response_item",
        payload: {
          type: "agent_message",
          author: "/root",
          content: [{ type: "input_text", text: "the needle, reported back" }],
        },
      }),
    ],
    (turns) => {
      expect(turns[0].role).toBe("assistant");
      expect(turns[0].textLines).toEqual(["the needle, reported back"]);
    },
  );
});

test("a message in an unknown role yields no turn", async () => {
  await withCodexFile(
    [meta(), message("system", "neither party said this")],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

test("an unrecognised response_item type yields no turn", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:10:00.000Z",
        type: "response_item",
        payload: { type: "some_future_shape", text: "not read" },
      }),
    ],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

// The schema is undocumented and drifts, so every reader has to survive a
// shape it did not expect rather than throwing mid-scan.
test.each([
  [
    "content is not an array or string",
    { type: "message", role: "user", content: 42 },
  ],
  [
    "a content block is not an object",
    { type: "message", role: "user", content: ["raw"] },
  ],
  [
    "a content block has no text",
    { type: "message", role: "user", content: [{ type: "image" }] },
  ],
  ["a tool call has neither name nor arguments", { type: "custom_tool_call" }],
  [
    "a search call's queries are not strings",
    { type: "web_search_call", action: { queries: [1, 2] } },
  ],
  [
    "reasoning's summary is not an array",
    { type: "reasoning", summary: "opaque" },
  ],
  [
    "a reasoning block is not an object",
    { type: "reasoning", summary: ["raw"] },
  ],
  [
    "a reasoning block has no text",
    { type: "reasoning", summary: [{ type: "summary_text" }] },
  ],
])("a malformed payload yields no turn: %s", async (_label, payload) => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:11:00.000Z",
        type: "response_item",
        payload,
      }),
    ],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

// Which tool ran is worth keeping even when its arguments arrive in a shape
// this cannot read — the name alone still answers `--tool`.
test("a tool call whose input is not a string keeps the name", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "2026-09-14T04:12:00.000Z",
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          input: { cmd: "x" },
        },
      }),
    ],
    (turns) => {
      expect(turns[0].textLines).toEqual([`${TOOL_MARK} exec`]);
      expect(turns[0].toolCalls).toEqual([
        { name: "exec", paths: [], input: { cmd: "x" } },
      ]);
    },
  );
});

test("a line that is valid JSON but not an object is skipped", async () => {
  await withCodexFile([meta(), "[1,2,3]", '"a string"'], (turns) => {
    expect(turns).toEqual([]);
  });
});

test("a record with no payload is skipped", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({ type: "response_item", payload: "not an object" }),
    ],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

test("a turn with no timestamp still parses, with the field left unset", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "undated" }],
        },
      }),
    ],
    (turns) => {
      expect(turns[0].textLines).toEqual(["undated"]);
      expect(turns[0].timestamp).toBe(undefined);
      expect(turns[0].timestampMs).toBe(undefined);
    },
  );
});

test("an unparseable timestamp leaves timestampMs unset but keeps the raw string", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({
        timestamp: "not a date",
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "misdated" }],
        },
      }),
    ],
    (turns) => {
      expect(turns[0].timestamp).toBe("not a date");
      expect(turns[0].timestampMs).toBe(undefined);
    },
  );
});

test("bookkeeping records yield no turns", async () => {
  await withCodexFile(
    [
      meta(),
      JSON.stringify({ type: "token_usage_record", payload: { usage: {} } }),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
      JSON.stringify({ type: "world_state", payload: { full: true } }),
      "{ not json",
    ],
    (turns) => {
      expect(turns).toEqual([]);
    },
  );
});

test("a prefilter still lets metadata through, so a surviving hit keeps its cwd", async () => {
  const prefilter = buildPrefilter({
    pattern: "needle",
    regex: false,
    fixed: false,
    ignoreCase: false,
  });
  await withCodexFile(
    [meta(), message("user", "unrelated"), message("user", "the needle")],
    (turns) => {
      expect(turns.length).toBe(1);
      expect(turns[0].cwd).toBe("/proj-a");
      expect(turns[0].sessionId).toBe("parent-1");
    },
    prefilter,
  );
});

// Some Codex rollouts carry an ancestor's session_meta below their own, so
// last-wins answered --session with an id the file is not named for.
test("a resumed rollout keeps the id of its own thread, not its ancestor's", async () => {
  await withCodexFile(
    [
      meta({ session_id: "own-1", id: "own-1" }),
      message("user", "after the resume"),
      meta({ session_id: "ancestor-1", id: "ancestor-1", cwd: "/older" }),
      message("user", "replayed from the ancestor"),
    ],
    (turns) => {
      expect(turns.map((t) => t.sessionId)).toEqual(["own-1", "own-1"]);
      expect(turns.map((t) => t.agentId)).toEqual([undefined, undefined]);
      expect(turns.map((t) => t.cwd)).toEqual(["/proj-a", "/older"]);
    },
  );
});

test("a replayed ancestor cannot flip the thread to subagent", async () => {
  await withCodexFile(
    [
      meta({ session_id: "own-2", id: "own-2" }),
      meta({ thread_source: "subagent", session_id: "p", id: "sub" }),
      message("user", "still the user's thread"),
    ],
    (turns) => {
      expect(turns[0].isSidechain).toBe(false);
      expect(turns[0].sessionId).toBe("own-2");
    },
  );
});

test("resume wording follows the source, so a copied command reopens the right agent", () => {
  expect(resumeCommandFor("claude", "abc")).toBe("claude --resume abc");
  expect(resumeCommandFor("codex", "abc")).toBe("codex resume abc");
});

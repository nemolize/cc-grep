import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { loadTurns } from "../src/loader.js";
import { buildPrefilter } from "../src/prefilter.js";
import { resumeCommandFor } from "../src/source.js";

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
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-codex-"));
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
      expect(turns[0].toolCalls).toEqual([{ name: "exec", paths: [] }]);
      expect(turns[0].textLines[0]).toContain("exec");
      expect(turns[0].textLines[1]).toContain("rg needle");
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

test("resume wording follows the source, so a copied command reopens the right agent", () => {
  expect(resumeCommandFor("claude", "abc")).toBe("claude --resume abc");
  expect(resumeCommandFor("codex", "abc")).toBe("codex resume abc");
});

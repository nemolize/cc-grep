import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { search } from "../src/search.js";

function opts(root, over) {
  return {
    pattern: "needle",
    regex: false,
    fixed: false,
    ignoreCase: false,
    root,
    role: "any",
    includeMeta: false,
    context: 2,
    resume: false,
    printResume: false,
    json: false,
    color: "never",
    ...over,
  };
}

async function corpus(fn) {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-search-"));
  const line = (o) => JSON.stringify(o);
  await writeFile(
    join(dir, "s.jsonl"),
    [
      line({
        type: "user",
        sessionId: "old",
        timestamp: "2026-06-01T00:00:00Z",
        cwd: "/proj-a",
        message: { content: "an old needle here" },
      }),
      line({
        type: "assistant",
        sessionId: "new",
        timestamp: "2026-07-13T00:00:00Z",
        cwd: "/proj-b",
        message: { content: [{ type: "text", text: "a fresh needle" }] },
      }),
      line({
        type: "user",
        sessionId: "nomatch",
        timestamp: "2026-07-13T00:00:00Z",
        message: { content: "unrelated" },
      }),
    ].join("\n"),
  );
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function collect(o) {
  const hits = [];
  for await (const h of search(o)) hits.push(h);
  return hits;
}

test("matches across turns; non-matching turns excluded", async () => {
  await corpus(async (root) => {
    const hits = await collect(opts(root, {}));
    expect(hits.length).toBe(2);
    const ids = hits.map((h) => h.turn.sessionId).sort();
    expect(ids).toEqual(["new", "old"]);
  });
});

test("--since 7d excludes the older transcript (acceptance criterion)", async () => {
  await corpus(async (root) => {
    const sinceMs = Date.parse("2026-07-13T00:00:00Z") - 7 * 86_400_000;
    const hits = await collect(opts(root, { sinceMs }));
    expect(hits.length).toBe(1);
    expect(hits[0].turn.sessionId).toBe("new");
  });
});

test("--role user restricts to user turns", async () => {
  await corpus(async (root) => {
    const hits = await collect(opts(root, { role: "user" }));
    expect(hits.length).toBe(1);
    expect(hits[0].turn.role).toBe("user");
  });
});

test("--cwd substring restricts by working directory", async () => {
  await corpus(async (root) => {
    const hits = await collect(opts(root, { cwd: "proj-b" }));
    expect(hits.length).toBe(1);
    expect(hits[0].turn.sessionId).toBe("new");
  });
});

test("--session with no pattern yields every turn of that session", async () => {
  await corpus(async (root) => {
    const hits = await collect(
      opts(root, { pattern: undefined, session: "nomatch" }),
    );
    expect(hits.length).toBe(1);
    expect(hits[0].turn.sessionId).toBe("nomatch");
    // Every line is a match, so the dump renders the whole turn.
    expect(hits[0].matchedLineIndices).toEqual([0]);
  });
});

test("--session with a pattern keeps search semantics inside the session", async () => {
  await corpus(async (root) => {
    const hits = await collect(opts(root, { session: "nomatch" }));
    expect(hits.length).toBe(0);
  });
});

test("--session composes with --role", async () => {
  await corpus(async (root) => {
    const hits = await collect(
      opts(root, { pattern: undefined, session: "o", role: "user" }),
    );
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["old"]);
  });
});

// A subagent transcript lives beside the session's own file and carries the
// PARENT's sessionId, so a dump would splice it into the conversation.
async function corpusWithSubagent(fn) {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-sidechain-"));
  const line = (o) => JSON.stringify(o);
  await writeFile(
    join(dir, "s.jsonl"),
    line({
      type: "user",
      sessionId: "parent",
      timestamp: "2026-07-13T00:00:00Z",
      message: { content: "a needle in the main timeline" },
    }),
  );
  await mkdir(join(dir, "parent", "subagents"), { recursive: true });
  await writeFile(
    join(dir, "parent", "subagents", "agent-x.jsonl"),
    line({
      type: "user",
      sessionId: "parent",
      isSidechain: true,
      timestamp: "2026-07-13T00:01:00Z",
      message: { content: "a needle inside a spawned agent" },
    }),
  );
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("a dump excludes subagent turns that share the parent's session id", async () => {
  await corpusWithSubagent(async (root) => {
    const hits = await collect(
      opts(root, { pattern: undefined, session: "parent" }),
    );
    expect(hits.length).toBe(1);
    expect(hits[0].turn.isSidechain).toBe(false);
  });
});

test("--subagents=include keeps them in the dump", async () => {
  await corpusWithSubagent(async (root) => {
    const hits = await collect(
      opts(root, {
        pattern: undefined,
        session: "parent",
        subagents: "include",
      }),
    );
    expect(hits.length).toBe(2);
  });
});

test("plain search still sees subagent turns", async () => {
  await corpusWithSubagent(async (root) => {
    const hits = await collect(opts(root, {}));
    expect(hits.length).toBe(2);
  });
});

test("--subagents=exclude drops them from a search", async () => {
  await corpusWithSubagent(async (root) => {
    const hits = await collect(opts(root, { subagents: "exclude" }));
    expect(hits.length).toBe(1);
    expect(hits[0].turn.isSidechain).toBe(false);
  });
});

test("--subagents=only keeps just them in a search", async () => {
  await corpusWithSubagent(async (root) => {
    const hits = await collect(opts(root, { subagents: "only" }));
    expect(hits.length).toBe(1);
    expect(hits[0].turn.isSidechain).toBe(true);
  });
});

test("empty root yields no hits, no throw", async () => {
  const hits = await collect(opts("/no/such/dir", {}));
  expect(hits.length).toBe(0);
});

/** Three sessions that all involve `rules/x.md`; only one called a tool on it. */
async function corpusTouchingOneFile(fn) {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-tool-"));
  const line = (o) => JSON.stringify(o);
  const toolUse = (name, input) => ({
    type: "assistant",
    timestamp: "2026-07-13T00:00:00Z",
    message: { content: [{ type: "tool_use", name, input }] },
  });
  await writeFile(
    join(dir, "s.jsonl"),
    [
      line({
        ...toolUse("Edit", {
          file_path: "/proj/rules/x.md",
          old_string: "a",
          new_string: "b",
        }),
        sessionId: "editor",
      }),
      line({
        ...toolUse("Read", { file_path: "/proj/rules/x.md" }),
        sessionId: "reader",
      }),
      line({
        type: "user",
        sessionId: "talker",
        timestamp: "2026-07-13T00:00:00Z",
        message: { content: "we should update rules/x.md some day" },
      }),
    ].join("\n"),
  );
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("--tool + --file finds the session that targeted a file, not the ones that read or mentioned it", async () => {
  await corpusTouchingOneFile(async (root) => {
    const hits = await collect(
      opts(root, {
        pattern: undefined,
        tools: ["Edit", "Write"],
        file: "rules/x.md",
      }),
    );
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["editor"]);
  });
});

test("--tool + --file matches a call whose paired result reported failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-failed-"));
  try {
    await writeFile(
      join(dir, "s.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          sessionId: "tried",
          timestamp: "2026-07-13T00:00:00Z",
          message: {
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "Edit",
                input: { file_path: "/proj/rules/x.md", old_string: "stale" },
              },
            ],
          },
        }),
        JSON.stringify({
          type: "user",
          sessionId: "tried",
          timestamp: "2026-07-13T00:00:01Z",
          message: {
            content: [
              {
                type: "tool_result",
                tool_use_id: "toolu_1",
                is_error: true,
                content: "String to replace not found in file.",
              },
            ],
          },
        }),
      ].join("\n"),
    );
    const hits = await collect(
      opts(dir, { pattern: undefined, tools: ["Edit"], file: "rules/x.md" }),
    );
    // The outcome lives in the paired result, which the filters never read, so
    // the attempt is reported the same as one that landed.
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["tried"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--file alone still separates a tool call from a prose mention", async () => {
  await corpusTouchingOneFile(async (root) => {
    const hits = await collect(
      opts(root, { pattern: undefined, file: "rules/x.md" }),
    );
    expect(hits.map((h) => h.turn.sessionId).sort()).toEqual([
      "editor",
      "reader",
    ]);
  });
});

async function twoFileCorpus(fn) {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-maxcount-"));
  const turn = (sessionId) =>
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp: "2026-07-13T00:00:00Z",
      message: { content: "a needle here" },
    });
  // Two hits per file across two files: a counter that resets per file, or one
  // checked only between files, would still pass a single-file corpus.
  await writeFile(join(dir, "a.jsonl"), [turn("a1"), turn("a2")].join("\n"));
  await writeFile(join(dir, "b.jsonl"), [turn("b1"), turn("b2")].join("\n"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("maxCount caps the hits yielded", async () => {
  await twoFileCorpus(async (root) => {
    expect((await collect(opts(root, { maxCount: 1 }))).length).toBe(1);
    expect((await collect(opts(root, { maxCount: 3 }))).length).toBe(3);
  });
});

test("maxCount counts across files, not per file", async () => {
  await twoFileCorpus(async (root) => {
    const hits = await collect(opts(root, { maxCount: 2 }));
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["a1", "a2"]);
  });
});

test("maxCount above the hit total yields every hit", async () => {
  await twoFileCorpus(async (root) => {
    expect((await collect(opts(root, { maxCount: 99 }))).length).toBe(4);
  });
});

test("maxCount undefined leaves the search uncapped", async () => {
  await twoFileCorpus(async (root) => {
    expect((await collect(opts(root, {}))).length).toBe(4);
  });
});

test("maxCount stops reading rather than filtering after the fact", async () => {
  await twoFileCorpus(async (root) => {
    // The generator must not resume past the cap: pulling one hit under
    // maxCount:1 has to leave it done, not merely stop yielding.
    const it = search(opts(root, { maxCount: 1 }));
    expect((await it.next()).done).toBe(false);
    expect((await it.next()).done).toBe(true);
  });
});

/**
 * One turn per pattern shape that the raw-line prefilter could wrongly reject:
 * the text is escaped in the JSONL (`\"`, `\n`, `\uXXXX`) or reachable only
 * through a separator `textExtract` synthesises, so a prefilter that tested the
 * decoded form against raw bytes would drop these.
 */
async function escapedCorpus(fn) {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-escaped-"));
  const line = (sessionId, content) =>
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp: "2026-07-13T00:00:00Z",
      message: { content },
    });
  await writeFile(
    join(dir, "s.jsonl"),
    [
      line("quoted", 'he said "needle" loudly'),
      line("newline", "before\nneedle after"),
      line("backslash", "path\\to\\needle"),
      line("japanese", "これは needle です"),
      line("slash", "src/needle.ts"),
      JSON.stringify({
        type: "assistant",
        sessionId: "toolinput",
        timestamp: "2026-07-13T00:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: { file_path: "/proj/needle.ts" },
            },
          ],
        },
      }),
    ].join("\n"),
  );
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the prefilter never drops a hit whose text is JSON-escaped", async () => {
  await escapedCorpus(async (root) => {
    const hits = await collect(opts(root, {}));
    expect(hits.map((h) => h.turn.sessionId).sort()).toEqual([
      "backslash",
      "japanese",
      "newline",
      "quoted",
      "slash",
      "toolinput",
    ]);
  });
});

test("a pattern reachable only across a synthesised separator still hits", async () => {
  await escapedCorpus(async (root) => {
    const hits = await collect(opts(root, { pattern: "file_path: /proj" }));
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["toolinput"]);
  });
});

test("a pattern whose only safe run is short still hits", async () => {
  await escapedCorpus(async (root) => {
    const hits = await collect(
      opts(root, { pattern: "これは needle", ignoreCase: true }),
    );
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["japanese"]);
  });
});

// An HTML-escaping serialiser writes ">" as >, so the raw line and the
// decoded text differ on a character the prefilter would otherwise scan for.
test("a hit survives when the JSONL \\u-escapes an ordinary character", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-uescape-"));
  try {
    const BS = String.fromCharCode(92);
    const raw =
      '{"type":"user","sessionId":"esc","timestamp":"2026-07-13T00:00:00Z",' +
      `"message":{"content":"version ${BS}u003e=8.0.15 required"}}`;
    expect(JSON.parse(raw).message.content).toBe("version >=8.0.15 required");
    await writeFile(join(dir, "a.jsonl"), raw + "\n");

    const hits = await collect(opts(dir, { pattern: ">=8.0.15" }));
    expect(hits.map((h) => h.turn.sessionId)).toEqual(["esc"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

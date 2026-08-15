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

test("--include-subagents keeps them in the dump", async () => {
  await corpusWithSubagent(async (root) => {
    const hits = await collect(
      opts(root, {
        pattern: undefined,
        session: "parent",
        includeSubagents: true,
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

test("empty root yields no hits, no throw", async () => {
  const hits = await collect(opts("/no/such/dir", {}));
  expect(hits.length).toBe(0);
});

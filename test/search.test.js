import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("empty root yields no hits, no throw", async () => {
  const hits = await collect(opts("/no/such/dir", {}));
  expect(hits.length).toBe(0);
});

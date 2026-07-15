import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import {
  defaultRoot,
  findTranscripts,
  isReadableDir,
  loadTurns,
} from "../src/loader.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "cc-grep-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadTurns parses user/assistant lines and skips others", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "s.jsonl");
    const lines = [
      JSON.stringify({ type: "queue-operation", operation: {} }),
      JSON.stringify({ type: "summary", summary: "x" }),
      JSON.stringify({
        type: "user",
        sessionId: "sess-1",
        timestamp: "2026-07-10T00:00:00Z",
        cwd: "/proj",
        gitBranch: "main",
        message: { content: "hello world" },
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "sess-1",
        timestamp: "2026-07-10T00:01:00Z",
        message: { content: [{ type: "text", text: "hi back" }] },
      }),
      "{ this is not valid json",
      "",
    ];
    await writeFile(file, lines.join("\n"));

    const turns = [];
    for await (const t of loadTurns(file)) turns.push(t);

    expect(turns.length).toBe(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].sessionId).toBe("sess-1");
    expect(turns[0].cwd).toBe("/proj");
    expect(turns[0].textLines).toEqual(["hello world"]);
    expect(turns[0].timestampMs).toBe(Date.parse("2026-07-10T00:00:00Z"));
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].textLines).toEqual(["hi back"]);
  });
});

test("loadTurns tolerates missing optional fields", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "s.jsonl");
    await writeFile(
      file,
      JSON.stringify({ type: "user", message: { content: "bare" } }) + "\n",
    );
    const turns = [];
    for await (const t of loadTurns(file)) turns.push(t);
    expect(turns.length).toBe(1);
    expect(turns[0].sessionId).toBe(undefined);
    expect(turns[0].timestampMs).toBe(undefined);
    expect(turns[0].isMeta).toBe(false);
  });
});

test("loadTurns on a missing file yields nothing (no throw)", async () => {
  const turns = [];
  for await (const t of loadTurns("/does/not/exist.jsonl")) turns.push(t);
  expect(turns.length).toBe(0);
});

test("findTranscripts recurses and only yields .jsonl", async () => {
  await withTempDir(async (dir) => {
    await mkdir(join(dir, "a", "b"), { recursive: true });
    await writeFile(join(dir, "a", "one.jsonl"), "");
    await writeFile(join(dir, "a", "b", "two.jsonl"), "");
    await writeFile(join(dir, "a", "note.txt"), "");

    const found = [];
    for await (const f of findTranscripts(dir)) found.push(f);
    expect(found.length).toBe(2);
    const names = found.map((f) => f.split("/").pop()).sort();
    expect(names).toEqual(["one.jsonl", "two.jsonl"]);
  });
});

test("findTranscripts on a missing root yields nothing", async () => {
  const found = [];
  for await (const f of findTranscripts("/no/such/root")) found.push(f);
  expect(found.length).toBe(0);
});

test("isReadableDir true for dir, false for missing", async () => {
  await withTempDir(async (dir) => {
    expect(await isReadableDir(dir)).toBe(true);
    expect(await isReadableDir(join(dir, "nope"))).toBe(false);
  });
});

test("defaultRoot honors CC_GREP_ROOT then falls back", () => {
  expect(defaultRoot({ CC_GREP_ROOT: "/env" }, "/home/u")).toBe("/env");
  expect(defaultRoot({}, "/home/u")).toBe("/home/u/.claude/projects");
});

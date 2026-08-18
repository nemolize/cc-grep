import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "dist", "cli.js");

function runCli(args) {
  if (!existsSync(cliPath)) {
    throw new Error(`${cliPath} not found — run \`pnpm run build\` first`);
  }
  return execFileSync("node", [cliPath, ...args], { encoding: "utf8" });
}

test("--version reports the version in package.json", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  expect(runCli(["--version"]).trim()).toBe(pkg.version);
});

function withCorpus(fn) {
  const dir = mkdtempSync(join(tmpdir(), "cc-grep-cli-"));
  const turn = (sessionId, cwd) =>
    JSON.stringify({
      type: "user",
      sessionId,
      timestamp: "2026-07-13T00:00:00Z",
      cwd,
      message: { content: "a needle here" },
    });
  writeFileSync(
    join(dir, "a.jsonl"),
    [turn("aaaaaaaa-1111-2222-3333-444444444444", "/proj-a")].join("\n"),
  );
  writeFileSync(
    join(dir, "b.jsonl"),
    [
      turn("bbbbbbbb-1111-2222-3333-444444444444", "/proj-b"),
      turn("bbbbbbbb-1111-2222-3333-444444444444", "/proj-b"),
    ].join("\n"),
  );
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("--count prints the hit total instead of the hits", () => {
  withCorpus((root) => {
    const out = runCli(["needle", "--root", root, "-c"]);
    expect(out.trim()).toBe("3");
    expect(out).not.toContain("needle here");
  });
});

test("--list-sessions prints one line per session with full ids", () => {
  withCorpus((root) => {
    const lines = runCli(["needle", "--root", root, "-l", "--color", "never"])
      .trim()
      .split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("aaaaaaaa-1111-2222-3333-444444444444");
    expect(lines[0]).toContain("1 hit");
    expect(lines[1]).toContain("2 hits");
  });
});

test("--max-count caps the rendered hits", () => {
  withCorpus((root) => {
    const out = runCli([
      "needle",
      "--root",
      root,
      "-m",
      "1",
      "--color",
      "never",
    ]);
    expect(out.match(/needle here/g).length).toBe(1);
  });
});

test("--json pairs with the summary flags", () => {
  withCorpus((root) => {
    expect(
      JSON.parse(runCli(["needle", "--root", root, "-c", "--json"])),
    ).toEqual({ hits: 3 });

    const rows = runCli(["needle", "--root", root, "-l", "--json"])
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(rows.length).toBe(2);
    expect(rows[1]).toEqual({
      sessionId: "bbbbbbbb-1111-2222-3333-444444444444",
      hits: 2,
      cwd: "/proj-b",
    });
  });
});

test("a summary with no hits still exits 1, like a search", () => {
  withCorpus((root) => {
    expect(() => runCli(["nomatch", "--root", root, "-c"])).toThrow(
      expect.objectContaining({ status: 1 }),
    );
  });
});

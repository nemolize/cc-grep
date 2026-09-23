import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { newCodexFileState, parseCodexLine } from "../src/codex.js";
import { loadTurns } from "../src/loader.js";
import { buildPrefilter } from "../src/prefilter.js";

function record(type, output) {
  return JSON.stringify({ type: "response_item", payload: { type, output } });
}

const cases = [
  [
    "JSON object",
    JSON.stringify({ output: "before\nneedle\nafter", code: 0 }),
    ["{output: before", "needle", "after, code: 0}"],
  ],
  [
    "JSON array",
    JSON.stringify(["before\nneedle", { text: "after" }]),
    ["[before", "needle, {text: after}]"],
  ],
  [
    "JSON string",
    JSON.stringify("before\nneedle\nafter"),
    ["before", "needle", "after"],
  ],
  ["plain text", "before\nneedle\nafter", ["before", "needle", "after"]],
  ["malformed JSON", '{"output":"needle\\n"', ['{"output":"needle\\n"']],
  [
    "literal escapes",
    JSON.stringify({ output: String.raw`needle\nnext\tcolumn` }),
    [String.raw`{output: needle\nnext\tcolumn}`],
  ],
  [
    "nested JSON string",
    JSON.stringify({ output: JSON.stringify({ text: "needle\nnext" }) }),
    ['{output: {"text":"needle\\nnext"}}'],
  ],
  ["number", "1e2", ["100"]],
  ["null", "null", ["null"]],
  ["boolean", "true", ["true"]],
  ["empty text", "", undefined],
  ["empty JSON string", '""', undefined],
  [
    "content blocks",
    [{ type: "input_text", text: "needle\nnext" }],
    ["needle", "next"],
  ],
];

for (const type of ["custom_tool_call_output", "function_call_output"]) {
  test.each(cases)(`${type}: %s`, (_label, output, expected) => {
    const turn = parseCodexLine(
      "fixture.jsonl",
      0,
      record(type, output),
      newCodexFileState(),
    );
    expect(turn?.textLines).toEqual(expected);
    if (turn) {
      expect(turn.role).toBe("user");
      expect(turn.toolCalls).toEqual([]);
    }
  });
}

test.each(["custom_tool_call_output", "function_call_output"])(
  "%s: CLI context selects decoded lines and prefilter preserves synthesized matches",
  async (type) => {
    const dir = await mkdtemp(join(tmpdir(), "cg-output-"));
    const file = join(dir, "rollout.jsonl");
    try {
      await writeFile(
        file,
        record(
          type,
          '{"output":"outside-before\\nbefore\\nneedle\\nafter\\noutside-after","escaped":"\\u0068idden","number":1e2}',
        ),
      );
      const stdout = execFileSync(
        process.execPath,
        [
          "dist/cli.js",
          "^needle$",
          "--regex",
          "--source",
          "codex",
          "--codex-root",
          dir,
          "-C",
          "1",
          "--color",
          "never",
        ],
        {
          encoding: "utf8",
          env: { ...process.env, HOME: "/nonexistent-home" },
        },
      );
      expect(stdout).toContain("before");
      expect(stdout).toContain("needle");
      expect(stdout).toContain("after");
      expect(stdout).not.toContain("outside-before");
      expect(stdout).not.toContain("outside-after");
      for (const pattern of [
        "hidden",
        "number: 100",
        "output: outside-before",
      ]) {
        const prefilter = buildPrefilter({
          pattern,
          regex: false,
          fixed: true,
          ignoreCase: false,
        });
        const turns = [];
        for await (const turn of loadTurns(file, prefilter, "codex"))
          turns.push(turn);
        expect(turns).toHaveLength(1);
        expect(turns[0].textLines.some((line) => line.includes(pattern))).toBe(
          true,
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

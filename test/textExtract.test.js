import { expect, test } from "vitest";

import { extractTextLines } from "../src/textExtract.js";

test("plain string content", () => {
  expect(extractTextLines("hello world")).toEqual(["hello world"]);
});

test("multiline string splits into lines", () => {
  expect(extractTextLines("a\nb\nc")).toEqual(["a", "b", "c"]);
});

test("text block array", () => {
  const content = [
    { type: "text", text: "first" },
    { type: "text", text: "second" },
  ];
  expect(extractTextLines(content)).toEqual(["first", "second"]);
});

test("thinking block is searchable", () => {
  expect(extractTextLines([{ type: "thinking", thinking: "hmm" }])).toEqual([
    "hmm",
  ]);
});

test("tool_use serializes input to JSON", () => {
  const lines = extractTextLines([
    { type: "tool_use", name: "Bash", input: { command: "ls -la" } },
  ]);
  expect(lines.length).toBe(1);
  expect(lines[0]).toMatch(/ls -la/);
});

test("tool_result with string content", () => {
  expect(
    extractTextLines([{ type: "tool_result", content: "output here" }]),
  ).toEqual(["output here"]);
});

test("tool_result with nested text-block array", () => {
  const content = [
    { type: "tool_result", content: [{ type: "text", text: "nested out" }] },
  ];
  expect(extractTextLines(content)).toEqual(["nested out"]);
});

test("image block yields nothing", () => {
  expect(extractTextLines([{ type: "image", source: {} }])).toEqual([]);
});

test("unknown block falls back to a text field if present", () => {
  expect(extractTextLines([{ type: "future_kind", text: "salvaged" }])).toEqual(
    ["salvaged"],
  );
});

test("unrecognised shapes are skipped, not thrown", () => {
  expect(extractTextLines(null)).toEqual([]);
  expect(extractTextLines(undefined)).toEqual([]);
  expect(extractTextLines(42)).toEqual([]);
  expect(extractTextLines([{ type: "tool_use" }])).toEqual([]);
});

test("empty strings are dropped", () => {
  expect(extractTextLines([{ type: "text", text: "" }])).toEqual([]);
});

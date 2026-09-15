import { expect, test } from "vitest";

import { newCodexFileState, parseCodexLine } from "../src/codex.js";
import { buildMatcher } from "../src/matcher.js";
import { buildPrefilter } from "../src/prefilter.js";
import { extractTextLines } from "../src/textExtract.js";

/**
 * The prefilter's safety rests on knowing every way the text the matcher sees
 * can differ from the raw line's bytes, and four separate holes shipped because
 * that list was maintained by hand. This searches for counter-examples instead:
 * for each raw line it derives what the matcher would see, takes patterns from
 * that text, and asserts the prefilter accepts whenever the matcher matches.
 *
 * A failure here names the exact raw line and pattern, so a future change to
 * `textExtract` that mints a new divergence fails with a repro rather than
 * silently losing hits.
 */

function opts(over) {
  return {
    regex: false,
    fixed: false,
    ignoreCase: false,
    root: "/r",
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

const BS = String.fromCharCode(92);

/** Raw JSONL lines chosen so the decoded text diverges from the bytes. */
const RAW_LINES = [
  `{"type":"user","message":{"content":"plain ratatui text"}}`,
  `{"type":"user","message":{"content":"escaped ${BS}u003e=8.0.15 here"}}`,
  `{"type":"user","message":{"content":"${BS}u0072atatui leading"}}`,
  `{"type":"user","message":{"content":"quote ${BS}"inner${BS}" done"}}`,
  `{"type":"user","message":{"content":"tab${BS}tsep and nl${BS}nsplit"}}`,
  `{"type":"user","message":{"content":"backslash ${BS}${BS} literal"}}`,
  `{"type":"user","message":{"content":"unicode ワークツリー here"}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"T","input":{"count":1e2}}]}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"T","input":{"count":1e400}}]}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"T","input":{"count":1e21}}]}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"T","input":{"flag":true,"other":false}}]}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"T","input":{"nested":{"deep":[1,2,"x"]}}}]}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"T","input":{"n":null}}]}}`,
  `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/a/b.ts","old_string":"x"}}]}}`,
  `{"type":"user","message":{"content":[{"type":"text","text":"multi${BS}nline body"}]}}`,
  `{"type":"user","message":{"content":[{"type":"thinking","thinking":"a thought 1.50 deep"}]}}`,
];

/** Every substring of the decoded text is a pattern the matcher would match. */
function* patternsFrom(text) {
  for (let start = 0; start < text.length; start++) {
    for (let len = 1; len <= text.length - start; len++) {
      yield text.slice(start, start + len);
    }
  }
}

for (const ignoreCase of [false, true]) {
  test(`prefilter accepts every line the matcher matches (ignoreCase=${String(ignoreCase)})`, () => {
    const violations = [];

    for (const raw of RAW_LINES) {
      let decoded;
      try {
        decoded = JSON.parse(raw);
      } catch {
        continue;
      }
      const lines = extractTextLines(decoded.message.content);

      for (const line of lines) {
        for (const pattern of patternsFrom(line)) {
          const cased = ignoreCase ? pattern.toUpperCase() : pattern;
          const o = opts({ pattern: cased, ignoreCase });
          const matcher = buildMatcher(o);
          if (!lines.some((l) => matcher.test(l))) continue;

          if (!buildPrefilter(o).test(raw)) {
            violations.push({ raw, pattern: cased });
          }
        }
      }
    }

    expect(violations.slice(0, 5)).toEqual([]);
  });
}

/**
 * The Codex parser renders lines of its own, so it can diverge from the raw
 * bytes exactly as `textExtract` can, and as silently.
 */
const CODEX_RAW_LINES = [
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"plain ratatui text"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"escaped ${BS}u003e=8.0.15 here"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"${BS}u0072atatui leading"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"quote ${BS}"inner${BS}" done"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"tab${BS}tsep and nl${BS}nsplit"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"backslash ${BS}${BS} literal"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"unicode ワークツリー here"}]}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"tools.exec_command({cmd:${BS}"rg ratatui${BS}"})"}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"first${BS}nsecond 1.50 line"}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"function_call","name":"send_message","arguments":"{${BS}"target${BS}":${BS}"/root${BS}"}"}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call_output","output":"exit_code 0${BS}noutput ratatui"}}`,
  `{"timestamp":"2026-07-12T00:00:00Z","type":"response_item","payload":{"type":"custom_tool_call_output","output":[{"type":"input_text","text":"array ${BS}u003c form"}]}}`,
];

for (const ignoreCase of [false, true]) {
  test(`the codex parser keeps the prefilter a superset (ignoreCase=${String(ignoreCase)})`, () => {
    const violations = [];

    for (const raw of CODEX_RAW_LINES) {
      const state = newCodexFileState();
      const turn = parseCodexLine("/f.jsonl", 0, raw, state);
      if (turn === undefined) continue;
      const lines = turn.textLines;

      for (const line of lines) {
        for (const pattern of patternsFrom(line)) {
          const cased = ignoreCase ? pattern.toUpperCase() : pattern;
          const o = opts({ pattern: cased, ignoreCase });
          const matcher = buildMatcher(o);
          if (!lines.some((l) => matcher.test(l))) continue;

          if (!buildPrefilter(o).test(raw)) {
            violations.push({ raw, pattern: cased });
          }
        }
      }
    }

    expect(violations.slice(0, 5)).toEqual([]);
  });
}

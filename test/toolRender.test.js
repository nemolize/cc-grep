import { expect, test } from "vitest";

import { extractTextLines } from "../src/textExtract.js";
import { decorateToolLines } from "../src/toolRender.js";

// Decoration re-parses what extraction emits; without a test spanning both, a
// format change passes each suite while silently turning decoration off.
test("decoration applies to real extractTextLines output", () => {
  const lines = extractTextLines([
    {
      type: "tool_use",
      name: "Edit",
      input: {
        replace_all: false,
        file_path: "/tmp/x",
        old_string: "before",
        new_string: "after",
      },
    },
  ]);
  const dec = decorateToolLines(lines);
  expect(dec[0].toolName).toBe("Edit");
  expect(dec[1].suppressed).toBe(true);
  expect(lines.map((l, i) => dec[i]?.text ?? l)).toEqual([
    "[Edit]",
    "replace_all: false",
    "file_path: /tmp/x",
    "- before",
    "+ after",
  ]);
});

test("the tool header carries its name and is lifted out of the body", () => {
  const [header] = decorateToolLines(["⚙ Edit", "file_path: /tmp/x"]);
  expect(header.toolName).toBe("Edit");
  expect(header.suppressed).toBe(true);
});

test("old_string and new_string become diff sides", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "old_string: before",
    "new_string: after",
  ]);
  expect(dec[1].text).toBe("- before");
  expect(dec[2].text).toBe("+ after");
});

test("a diff value's continuation lines keep the marker", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "new_string: line one",
    "line two",
    "line three",
  ]);
  expect(dec[1].text).toBe("+ line one");
  expect(dec[2].text).toBe("+ line two");
  expect(dec[3].text).toBe("+ line three");
});

test("a following field ends the previous field's continuation run", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "old_string: gone",
    "file_path: /tmp/x",
    "trailing",
  ]);
  expect(dec[1].text).toBe("- gone");
  expect(dec[2]).toBe(undefined);
  expect(dec[3]).toBe(undefined);
});

test("replace_all is suppressed on an Edit but is not a field elsewhere", () => {
  const edit = decorateToolLines(["⚙ Edit", "replace_all: false"]);
  expect(edit[1].suppressed).toBe(true);

  const bash = decorateToolLines(["⚙ Bash", "replace_all: false"]);
  expect(bash[1]).toBe(undefined);
});

// Tool names and field keys are arbitrary transcript data, so a name colliding
// with a prototype member must not reach one.
test("a tool named after a prototype member neither throws nor decorates", () => {
  const dec = decorateToolLines(["⚙ constructor", "replace_all: x"]);
  expect(dec[0].toolName).toBe("constructor");
  expect(dec[1]).toBe(undefined);
});

test("a field key named after a prototype member is not a marker", () => {
  const dec = decorateToolLines(["⚙ Edit", "constructor: x"]);
  expect(dec[1]).toBe(undefined);
});

test("diff markers apply only to the tools that declare them", () => {
  const dec = decorateToolLines(["⚙ Bash", "old_string: not an edit"]);
  expect(dec[1]).toBe(undefined);
});

// The extracted form cannot say where a value's own newlines were, so edited
// content holding `key: value` lines is the ambiguity the block state resolves.
test("an unknown key inside a value continues it instead of ending it", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "old_string: name: app",
    "port: 80",
  ]);
  expect(dec[1].text).toBe("- name: app");
  expect(dec[2].text).toBe("- port: 80");
});

// `replace_all` is optional, so content holding that line can be its FIRST
// occurrence — suppressing it would delete a line of the edited file.
// MultiEdit nests its strings in an `edits` array, so Edit's field names only
// ever appear inside content — sharing its profile hid the lines below them.
test("MultiEdit content is not read as Edit's arguments", () => {
  const dec = decorateToolLines([
    "⚙ MultiEdit",
    "file_path: /x",
    "edits: [{old_string: keepme",
    "replace_all: false",
    "visible tail, new_string: newval}]",
  ]);
  expect(dec[3]?.suppressed).toBe(undefined);
  expect(dec[4]?.suppressed).toBe(undefined);
  expect(dec[4]?.text).toBe(undefined);
});

test("content is never suppressed once a value has started", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "old_string: a",
    "replace_all: true",
    "x",
  ]);
  expect(dec[2]?.suppressed).toBe(undefined);
  expect(dec[3]?.suppressed).toBe(undefined);
});

test("a repeated field is content, so it neither hides lines nor flips the marker", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "replace_all: false",
    "old_string: a",
    "replace_all: true",
    "old_string: b",
  ]);
  expect(dec[3].text).toBe("- replace_all: true");
  expect(dec[3].suppressed).toBe(undefined);
  expect(dec[4].text).toBe("- old_string: b");
});

test("a suppressed field's continuation lines are suppressed too", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "replace_all: false",
    "spillover",
    "file_path: /tmp/x",
  ]);
  expect(dec[2].suppressed).toBe(true);
  expect(dec[3]).toBe(undefined);
});

test("a blank line ends the block so prose is never reinterpreted", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "old_string: inside",
    "",
    "new_string: this is prose, not a field",
  ]);
  expect(dec[1].text).toBe("- inside");
  expect(dec[3]).toBe(undefined);
});

test("lines before any tool header are left alone", () => {
  const dec = decorateToolLines(["old_string: prose", "⚙ Edit"]);
  expect(dec[0]).toBe(undefined);
});

test("a key containing a space is prose, not a field", () => {
  const dec = decorateToolLines(["⚙ Bash", "Note this: not a field"]);
  expect(dec[1]).toBe(undefined);
});

test("a second tool block resets the diff marker", () => {
  const dec = decorateToolLines([
    "⚙ Edit",
    "new_string: added",
    "⚙ Bash",
    "still bash body",
  ]);
  expect(dec[1].text).toBe("+ added");
  expect(dec[2].toolName).toBe("Bash");
  expect(dec[3]).toBe(undefined);
});

test("an empty-valued field is recognised rather than read as a body line", () => {
  const dec = decorateToolLines(["⚙ Edit", "new_string:", "body"]);
  expect(dec[1].text).toBe("+ ");
  expect(dec[2].text).toBe("+ body");
});

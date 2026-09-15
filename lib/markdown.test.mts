// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/markdown.test.mts
import assert from "node:assert/strict";
import { parseInline, parseMarkdown, stripMarkdown, type InlineNode } from "./markdown";

const t = (value: string): InlineNode => ({ type: "text", value });

// ─── Inline ───────────────────────────────────────────────────────────────

assert.deepEqual(parseInline("**bold**"), [{ type: "bold", children: [t("bold")] }]);
assert.deepEqual(parseInline("*it* and _it_"), [
  { type: "italic", children: [t("it")] },
  t(" and "),
  { type: "italic", children: [t("it")] },
]);
assert.deepEqual(parseInline("__under__ ~~gone~~ ||secret||"), [
  { type: "underline", children: [t("under")] },
  t(" "),
  { type: "strike", children: [t("gone")] },
  t(" "),
  { type: "spoiler", children: [t("secret")] },
]);
assert.deepEqual(parseInline("`a *b* c`"), [{ type: "code", value: "a *b* c" }], "nothing inside code is formatting");
assert.deepEqual(parseInline("***both***"), [{ type: "bold", children: [{ type: "italic", children: [t("both")] }] }]);
assert.deepEqual(parseInline("*a **b** c*"), [
  { type: "italic", children: [t("a "), { type: "bold", children: [t("b")] }, t(" c")] },
]);

// Unclosed marks are just characters.
assert.deepEqual(parseInline("2 * 3 = 6"), [t("2 * 3 = 6")]);
assert.deepEqual(parseInline("**open"), [t("**open")]);

// Escapes.
assert.deepEqual(parseInline("\\*not italic\\*"), [t("*not italic*")]);

// Underscores inside words stay as typed — names and snake_case.
assert.deepEqual(parseInline("hi @joao_silva and my_var_name"), [t("hi @joao_silva and my_var_name")]);

// Links and tokens are never formatting, and stay whole for the caller.
assert.deepEqual(parseInline("see https://x.com/a_b_c_d now"), [t("see https://x.com/a_b_c_d now")]);
assert.deepEqual(parseInline("*hey <@user_1> there*"), [{ type: "italic", children: [t("hey <@user_1> there")] }]);

// Masked links.
assert.deepEqual(parseInline("[the **docs**](https://example.com/x)"), [
  { type: "link", url: "https://example.com/x", children: [t("the "), { type: "bold", children: [t("docs")] }] },
]);
assert.deepEqual(parseInline("[bad](javascript:alert(1))"), [t("[bad](javascript:alert(1))")], "only http(s)");

// ─── Blocks ───────────────────────────────────────────────────────────────

assert.deepEqual(parseMarkdown("```js\nconst a = 1;\n```"), [{ type: "codeBlock", lang: "js", value: "const a = 1;" }]);
assert.deepEqual(parseMarkdown("```one line```"), [{ type: "codeBlock", lang: null, value: "one line" }]);
assert.deepEqual(parseMarkdown("before\n```py\nx = 1\n```\nafter"), [
  { type: "paragraph", children: [t("before")] },
  { type: "codeBlock", lang: "py", value: "x = 1" },
  { type: "paragraph", children: [t("after")] },
]);
assert.deepEqual(parseMarkdown("``` ```"), [{ type: "paragraph", children: [t("``` ```")] }], "empty fence is text");

assert.deepEqual(parseMarkdown("# Big\n## Mid\n### Small\n-# tiny"), [
  { type: "heading", level: 1, children: [t("Big")] },
  { type: "heading", level: 2, children: [t("Mid")] },
  { type: "heading", level: 3, children: [t("Small")] },
  { type: "subtext", children: [t("tiny")] },
]);
assert.deepEqual(parseMarkdown("#hashtag"), [{ type: "paragraph", children: [t("#hashtag")] }], "needs the space");

assert.deepEqual(parseMarkdown("> quoted\n> **still**\nnot"), [
  {
    type: "quote",
    children: [{ type: "paragraph", children: [t("quoted\n"), { type: "bold", children: [t("still")] }] }],
  },
  { type: "paragraph", children: [t("not")] },
]);
assert.deepEqual(parseMarkdown(">>> all\nof this"), [
  { type: "quote", children: [{ type: "paragraph", children: [t("all\nof this")] }] },
]);

assert.deepEqual(parseMarkdown("- one\n- *two*\n1. a\n2. b"), [
  { type: "list", ordered: false, start: 1, items: [[t("one")], [{ type: "italic", children: [t("two")] }]] },
  { type: "list", ordered: true, start: 1, items: [[t("a")], [t("b")]] },
]);

// Plain text is one paragraph, newlines kept.
assert.deepEqual(parseMarkdown("line 1\nline 2"), [{ type: "paragraph", children: [t("line 1\nline 2")] }]);

// ─── Plain text ───────────────────────────────────────────────────────────

assert.equal(stripMarkdown("**bold** and `code` ||x||"), "bold and code ▒▒▒");

console.log("markdown: ok");

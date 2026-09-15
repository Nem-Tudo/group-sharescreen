// node --import ./lib/ts-resolve.mjs --experimental-strip-types lib/codeHighlight.test.mts
import assert from "node:assert/strict";
import { highlightCode, isHighlighted } from "./codeHighlight";

const typed = (code: string, lang: string) =>
  highlightCode(code, lang)
    .filter((token) => token.type)
    .map((token) => `${token.type}:${token.value}`);

assert.deepEqual(typed('const x = "a // b"; // note', "js"), ["keyword:const", 'string:"a // b"', "comment:// note"]);
assert.deepEqual(typed("def f(n):\n    return n + 1  # add", "py"), ["keyword:def", "func:f", "keyword:return", "number:1", "comment:# add"]);
assert.deepEqual(typed('{"a": true, "b": 12}', "json"), ['string:"a"', "literal:true", 'string:"b"', "number:12"]);
assert.deepEqual(typed('<a href="/x">hi</a>', "html"), ["tag:<a", "attr:href", 'string:"/x"', "tag:>", "tag:</a", "tag:>"]);
assert.deepEqual(typed("+new\n-old\n same", "diff"), ["added:+new\n", "removed:-old\n"]);

// Nothing is lost: the tokens put back together are the code.
const code = "fn main() {\n  let s = \"x\\\"y\"; /* c */ 0x1F\n}";
assert.equal(highlightCode(code, "rust").map((token) => token.value).join(""), code);

// "x1" is a name, not a number followed by a name.
assert.deepEqual(typed("x1 = 2", "python"), ["number:2"]);

assert.equal(isHighlighted("tsx"), true);
assert.equal(isHighlighted("brainfuck"), false);
assert.deepEqual(highlightCode("anything", null), [{ type: null, value: "anything" }]);

console.log("codeHighlight: ok");

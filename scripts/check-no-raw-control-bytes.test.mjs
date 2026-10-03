import assert from "node:assert/strict";
import test from "node:test";

import { findRawControlBytes } from "./check-no-raw-control-bytes.mjs";

test("flags a raw NUL, ESC or DEL with its line", () => {
  const src = Buffer.from("const a = 1;\nconst k = `${x}\u0000${y}`;\nconst e = '\u001b';\nconst d = '\u007f';\n", "utf8");
  assert.deepEqual(findRawControlBytes(src), [
    { line: 2, byte: "0x00" },
    { line: 3, byte: "0x1b" },
    { line: 4, byte: "0x7f" },
  ]);
});

test("allows tab, CR and LF, and the escaped spellings", () => {
  const src = Buffer.from("const t = 'a\tb';\r\nconst k = `${x}\\x00${y}`;\nconst r = /[\\x00-\\x1f]/;\n", "utf8");
  assert.deepEqual(findRawControlBytes(src), []);
});

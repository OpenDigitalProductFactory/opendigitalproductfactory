import assert from "node:assert/strict";
import { test } from "node:test";
import { scriptArgv } from "./script-argv.mjs";

test("drops exactly one leading `--`, the one pnpm forwards", () => {
  assert.deepEqual(scriptArgv(["--", "--json"]), ["--json"]);
  assert.deepEqual(scriptArgv(["--json"]), ["--json"]);
  assert.deepEqual(scriptArgv([]), []);
  // A later `--` still ends option parsing.
  assert.deepEqual(scriptArgv(["--json", "--", "x"]), ["--json", "--", "x"]);
  assert.deepEqual(scriptArgv(["--", "--", "x"]), ["--", "x"]);
});

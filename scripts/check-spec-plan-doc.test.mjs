// scripts/check-spec-plan-doc.test.mjs
// BI-1DF0BF51 — twin of BI-B6433DC6. The script is top-level (it runs on
// import), so this is a spawn of the CLI, not an imported helper.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("an unresolvable BASE_SHA must not exit 0 claiming nothing to gate (BI-1DF0BF51)", () => {
  const script = fileURLToPath(new URL("./check-spec-plan-doc.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    cwd: path.resolve(path.dirname(script), ".."),
    env: { ...process.env, BASE_SHA: "origin/this-ref-does-not-exist-1df0bf51" },
  });
  const out = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, `must not exit 0 when the base ref is missing; output:\n${out}`);
  assert.doesNotMatch(out, /nothing to gate/);
  assert.match(out, /cannot resolve|did not run/i);
  assert.match(out, /git fetch --deepen/);
});

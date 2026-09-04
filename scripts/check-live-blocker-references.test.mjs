// scripts/check-live-blocker-references.test.mjs
//
// BI-38A353B2. The guard's whole value is that it bites on an instruction and
// stays silent on provenance — a closed id recorded in a comment is the
// desirable case, so a guard that flags it would be an over-reporting measure,
// which is itself a defect.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractLiveBlockerCitations,
  interpretStatus,
  parseBlockerBaseline,
  serializeBlockerBaseline,
  TERMINAL_STATUSES,
} from "./check-live-blocker-references.mjs";

test("flags a backlog id cited as a blocker inside user-facing text", () => {
  const source = 'return { error: "Blocked — cite BI-B9403248 for the blocked receipt." };';
  assert.deepEqual(extractLiveBlockerCitations(source), ["BI-B9403248"]);
});

test("ignores a backlog id recorded as provenance in a comment", () => {
  const source = [
    "// BI-B9403248: this used to fail opaquely; see EP-1C37C089 for the program.",
    " * Fixed in BI-B9403248 — cite it nowhere.",
    "/* blocked by BI-B9403248 historically */",
    'const message = "Plan coverage needs a scope baseline.";',
  ].join("\n");
  assert.deepEqual(extractLiveBlockerCitations(source), []);
});

test("ignores a trailing line comment on a line of code", () => {
  const source = 'const x = "no ids here"; // see BI-B9403248 for why';
  assert.deepEqual(extractLiveBlockerCitations(source), []);
});

test("ignores a string that merely mentions an id without instructing the reader", () => {
  const source = 'log(`coverage receipt for BI-C7E2E924 recorded`);';
  assert.deepEqual(extractLiveBlockerCitations(source), []);
});

test("reads a terminal status as terminal and anything else as live", () => {
  for (const status of TERMINAL_STATUSES) {
    const body = JSON.stringify({ result: { itemId: "BI-AAAAAAAA", status } });
    assert.equal(interpretStatus("BI-AAAAAAAA", body), "terminal");
  }
  const open = JSON.stringify({ result: { itemId: "BI-AAAAAAAA", status: "triaging" } });
  assert.equal(interpretStatus("BI-AAAAAAAA", open), "live");
});

test("never reports terminal from an unusable response", () => {
  assert.equal(interpretStatus("BI-AAAAAAAA", "not json"), "unknown");
  assert.equal(interpretStatus("BI-AAAAAAAA", JSON.stringify({ error: { code: -32000 } })), "unknown");
  // A response about a DIFFERENT item is not evidence about this one.
  assert.equal(interpretStatus("BI-AAAAAAAA", JSON.stringify({ result: { itemId: "BI-BBBBBBBB", status: "done" } })), "unknown");
  assert.equal(interpretStatus("BI-AAAAAAAA", JSON.stringify({ result: { itemId: "BI-AAAAAAAA" } })), "unknown");
});

test("baseline round-trips", () => {
  const pairs = [{ file: "apps/web/b.ts", id: "BI-00000002" }, { file: "apps/web/a.ts", id: "BI-00000001" }];
  const parsed = parseBlockerBaseline(serializeBlockerBaseline(pairs));
  assert.ok(parsed.has("apps/web/a.ts\tBI-00000001"));
  assert.ok(parsed.has("apps/web/b.ts\tBI-00000002"));
  assert.equal(parsed.size, 2);
});

test("an unresolvable BASE_SHA must not exit 0 with OK (BI-B263E76C)", () => {
  const script = fileURLToPath(new URL("./check-live-blocker-references.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    cwd: path.resolve(path.dirname(script), ".."),
    env: { ...process.env, BASE_SHA: "origin/this-ref-does-not-exist-b263e76c" },
  });
  const out = `${result.stdout}${result.stderr}`;
  assert.notEqual(result.status, 0, `must not exit 0 when the base ref is missing; output:\n${out}`);
  assert.doesNotMatch(out, /\bOK\.\s*$/m);
  assert.match(out, /cannot resolve|did not run/i);
  assert.match(out, /git fetch --deepen/);
});

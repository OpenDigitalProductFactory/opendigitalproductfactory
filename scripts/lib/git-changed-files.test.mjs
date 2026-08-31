import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { listChangedFiles } from "./git-changed-files.mjs";
import { runGate as runDataImpactGate } from "../check-data-impact.mjs";

test("listChangedFiles: an unresolvable base is not an empty diff (BI-20599979)", () => {
  const git = (args) => {
    if (args[0] === "rev-parse") {
      return { ok: false, stdout: "", stderr: "fatal: Needed a single revision" };
    }
    return { ok: true, stdout: "" };
  };
  const result = listChangedFiles("origin/main", { git });
  assert.equal(result.status, "unresolvable");
  assert.deepEqual(result.files, []);
});

test("listChangedFiles: a resolved ref with no files is empty, not unresolvable", () => {
  const git = (args) => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "abc123\n" };
    return { ok: true, stdout: "" };
  };
  const result = listChangedFiles("origin/main", { git });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.files, []);
});

test("data-impact runGate names an unresolvable base instead of throwing (BI-E742EC69)", () => {
  const result = runDataImpactGate({ base: "origin/this-ref-does-not-exist-e742ec69" });
  assert.equal(result.ok, false);
  assert.match(result.message, /cannot resolve/);
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MISSING = "origin/this-ref-does-not-exist-guard-honesty-sweep";

function spawnGuard(rel) {
  return spawnSync(process.execPath, [path.join(ROOT, rel)], {
    encoding: "utf8",
    cwd: ROOT,
    // Run the diff-scoped guard in its applicable PR mode.  CI's merge_group
    // event otherwise makes seed-fit legitimately exit 0 before it resolves
    // BASE_SHA, masking the unresolvable-base contract this fixture checks.
    env: { ...process.env, BASE_SHA: MISSING, GITHUB_EVENT_NAME: "pull_request" },
  });
}

const CLI_CASES = [
  ["scripts/check-docs-impact.mjs", "docs-impact-gate", "BI-39B7276B"],
  ["scripts/check-ux-fit-decision.mjs", "ux-fit-gate", "BI-37690A7F"],
  ["scripts/check-design-grounding-decision.mjs", "design-grounding-gate", "BI-13CBE1FC"],
  ["scripts/check-spec-status-frontmatter.mjs", "spec-status", "BI-63D31C4E"],
  ["scripts/check-seed-fit-decision.mjs", "seed-fit-gate", "BI-562C8D0E"],
  ["scripts/check-plan-backlog-coverage.mjs", "plan-backlog-coverage-gate", "BI-703082B4"],
  ["scripts/check-spec-plan-doc.mjs", "spec-plan-doc-gate", "BI-6F3BAD84"],
];

for (const [rel, prefix, bi] of CLI_CASES) {
  test(`${prefix} must not pass when BASE_SHA is unresolvable (${bi})`, () => {
    const result = spawnGuard(rel);
    const out = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, `must not exit 0; output:\n${out}`);
    assert.match(out, /cannot resolve|did not run/i);
    assert.doesNotMatch(out, /\bOK\.\s*$/m);
  });
}

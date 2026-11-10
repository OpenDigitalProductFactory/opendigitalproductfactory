import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { listChangedFiles } from "./git-changed-files.mjs";
import { runGate as runDataImpactGate } from "../check-data-impact.mjs";

test("listChangedFiles: diffArgs selectors reach git, and still fail unresolvable", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === "rev-parse") return { ok: true, stdout: "sha\n" };
    return { ok: true, stdout: "a.ts\nb.ts\n" };
  };
  const result = listChangedFiles("origin/main", { git, diffArgs: ["--diff-filter=AM"] });
  assert.equal(result.status, "ok");
  assert.deepEqual(result.files, ["a.ts", "b.ts"]);
  const diffCall = calls.find((c) => c[0] === "diff");
  assert.ok(diffCall.includes("--diff-filter=AM"), `selector missing: ${diffCall.join(" ")}`);
  // The selector must precede the range, or git treats it as a path argument.
  assert.ok(
    diffCall.indexOf("--diff-filter=AM") < diffCall.indexOf("origin/main...HEAD"),
    `selector must come before the range: ${diffCall.join(" ")}`,
  );

  const failing = listChangedFiles("origin/main", {
    git: (args) =>
      args[0] === "rev-parse"
        ? { ok: true, stdout: "sha\n" }
        : { ok: false, stdout: "", stderr: "fatal: no merge base" },
    diffArgs: ["--diff-filter=AM"],
  });
  assert.equal(failing.status, "unresolvable");
});

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
  // The two --diff-filter=AM holdouts: they kept their own swallowing `git()`
  // wrapper, so an unresolvable base read as "no test files changed" /
  // "no runtime modules changed" and reported conformant.
  ["scripts/check-test-clock-bombs.mjs", "clock-bomb-guard", "BI-B6433DC6"],
  ["scripts/check-work-unit-conformance.mjs", "work-unit-conformance", "BI-B6433DC6"],
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

test("listChangedFiles: DPF_GATE_INCLUDE_WORKING_TREE=1 unions the committed diff with staged, unstaged and untracked files", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "rev-parse") return { ok: true, stdout: "abc\n", stderr: "" };
    if (args[0] === "diff" && args.at(-1) === "origin/main...HEAD") return { ok: true, stdout: "a.ts\nb.ts\n", stderr: "" };
    if (args[0] === "diff" && args.at(-1) === "HEAD") return { ok: true, stdout: "b.ts\nc.ts\n", stderr: "" };
    if (args[0] === "ls-files") return { ok: true, stdout: "d.json\n", stderr: "" };
    return { ok: false, stdout: "", stderr: "unexpected" };
  };
  const committedOnly = listChangedFiles("origin/main", { git, env: {} });
  assert.deepEqual(committedOnly.files, ["a.ts", "b.ts"]);
  const withTree = listChangedFiles("origin/main", { git, env: { DPF_GATE_INCLUDE_WORKING_TREE: "1" } });
  assert.deepEqual(withTree, { status: "ok", files: ["a.ts", "b.ts", "c.ts", "d.json"], detail: "" });
  assert.ok(calls.includes("ls-files --others --exclude-standard"));
});

test("listChangedFiles: a working-tree read that fails is unresolvable, never an empty union", () => {
  const git = (args) => {
    if (args[0] === "rev-parse") return { ok: true, stdout: "abc\n", stderr: "" };
    if (args[0] === "diff" && args.at(-1) === "origin/main...HEAD") return { ok: true, stdout: "a.ts\n", stderr: "" };
    return { ok: false, stdout: "", stderr: "index locked" };
  };
  const listed = listChangedFiles("origin/main", { git, env: { DPF_GATE_INCLUDE_WORKING_TREE: "1" } });
  assert.equal(listed.status, "unresolvable");
  assert.match(listed.detail, /index locked/);
});

// scripts/check-staged-scope.test.mjs — BI-66236024
import assert from "node:assert/strict";
import { test } from "node:test";

import { ALWAYS_ALLOWED, classifyStagedScope, editClaimedPaths } from "./lib/staged-scope.mjs";
import { formatReport } from "./check-staged-scope.mjs";

const CLAIM = [
  { kind: "path", value: "apps/web/lib/observability", intent: "edit" },
  { kind: "path", value: "docs/operations", intent: "read" },
  { kind: "module", value: "something", intent: "edit" },
];

test("only path claims with edit intent count as scope", () => {
  assert.deepEqual(editClaimedPaths(CLAIM), ["apps/web/lib/observability"]);
});

test("a trailing slash and a leading ./ are the same claim", () => {
  assert.deepEqual(
    editClaimedPaths([{ kind: "path", value: "./scripts/lib/", intent: "edit" }]),
    ["scripts/lib"],
  );
});

test("the September contamination is a violation", () => {
  // The actual file a blanket `git add -A` swept into an observability branch.
  const out = classifyStagedScope({
    stagedPaths: [
      "apps/web/lib/observability/monitor-source-reachability.ts",
      "apps/web/lib/change-review/semantic-change-review-operation.test.ts",
    ],
    scopePaths: editClaimedPaths(CLAIM),
  });
  assert.equal(out.active, true);
  assert.deepEqual(out.violations, ["apps/web/lib/change-review/semantic-change-review-operation.test.ts"]);
});

test("a path claim covers its subtree but not a sibling with the same prefix", () => {
  const scopePaths = ["apps/web/lib/obs"];
  const out = classifyStagedScope({ stagedPaths: ["apps/web/lib/observability/x.ts"], scopePaths });
  assert.deepEqual(out.violations, ["apps/web/lib/observability/x.ts"], "obs/ must not match observability/");
});

test("derived artifacts the hook itself stages are always allowed", () => {
  const out = classifyStagedScope({
    stagedPaths: [...ALWAYS_ALLOWED.filter((p) => !p.endsWith("/")), "docs/user-guide/assets/diagrams/a.svg"],
    scopePaths: ["apps/web/lib/observability"],
  });
  assert.deepEqual(out.violations, [], "refusing these would refuse the pre-commit hook's own work");
});

test("no claimed scope reports INACTIVE and never a pass", () => {
  for (const scopePaths of [null, [], undefined]) {
    const out = classifyStagedScope({ stagedPaths: ["anything.ts"], scopePaths });
    assert.equal(out.active, false);
    assert.equal(out.violations.length, 0);
    const report = formatReport(out, { enforcing: true });
    assert.equal(report.exitCode, 0, "inactive must not block");
    assert.match(report.lines[0], /INACTIVE/, "an off gate must say so, never print nothing");
  }
});

test("advisory mode reports violations without blocking; enforcing mode blocks", () => {
  const out = classifyStagedScope({ stagedPaths: ["other/thing.ts"], scopePaths: ["scripts"] });
  const advisory = formatReport(out, { enforcing: false });
  assert.equal(advisory.exitCode, 0);
  assert.ok(advisory.lines.some((l) => l.includes("Advisory only")));

  const enforcing = formatReport(out, { enforcing: true });
  assert.equal(enforcing.exitCode, 1);
  assert.ok(enforcing.lines.some((l) => l.includes("other/thing.ts")));
  assert.ok(enforcing.lines.some((l) => l.includes("DPF_SKIP_STAGED_SCOPE=1")), "a bypass must be named, not hidden");
});

test("a clean in-scope commit says so, with the count it checked", () => {
  const out = classifyStagedScope({ stagedPaths: ["scripts/a.mjs", "scripts/b.mjs"], scopePaths: ["scripts"] });
  const report = formatReport(out, { enforcing: true });
  assert.equal(report.exitCode, 0);
  assert.match(report.lines[0], /all 2 staged path\(s\)/);
});

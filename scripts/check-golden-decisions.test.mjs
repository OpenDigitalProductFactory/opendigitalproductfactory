// scripts/check-golden-decisions.test.mjs
//
// Drift-guard for the vitest-free decision-baseline guard. check-golden-decisions.mjs
// inlines the canonical scenarios from apps/web/lib/decision/golden-decisions.ts so it
// can run without vitest (degraded worktrees / pre-commit). This test fails CI if the
// two diverge — same ids, margin floors, expected winners, and scenario count — and
// asserts the guard passes on the real corpus. node --test (no vitest needed), so it
// runs in the same vitest-free contexts the guard targets.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SCENARIOS,
  loadCommandmentsFromGitTree,
  resolveMergeTree,
  runCheck,
} from "./check-golden-decisions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANON = readFileSync(
  join(HERE, "..", "apps", "web", "lib", "decision", "golden-decisions.ts"),
  "utf8",
);

test("guard scenarios mirror GOLDEN_SCENARIOS in golden-decisions.ts (no drift)", () => {
  for (const s of SCENARIOS) {
    assert.ok(CANON.includes(`id: "${s.id}"`), `scenario id "${s.id}" missing from golden-decisions.ts`);
    assert.ok(
      CANON.includes(`expectedWinner: "${s.expectedWinner}"`),
      `expectedWinner "${s.expectedWinner}" for ${s.id} missing from golden-decisions.ts`,
    );
    assert.ok(
      new RegExp(`marginFloor:\\s*${s.marginFloor}\\b`).test(CANON),
      `marginFloor ${s.marginFloor} for ${s.id} missing from golden-decisions.ts`,
    );
  }
});

test("guard covers every canonical scenario (count matches golden-decisions.ts)", () => {
  // Match scenario entries (marginFloor: <number>), not the `marginFloor: number;`
  // type-field declaration on GoldenScenario.
  const canonCount = (CANON.match(/marginFloor:\s*[\d.]/g) || []).length;
  assert.equal(
    SCENARIOS.length,
    canonCount,
    `golden-decisions.ts defines ${canonCount} scenarios but the guard covers ${SCENARIOS.length}. ` +
      `Add the new scenario to SCENARIOS in scripts/check-golden-decisions.mjs.`,
  );
});

test("guard passes on the real principle corpus", () => {
  const { results, ok } = runCheck();
  for (const r of results) {
    assert.ok(
      r.ok,
      `${r.id}: winner=${r.winner} (want ${r.expectedWinner}) margin=${r.margin} floor=${r.marginFloor}`,
    );
  }
  assert.ok(ok);
});

test("merge-state corpus uses a synthetic tree and never a checkout or merge commit", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === "merge-tree") return "a".repeat(40) + "\n";
    if (args[0] === "ls-tree") {
      return [
        "docs/founder-kernel/wiki/principles/example.md",
        "docs/professions/software-engineer/wiki/example.md",
        "apps/web/ignored.ts",
      ].join("\n");
    }
    if (args[0] === "show") {
      return [
        "---",
        "pageKind: principle",
        "status: published",
        "principleTier: commandment",
        "principleDimensionVector: {\"governance_compliance\":1}",
        "---",
      ].join("\n");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };

  const tree = resolveMergeTree("origin/main", { git });
  const commandments = loadCommandmentsFromGitTree(tree, { git });
  assert.equal(commandments.length, 2);
  assert.deepEqual(calls[0], ["merge-tree", "--write-tree", "origin/main", "HEAD"]);
  assert.equal(calls.some((args) => ["checkout", "switch", "merge", "commit", "config"].includes(args[0])), false);
});

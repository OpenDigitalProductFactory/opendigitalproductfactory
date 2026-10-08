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
  CorpusBlobsUnavailableError,
  loadCommandmentsFromGitTree,
  parseCatFileBatch,
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

const PRINCIPLE_BODY = [
  "---",
  "pageKind: principle",
  "status: published",
  "principleTier: commandment",
  "principleDimensionVector: {\"governance_compliance\":1}",
  "---",
].join("\n");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function batchOutput(objects) {
  return Buffer.concat(objects.map(([sha, body]) => {
    const content = Buffer.from(body, "utf8");
    return Buffer.concat([Buffer.from(`${sha} blob ${content.length}\n`), content, Buffer.from("\n")]);
  }));
}

function fakeGit({ missing = [], fetchFails = false } = {}) {
  const calls = [];
  const git = (args, opts = {}) => {
    calls.push({ args, opts });
    if (args[0] === "merge-tree") return "f".repeat(40) + "\n";
    if (args[0] === "ls-tree") {
      return [
        `100644 blob ${SHA_A}\tdocs/founder-kernel/wiki/principles/example.md`,
        `100644 blob ${SHA_B}\tdocs/professions/software-engineer/wiki/example.md`,
        `100644 blob ${"c".repeat(40)}\tdocs/architecture/ignored.md`,
      ].join("\n");
    }
    if (args[0] === "cat-file" && args[1].startsWith("--batch-check")) {
      return String(opts.input).trim().split("\n")
        .map((sha) => (missing.includes(sha) ? `${sha} missing` : `${sha} blob`)).join("\n");
    }
    if (args[0] === "fetch") {
      if (fetchFails) throw new Error("fatal: could not read from remote repository");
      return "";
    }
    if (args[0] === "cat-file" && args[1] === "--batch") {
      return batchOutput([[SHA_A, PRINCIPLE_BODY], [SHA_B, `${PRINCIPLE_BODY}\n— an em dash keeps byte sizes honest`]]);
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git, calls };
}

test("merge-state corpus uses a synthetic tree and never a checkout or merge commit", () => {
  const { git, calls } = fakeGit();
  const tree = resolveMergeTree("origin/main", { git });
  const commandments = loadCommandmentsFromGitTree(tree, { git });
  assert.equal(commandments.length, 2);
  assert.deepEqual(calls[0].args, ["merge-tree", "--write-tree", "origin/main", "HEAD"]);
  assert.equal(calls.some(({ args }) => ["checkout", "switch", "merge", "commit", "config"].includes(args[0])), false);
});

// BI-1D04A29F: one batch read instead of one `git show` per page, and missing
// partial-clone blobs are found without lazy fetching and fetched in one request.
test("the corpus is read in one batch, with no per-page git show", () => {
  const { git, calls } = fakeGit();
  loadCommandmentsFromGitTree("f".repeat(40), { git });
  assert.equal(calls.filter(({ args }) => args[0] === "show").length, 0);
  assert.equal(calls.filter(({ args }) => args[0] === "cat-file" && args[1] === "--batch").length, 1);
  const check = calls.find(({ args }) => args[1]?.startsWith("--batch-check"));
  assert.equal(check.opts.env.GIT_NO_LAZY_FETCH, "1");
  assert.equal(calls.some(({ args }) => args[0] === "fetch"), false, "nothing missing, nothing fetched");
});

test("missing blobs are fetched from origin in one request before reading", () => {
  const { git, calls } = fakeGit({ missing: [SHA_B] });
  const commandments = loadCommandmentsFromGitTree("f".repeat(40), { git });
  const fetches = calls.filter(({ args }) => args[0] === "fetch");
  assert.equal(fetches.length, 1);
  assert.deepEqual(fetches[0].args, ["fetch", "--no-tags", "--quiet", "origin", SHA_B]);
  assert.equal(commandments.length, 2);
});

test("an unfetchable blob is an environment gap with the remedy, not a decision regression", () => {
  const { git } = fakeGit({ missing: [SHA_A], fetchFails: true });
  assert.throws(
    () => loadCommandmentsFromGitTree("f".repeat(40), { git }),
    (error) => error instanceof CorpusBlobsUnavailableError
      && /environment gap, not a decision regression/.test(error.message)
      && error.message.includes(`git fetch --no-tags origin ${SHA_A}`),
  );
});

test("parseCatFileBatch splits by byte size, so multi-byte content stays whole", () => {
  const map = parseCatFileBatch(batchOutput([[SHA_A, "één — ✓"], [SHA_B, "plain"]]));
  assert.equal(map.get(SHA_A), "één — ✓");
  assert.equal(map.get(SHA_B), "plain");
});

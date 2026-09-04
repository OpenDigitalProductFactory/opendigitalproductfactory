import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { decide, evaluateGateRecord } from "./pregate-evidence-guard.mjs";

const HEAD = "abc123def456abc123def456abc123def456abc1";

function headWithRecord(rec) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-pregate-guard-"));
  const gitDir = join(dir, ".git");
  mkdirSync(gitDir);
  const statePath = join(gitDir, "dpf-local-ci-gate.json");
  if (rec) writeFileSync(statePath, JSON.stringify(rec));
  return {
    branch: "feat/x",
    sha: HEAD,
    statePath: rec ? statePath : join(gitDir, "missing.json"),
  };
}

test("blocks git push and gh pr create without gate record", () => {
  const head = headWithRecord(null);
  assert.equal(decide("git push -u origin HEAD", {}, { head }).block, true);
  assert.equal(decide("gh pr create --title t --body b", {}, { head }).block, true);
  assert.match(decide("git push", {}, { head }).reason, /pregate|sandbox|BI-563F6AB6/i);
});

test("allows git push when gatePassed for matching SHA", () => {
  const head = headWithRecord({
    sha: HEAD,
    gatePassed: true,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  });
  assert.equal(decide("git push origin HEAD", {}, { head }).block, false);
});

test("blocks when gate SHA is stale", () => {
  const head = headWithRecord({ sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", gatePassed: true });
  assert.equal(decide("git push", {}, { head }).block, true);
  assert.match(decide("git push", {}, { head }).reason, /SHA|re-run pregate/i);
});

test("allows allowlisted skipReason; blocks free-text skip", () => {
  const ok = headWithRecord({
    sha: HEAD,
    gatePassed: false,
    skipped: true,
    skipReason: "operator-emergency: human go",
  });
  assert.equal(decide("git push", {}, { head: ok }).block, false);

  const bad = headWithRecord({
    sha: HEAD,
    gatePassed: false,
    skipped: true,
    skipReason: "unit tests only",
  });
  assert.equal(decide("git push", {}, { head: bad }).block, true);
});

test("allows DPF_SKIP with allowlisted reason in env or command", () => {
  assert.equal(
    decide("git push", {
      DPF_SKIP_PREPUSH_GATE: "1",
      DPF_SKIP_PREPUSH_GATE_REASON: "operator-emergency: fix",
    }).block,
    false,
  );
  assert.equal(
    decide(
      'DPF_SKIP_PREPUSH_GATE=1 DPF_SKIP_PREPUSH_GATE_REASON="docs-adjacent: only" git push',
    ).block,
    false,
  );
  assert.equal(
    decide("git push", {
      DPF_SKIP_PREPUSH_GATE: "1",
      DPF_SKIP_PREPUSH_GATE_REASON: "unit tests only",
    }).block,
    true,
  );
});

test("allows pregate inflight, ungated push bypass, and non-publish commands", () => {
  assert.equal(decide("git push", { DPF_PREPUSH_GATE_INFLIGHT: "1" }).block, false);
  assert.equal(decide("DPF_ALLOW_UNGATED_PUSH=1 git push").block, false);
  assert.equal(decide("pnpm run pregate").block, false);
  assert.equal(decide("git status").block, false);
  assert.equal(decide("pnpm test").block, false);
  assert.equal(decide("gh pr view 1").block, false);
});

test("allows main branch pushes", () => {
  assert.equal(
    decide("git push", {}, { head: { branch: "main", sha: HEAD, statePath: "/nope" } }).block,
    false,
  );
});

test("quoted data mentioning git push does not block", () => {
  assert.equal(decide(`git commit -m "remember to git push after pregate"`).block, false);
});

test("still blocks publish smuggled via sh -c", () => {
  const head = headWithRecord(null);
  assert.equal(decide(`sh -c 'git push'`, {}, { head }).block, true);
});

test("evaluateGateRecord expired passed gate is not ok", () => {
  const dir = mkdtempSync(join(tmpdir(), "dpf-pregate-exp-"));
  const p = join(dir, "gate.json");
  writeFileSync(
    p,
    JSON.stringify({
      sha: HEAD,
      gatePassed: true,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }),
  );
  const r = evaluateGateRecord(p, HEAD);
  assert.equal(r.ok, false);
  assert.match(r.reason, /expired/i);
});

// BI-5529B5AC: gate state is written PER SLOT (dpf-local-ci-gate.json for
// slot-0, dpf-local-ci-gate-slot-1.json for slot-1). A stale slot-0 record must
// never shadow a PASS earned on slot-1 for the same SHA — the exact shape that
// refused `fix/classify-ignored-builds@f8c38b9cac` on 2026-09-02 until an
// operator-emergency override was written over the top of it.
function headWithSlotRecords(records) {
  const dir = mkdtempSync(join(tmpdir(), "dpf-pregate-slots-"));
  const gitDir = join(dir, ".git");
  mkdirSync(gitDir);
  for (const [name, rec] of Object.entries(records)) {
    writeFileSync(join(gitDir, name), JSON.stringify(rec));
  }
  return {
    branch: "feat/x",
    sha: HEAD,
    statePath: join(gitDir, "dpf-local-ci-gate.json"),
    topLevel: dir,
  };
}

test("slot-1 PASS for HEAD is honoured when slot-0 holds a stale queued record for the same SHA", () => {
  const head = headWithSlotRecords({
    "dpf-local-ci-gate.json": { sha: HEAD, gatePassed: false, status: "queued" },
    "dpf-local-ci-gate-slot-1.json": {
      sha: HEAD,
      gatePassed: true,
      status: "passed",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  assert.equal(decide("git push", {}, { head }).block, false);
});

test("slot-1 PASS for a DIFFERENT SHA does not rescue a slot-0 miss", () => {
  const head = headWithSlotRecords({
    "dpf-local-ci-gate.json": { sha: HEAD, gatePassed: false, status: "failed" },
    "dpf-local-ci-gate-slot-1.json": {
      sha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      gatePassed: true,
      status: "passed",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    },
  });
  const verdict = decide("git push", {}, { head });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /not passed|re-run pregate/i);
});

test("the checked-in reader (scripts/pregate-status.mjs) is the verdict when it is present", () => {
  const head = headWithSlotRecords({
    // No record that this hook could read as a pass on its own...
    "dpf-local-ci-gate.json": { sha: HEAD, gatePassed: false, status: "queued" },
  });
  mkdirSync(join(head.topLevel, "scripts"));
  // ...but the canonical reader says PASS for this HEAD, so the hook defers.
  writeFileSync(
    join(head.topLevel, "scripts", "pregate-status.mjs"),
    `process.stdout.write(JSON.stringify({ verdict: "PASS", headSha: ${JSON.stringify(HEAD)} }));\n`,
  );
  assert.equal(decide("git push", {}, { head }).block, false);
});

test("a reader verdict other than PASS still lets an allowlisted recorded override through", () => {
  const head = headWithSlotRecords({
    "dpf-local-ci-gate.json": {
      sha: HEAD,
      gatePassed: false,
      skipped: true,
      skipReason: "external-contribution-no-install: source-only worktree",
    },
  });
  mkdirSync(join(head.topLevel, "scripts"));
  writeFileSync(
    join(head.topLevel, "scripts", "pregate-status.mjs"),
    `process.stdout.write(JSON.stringify({ verdict: "FAIL", reason: "gate record status unknown" })); process.exit(1);\n`,
  );
  assert.equal(decide("git push", {}, { head }).block, false);
});

test("a reader verdict other than PASS with no override blocks and quotes the reader's reason", () => {
  const head = headWithSlotRecords({
    "dpf-local-ci-gate.json": { sha: HEAD, gatePassed: false, status: "failed" },
  });
  mkdirSync(join(head.topLevel, "scripts"));
  writeFileSync(
    join(head.topLevel, "scripts", "pregate-status.mjs"),
    `process.stdout.write(JSON.stringify({ verdict: "FAIL", reason: "vitest stage failed on slot-0" })); process.exit(1);\n`,
  );
  const verdict = decide("git push", {}, { head });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /vitest stage failed on slot-0/);
});

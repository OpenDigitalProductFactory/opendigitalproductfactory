// Self-test for the job-definition axis-waiver store (BI-4CE4F52F).
//
// A waiver store is the obvious place to hide a gap, so the expiry and
// thin-reason checks are the whole point: a waiver that has lapsed, or that
// nobody could argue with, must FAIL rather than quietly answer an axis. Same
// discipline as workforce-staffing-posture.test.ts.
//
// PURE BY NECESSITY, AND THAT IS A CORRECTION. The first version of this test
// shelled out to `pnpm audit:job-definitions`. It passed locally and FAILED in
// CI, because the policy-guard job that runs these tests is checkout +
// setup-node with NO pnpm install — so tsx does not exist there. A guard whose
// own test needs a toolchain its job lacks is a guard that does not run.
//
// So this reads the registry JSON directly and applies the same rules the audit
// applies. The axis vocabulary is PARSED OUT OF THE CONTRACT rather than
// retyped, so this file cannot come to disagree with JOB_DEFINITION_AXES about
// what an axis is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const REGISTRY = "packages/db/data/agent_registry.json";
const CONTRACT = "packages/db/src/coworker-job-definition.ts";

/** The contract's own axis list, read from source — never a second copy. */
function axes() {
  const src = readFileSync(CONTRACT, "utf8");
  const block = /export const JOB_DEFINITION_AXES = \[([\s\S]*?)\] as const;/.exec(src)
    ?? /export const JOB_DEFINITION_AXES = \[([\s\S]*?)\];/.exec(src);
  assert.ok(block, `could not parse JOB_DEFINITION_AXES from ${CONTRACT}`);
  const found = [...block[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  // Floor: a regex that stops matching must fail, not report a clean sweep over
  // an empty set. Nine axes are the contract.
  assert.ok(found.length >= 9, `parsed only ${found.length} axes — fix the reader, not the floor`);
  return new Set(found);
}

function waiverRows() {
  const parsed = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.agents ?? [];
  assert.ok(rows.length >= 50, `parsed only ${rows.length} registry rows — fix the reader`);
  return rows.filter((r) => r.job_definition_waivers);
}

test("every declared waiver carries an arguable reason and a FUTURE review date", () => {
  const rows = waiverRows();
  assert.ok(rows.length > 0, "expected at least one declared waiver to police");
  for (const row of rows) {
    for (const [axis, w] of Object.entries(row.job_definition_waivers)) {
      // 40 characters is the contract's own MIN_JUSTIFICATION floor. A waiver a
      // reader cannot disagree with is a blank.
      assert.ok(
        (w?.reason ?? "").trim().length >= 40,
        `${row.agent_id}/${axis}: reason is ${(w?.reason ?? "").trim().length} chars`,
      );
      const due = new Date(w?.reviewBy ?? "");
      assert.ok(!Number.isNaN(due.getTime()), `${row.agent_id}/${axis}: unparseable reviewBy`);
      // THE ASSERTION THAT MATTERS. It fails the build on the day a review date
      // passes, so a waiver cannot become permanent by neglect.
      assert.ok(
        due.getTime() > Date.now(),
        `${row.agent_id}/${axis}: waiver expired on ${w?.reviewBy} — re-decide it, do not extend it`,
      );
    }
  }
});

test("waivers only name axes the contract actually defines", () => {
  const known = axes();
  for (const row of waiverRows()) {
    for (const axis of Object.keys(row.job_definition_waivers)) {
      assert.ok(known.has(axis), `${row.agent_id}: "${axis}" is not a job-definition axis`);
    }
  }
});

test("a waiver names one role and one axis — never a blanket", () => {
  // Waiving an axis across the whole roster in one declaration would be the
  // gap-hiding move this store must not enable. Each waiver is per-agent by
  // construction (it lives ON the agent), and this pins that every reason is
  // DISTINCT — a reason copy-pasted across roles is a blanket wearing a
  // per-role shape.
  const reasons = waiverRows().flatMap((r) =>
    Object.values(r.job_definition_waivers).map((w) => (w?.reason ?? "").trim()),
  );
  assert.equal(new Set(reasons).size, reasons.length, "two waivers share a reason verbatim");
});

test("the audit reports a waived axis distinctly from a satisfied one", () => {
  // Read at source rather than by running the audit, for the toolchain reason in
  // this file's header. What matters is that "waived" is its own status and is
  // printed on its own line; folding it into "answered" would make a recorded
  // decision indistinguishable from a met requirement.
  const src = readFileSync("scripts/audit-coworker-job-definitions.ts", "utf8");
  assert.match(src, /"answered" \| "waived" \| "open"/);
  assert.match(src, /of which waived axes/);
  // And the open worklist must still be printed, so the store cannot silence it.
  assert.match(src, /open by axis — the worklist, as job questions/);
});

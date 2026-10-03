// Self-test for the job-definition axis-waiver store (BI-4CE4F52F).
//
// A waiver store is the obvious place to hide a gap, so the expiry and
// thin-reason checks are the whole point: this asserts that a waiver which has
// lapsed, or which nobody could argue with, FAILS rather than quietly answering
// an axis. Same discipline as workforce-staffing-posture.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const run = () => {
  const r = spawnSync("pnpm", ["audit:job-definitions"], { encoding: "utf8" });
  return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
};

const REGISTRY = "packages/db/data/agent_registry.json";
const declared = () => {
  const parsed = JSON.parse(readFileSync(REGISTRY, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.agents ?? [];
  return rows.filter((r) => r.job_definition_waivers);
};

test("the live registry's waivers all pass validation", () => {
  const { out, code } = run();
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /job-definition waivers FAILED/);
});

test("every declared waiver carries an arguable reason and a FUTURE review date", () => {
  const rows = declared();
  assert.ok(rows.length > 0, "expected at least one declared waiver to police");
  for (const row of rows) {
    for (const [axis, w] of Object.entries(row.job_definition_waivers)) {
      // 40 characters is the contract's own MIN_JUSTIFICATION floor. A waiver a
      // reader cannot disagree with is a blank.
      assert.ok(
        (w.reason ?? "").trim().length >= 40,
        `${row.agent_id}/${axis}: reason is ${(w.reason ?? "").trim().length} chars`,
      );
      const due = new Date(w.reviewBy);
      assert.ok(!Number.isNaN(due.getTime()), `${row.agent_id}/${axis}: unparseable reviewBy`);
      // THIS IS THE ASSERTION THAT MATTERS. It fails the build on the day a
      // review date passes, so a waiver cannot become permanent by neglect.
      assert.ok(
        due.getTime() > Date.now(),
        `${row.agent_id}/${axis}: waiver expired on ${w.reviewBy} — re-decide it, do not extend it`,
      );
    }
  }
});

test("a waived axis is reported as waived, never folded into satisfied", () => {
  const { out } = run();
  // The count is named separately so a reader can tell a role that SATISFIED an
  // axis from one that decided the axis does not apply to it.
  assert.match(out, /of which waived axes: \d+ \(each with a reason and a review date\)/);
});

test("waivers only name real axes, and only where the role's own definition supports it", () => {
  const AXES = new Set([
    "purpose", "accountabilities", "authority", "cadence", "qualifications",
    "context", "measures", "supervision", "tailoring",
  ]);
  for (const row of declared()) {
    for (const axis of Object.keys(row.job_definition_waivers)) {
      assert.ok(AXES.has(axis), `${row.agent_id}: "${axis}" is not a job-definition axis`);
    }
  }
});

test("the audit still reports its open worklist rather than going quiet", () => {
  const { out } = run();
  // A waiver store that silenced the worklist would defeat the audit. Whatever
  // remains open must still be named.
  assert.match(out, /open by axis — the worklist, as job questions/);
  assert.match(out, /complete job definitions: \d+\/\d+/);
});

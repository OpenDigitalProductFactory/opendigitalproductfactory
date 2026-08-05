// Self-test for the test clock-bomb guard (BI-E104FBCC).
//
// The guard's own value depends on two properties that are easy to lose in a later
// edit: it must catch the shape that actually detonated in production, and it must
// NOT fire on the far-future sentinels and deliberately-expired fixtures that make up
// most of the repo's hardcoded dates. Both directions are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";

import { findClockBombs } from "./check-test-clock-bombs.mjs";

test("flags the shape that actually detonated", () => {
  // This is the real care-intake fixture that failed every open PR on a date rollover.
  const src = `
    describe("issueCareIntakeResumeGrant", () => {
      it("issues the raw token once", async () => {
        await issue({ expiresAt: new Date("2026-08-01T15:00:00.000Z") });
      });
    });
  `;
  const findings = findClockBombs(src);
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /expiresAt/);
});

test("stays silent when the file pins the clock", () => {
  const src = `
    beforeEach(() => { vi.useFakeTimers().setSystemTime("2026-08-01T14:00:00.000Z"); });
    it("expires", () => { grant({ expiresAt: new Date("2026-08-01T15:00:00.000Z") }); });
  `;
  assert.deepEqual(findClockBombs(src), []);
});

test("stays silent when the test injects an explicit clock", () => {
  // Regression for a real false positive. lib/auth/edge-node-mtls.test.ts holds a
  // certificate whose validUntil is days away, which looks alarming — but
  // resolveEdgeNodeMtls takes an explicit `now` and the test passes a fixed one, so
  // the wall clock is never consulted. Injection is clock control; flagging this file
  // would push an author to "fix" a test that is already correct.
  const src = `
    const NOW = new Date("2026-07-22T02:30:00.000Z");
    const cert = { validUntil: new Date("2026-08-21T00:00:00.000Z") };
    await resolveEdgeNodeMtls(headers(), "edge_row_1", db(cert), { proxySecret: "s", now: NOW });
  `;
  assert.deepEqual(findClockBombs(src), []);
});

test("stays silent on a date not bound to a future-requiring field", () => {
  // A createdAt in the past is not a bomb; nothing requires it to be ahead of now.
  const src = `it("renders", () => { row({ createdAt: "2026-08-01T15:00:00.000Z" }); });`;
  assert.deepEqual(findClockBombs(src), []);
});

test("respects an explicit inline exemption", () => {
  const inline = `it("x", () => { a({ expiresAt: "2099-01-01T00:00:00Z" }); }); // clock-bomb-guard: allow far-future sentinel`;
  assert.deepEqual(findClockBombs(inline), []);

  const preceding = `
    // clock-bomb-guard: allow deliberately-expired fixture exercising the expired branch
    const row = { expiresAt: "2020-01-01T00:00:00Z" };
  `;
  assert.deepEqual(findClockBombs(preceding), []);
});

test("reports every offending line, not just the first", () => {
  const src = `
    const a = { expiresAt: "2027-01-01T00:00:00Z" };
    const b = { validUntil: "2027-02-01T00:00:00Z" };
  `;
  assert.equal(findClockBombs(src).length, 2);
});

test("is time-independent: the verdict does not depend on today", () => {
  // The guard must never compare a fixture to the current clock. If it did, it would
  // be the very defect it exists to prevent: a clean tree could go red overnight, and
  // a planted bomb would go quiet the moment it detonated. A long-past date and a
  // far-future one bound to the same field must therefore both be reported, and the
  // author resolves them by pinning or by stating an exemption.
  const past = `const a = { expiresAt: "2020-01-01T00:00:00Z" };`;
  const future = `const a = { expiresAt: "2099-01-01T00:00:00Z" };`;
  assert.equal(findClockBombs(past).length, 1);
  assert.equal(findClockBombs(future).length, 1);
});

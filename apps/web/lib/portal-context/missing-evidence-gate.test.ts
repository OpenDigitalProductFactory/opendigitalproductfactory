// apps/web/lib/portal-context/missing-evidence-gate.test.ts
//
// Unit tests for BI-DFC11F59 — the Option-1 grace-window fix to the D14
// "missing evidence" attention gate.
//
// The gate logic lives inline in lib/portal-context/index.ts. Rather than
// spinning up the full portal-context stack (which requires mocked DB,
// sessions, route context, etc.), we test the *predicate* that drives it
// by replicating it with explicit inputs. These cases match the
// BI's acceptance criteria directly:
//
//   AC1: Build entering Plan from Ideate does NOT show warning for first 30s
//   AC2: Build in Plan for several minutes with genuine gaps DOES show warning
//   AC3: Same applies to Build, Review, Ready-to-Ship transitions
//
// If the gate logic in index.ts is ever refactored into a helper function,
// these tests should move to import that helper directly.

import { describe, expect, it } from "vitest";

const GRACE_MS = 30_000; // must match the constant in index.ts

/**
 * Replication of the gate predicate from
 * apps/web/lib/portal-context/index.ts lines 108–117 (post-fix).
 * If index.ts changes, keep this in sync.
 */
function shouldShowMissingEvidenceWarning(opts: {
  phase: string | null;
  updatedAt: string | null;
  now: Date;
  hasEvidenceGap: boolean;
}): boolean {
  const { phase, updatedAt, now, hasEvidenceGap } = opts;
  const msSincePhaseEntry = updatedAt
    ? now.getTime() - new Date(updatedAt).getTime()
    : Infinity;
  const phaseHasAttemptedEvidence =
    phase !== null &&
    phase !== "ideate" &&
    msSincePhaseEntry > GRACE_MS;
  return phaseHasAttemptedEvidence && hasEvidenceGap;
}

const NOW = new Date("2026-06-03T12:00:00.000Z");
const JUST_NOW = new Date(NOW.getTime() - 5_000).toISOString(); // 5s ago
const RECENTLY = new Date(NOW.getTime() - 20_000).toISOString(); // 20s ago — within grace
const GRACE_BOUNDARY = new Date(NOW.getTime() - 30_000).toISOString(); // exactly 30s
const LONG_AGO = new Date(NOW.getTime() - 5 * 60_000).toISOString(); // 5 min ago

describe("missing_evidence gate — grace window (BI-DFC11F59)", () => {
  // ─── Ideate always suppressed ─────────────────────────────────────────────

  it("never fires during Ideate phase regardless of how long it has been", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "ideate",
        updatedAt: LONG_AGO,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });

  // ─── AC1: suppressed for first 30s after phase entry ─────────────────────

  it("suppresses warning at Plan phase entry (5s ago — within grace window)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "plan",
        updatedAt: JUST_NOW,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });

  it("suppresses warning at Plan phase entry (20s ago — still within grace window)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "plan",
        updatedAt: RECENTLY,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });

  it("suppresses warning at exactly the grace boundary (30s — exclusive threshold)", () => {
    // msSincePhaseEntry === GRACE_MS: predicate uses strict >, so this is
    // still within the grace window.
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "plan",
        updatedAt: GRACE_BOUNDARY,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });

  // ─── AC2: fires after 30s with genuine gaps ───────────────────────────────

  it("fires warning at Plan phase after grace window (5 minutes, evidence gap exists)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "plan",
        updatedAt: LONG_AGO,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(true);
  });

  it("does NOT fire even after grace window if there are no evidence gaps", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "plan",
        updatedAt: LONG_AGO,
        now: NOW,
        hasEvidenceGap: false,
      }),
    ).toBe(false);
  });

  // ─── AC3: applies to Build, Review, Ready-to-Ship transitions too ─────────

  it("suppresses warning at Build phase entry (5s ago)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "build",
        updatedAt: JUST_NOW,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });

  it("fires warning at Build phase after grace window (5 min)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "build",
        updatedAt: LONG_AGO,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(true);
  });

  it("suppresses warning at Review phase entry (5s ago)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "review",
        updatedAt: JUST_NOW,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });

  it("fires warning at Review phase after grace window (5 min)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "review",
        updatedAt: LONG_AGO,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(true);
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────

  it("treats missing updatedAt as 'infinite' age — fires warning after grace", () => {
    // If updatedAt is null (shouldn't happen but defensive) we default to
    // Infinity which means we're past the grace window.
    expect(
      shouldShowMissingEvidenceWarning({
        phase: "plan",
        updatedAt: null,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(true);
  });

  it("returns false when phase is null (no active build)", () => {
    expect(
      shouldShowMissingEvidenceWarning({
        phase: null,
        updatedAt: LONG_AGO,
        now: NOW,
        hasEvidenceGap: true,
      }),
    ).toBe(false);
  });
});

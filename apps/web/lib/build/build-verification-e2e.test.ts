/**
 * Chunk 8 — end-to-end integration test for the coworker-driven UX
 * verification pipeline.
 *
 * ADVISORY (operator decision 2026-06-07, commit 231bb62b / BI-4BD81F3B):
 * UX verification is recorded for visibility but does NOT hard-block the
 * review -> ship transition — mirroring the informational unit-test gate.
 * A CLI-developed, committed, serving build ships on the CLI's evidence;
 * browser-use UX results (incl. null = not-run, and failed) are advisory,
 * surfaced in the Review panel rather than blocking. Only the transient
 * "running" state briefly defers, since the check is genuinely in-flight.
 *
 * This file pins the gate behavior:
 *
 *   1. `checkPhaseGate(review -> ship)` ALLOWS while `uxVerificationStatus`
 *      is null (verification not run) — advisory, not blocking.
 *   2. `checkPhaseGate(review -> ship)` blocks ONLY while status is
 *      "running" (transient in-flight defer).
 *   3. `checkPhaseGate(review -> ship)` ALLOWS when status is "failed"
 *      (or when uxTestResults carries failures) — advisory, not blocking.
 *   4. The Inngest handler persists only `uxTestResults` +
 *      `uxVerificationStatus` and leaves `designReview` UNCHANGED (the
 *      reviewer pipeline owns that field and would overwrite).
 */

import { describe, it, expect } from "vitest";
import { checkPhaseGate } from "@/lib/explore/feature-build-types";

type UxStep = { step: string; passed: boolean; screenshotUrl: string | null; error: string | null };

function evidence(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    // Gate prerequisites that are unrelated to UX verification — we fill
    // them with truthy defaults so failures are attributable to the UX
    // path rather than missing upstream evidence.
    designDoc: { summary: "ok" },
    buildPlan: { tasks: [] },
    verificationOut: { passed: true },
    acceptanceMet: [{ criterion: "ac-1", met: true, evidence: "ok" }],
    acceptanceCriteria: ["User can click the button", "Form submits without error"],
    ...overrides,
  };
}

describe("coworker-driven UX verification — gate behavior", () => {
  it("allows review -> ship when status is null even with acceptance criteria (advisory)", () => {
    const gate = checkPhaseGate("review", "ship", evidence({
      uxVerificationStatus: null,
      uxTestResults: null,
    }));
    // UX verification not having run is advisory, not a hard block.
    expect(gate.allowed).toBe(true);
  });

  it("blocks review -> ship while verification is running", () => {
    const gate = checkPhaseGate("review", "ship", evidence({
      uxVerificationStatus: "running",
      uxTestResults: null,
    }));
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toMatch(/still running/i);
  });

  it("allows review -> ship when status is skipped (no acceptance criteria)", () => {
    const gate = checkPhaseGate("review", "ship", evidence({
      uxVerificationStatus: "skipped",
      uxTestResults: null,
      acceptanceCriteria: [],
    }));
    expect(gate.allowed).toBe(true);
  });

  it("allows review -> ship when all steps pass", () => {
    const steps: UxStep[] = [
      { step: "User can click the button", passed: true, screenshotUrl: "/api/build/FB/evidence/0.png", error: null },
      { step: "Form submits without error", passed: true, screenshotUrl: "/api/build/FB/evidence/1.png", error: null },
    ];
    const gate = checkPhaseGate("review", "ship", evidence({
      uxVerificationStatus: "complete",
      uxTestResults: steps,
    }));
    expect(gate.allowed).toBe(true);
  });

  it("allows review -> ship when one step failed (advisory, not blocking)", () => {
    const steps: UxStep[] = [
      { step: "User can click the button", passed: true, screenshotUrl: null, error: null },
      { step: "Form submits without error", passed: false, screenshotUrl: null, error: "Submit button not found" },
    ];
    const gate = checkPhaseGate("review", "ship", evidence({
      uxVerificationStatus: "failed",
      uxTestResults: steps,
    }));
    // A failed UX check is surfaced in the Review panel but does not block ship.
    expect(gate.allowed).toBe(true);
  });

  it("allows review -> ship when uxTestResults carries failures (advisory)", () => {
    // Even when the array itself contains failures, the gate does not block —
    // UX results are advisory. The Review panel surfaces the failures.
    const steps: UxStep[] = [
      { step: "Form submits without error", passed: false, screenshotUrl: null, error: "timeout" },
    ];
    const gate = checkPhaseGate("review", "ship", evidence({
      uxVerificationStatus: "complete",
      uxTestResults: steps,
    }));
    expect(gate.allowed).toBe(true);
  });
});

describe("coworker-driven UX verification — handler does not touch designReview", () => {
  it("the handler's persistence shape only writes uxTestResults + uxVerificationStatus", async () => {
    // The Inngest handler persists UX evidence through artifact provenance
    // and writes only the status directly on the build row. Assert the shape
    // to lock in ownership without running the full handler.
    // Path is relative to vitest cwd (apps/web).
    const source = await import("fs/promises").then((fs) =>
      fs.readFile(new URL("../queue/functions/build-review-verification.ts", import.meta.url), "utf-8"),
    );

    // Must persist UX results and update the status.
    expect(source).toMatch(/saveBuildArtifactRevisionWithDb\(prisma,\s*{/);
    expect(source).toMatch(/field:\s*"uxTestResults"/);
    expect(source).toMatch(/value:\s*steps/);
    expect(source).toMatch(/uxVerificationStatus:\s*finalStatus/);

    // Must NOT write to designReview (the reviewer pipeline owns that
    // structure; dual-writing creates a silent overwrite race).
    expect(source).not.toMatch(/designReview\s*:/);
    expect(source).not.toMatch(/designReview\.issues/);
  });
});

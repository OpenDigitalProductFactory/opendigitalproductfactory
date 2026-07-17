// apps/web/lib/build/build-actions-core.test.ts
//
// Unit tests for the pure Build-action helpers extracted from
// lib/actions/build.ts (BI-OPT-FAT-ACTIONS, Build slice). These functions are
// now side-effect-free (no prisma / auth / Next.js), so they are exercised
// directly here. Mirrors ea-core.test.ts.
import { describe, it, expect } from "vitest";
import {
  businessBriefJsonPayload,
  readPersistedSourceCurrency,
  derivePhaseHandoffContext,
  deriveResumeImplementationMode,
  formatResumeImplementationOutcomeMessage,
} from "./build-actions-core";

describe("businessBriefJsonPayload", () => {
  it("projects exactly the five JSON-column fields, passing values through", () => {
    const businessBrief = {
      affectedPeople: [{ role: "operator" }],
      sourceEvidence: { kind: "conversation" },
      technicalInterpretation: { summary: "x" },
      riskProfile: { level: "low" },
      hiveReadiness: { ready: true },
      // extra fields that must NOT appear in the payload
      status: "accepted",
      businessOutcome: "faster",
    } as unknown as Parameters<typeof businessBriefJsonPayload>[0];

    const payload = businessBriefJsonPayload(businessBrief);

    expect(Object.keys(payload).sort()).toEqual([
      "affectedPeople",
      "hiveReadiness",
      "riskProfile",
      "sourceEvidence",
      "technicalInterpretation",
    ]);
    expect(payload.affectedPeople).toEqual([{ role: "operator" }]);
    expect(payload.hiveReadiness).toEqual({ ready: true });
  });
});

describe("readPersistedSourceCurrency", () => {
  it("returns the sourceCurrency sub-object when present", () => {
    const sc = { headSha: "abc", baseSha: "def" };
    expect(readPersistedSourceCurrency({ step: "build", sourceCurrency: sc })).toBe(sc);
  });

  it("returns null for non-objects, arrays, and missing/invalid sourceCurrency", () => {
    expect(readPersistedSourceCurrency(null)).toBeNull();
    expect(readPersistedSourceCurrency(undefined)).toBeNull();
    expect(readPersistedSourceCurrency("x")).toBeNull();
    expect(readPersistedSourceCurrency([1, 2])).toBeNull();
    expect(readPersistedSourceCurrency({ step: "build" })).toBeNull();
    expect(readPersistedSourceCurrency({ sourceCurrency: null })).toBeNull();
    expect(readPersistedSourceCurrency({ sourceCurrency: "nope" })).toBeNull();
    expect(readPersistedSourceCurrency({ sourceCurrency: [1] })).toBeNull();
  });
});

describe("derivePhaseHandoffContext", () => {
  const emptyBuild = {
    designDoc: null,
    designReview: null,
    buildPlan: null,
    planReview: null,
    verificationOut: null,
    acceptanceMet: null,
  };

  it("maps known phases to their handoff agents and falls back for unknown", () => {
    const a = derivePhaseHandoffContext({ currentPhase: "plan", targetPhase: "build", build: emptyBuild });
    expect(a.fromAgent).toBe("ea-architect");
    expect(a.toAgent).toBe("build-specialist");

    const b = derivePhaseHandoffContext({ currentPhase: "review", targetPhase: "ship", build: emptyBuild });
    expect(b.fromAgent).toBe("ops-coordinator");
    expect(b.toAgent).toBe("platform-engineer");

    const c = derivePhaseHandoffContext({ currentPhase: "mystery", targetPhase: "void", build: emptyBuild });
    expect(c.fromAgent).toBe("build-specialist");
    expect(c.toAgent).toBe("build-specialist");
  });

  it("emits no evidence for an empty build", () => {
    const { evidenceFields, evidenceDigest } = derivePhaseHandoffContext({
      currentPhase: "ideate",
      targetPhase: "plan",
      build: emptyBuild,
    });
    expect(evidenceFields).toEqual([]);
    expect(evidenceDigest).toEqual({});
  });

  it("builds an ordered evidence digest with per-field one-line summaries", () => {
    const { evidenceFields, evidenceDigest } = derivePhaseHandoffContext({
      currentPhase: "build",
      targetPhase: "review",
      build: {
        designDoc: { any: true },
        designReview: { decision: "approve", summary: "looks good" },
        buildPlan: { any: true },
        planReview: { decision: "approve", summary: "solid" },
        verificationOut: { typecheckPassed: true },
        acceptanceMet: [{ met: true }, { met: false }, { met: true }],
      },
    });

    expect(evidenceFields).toEqual([
      "designDoc",
      "designReview",
      "buildPlan",
      "planReview",
      "verificationOut",
      "acceptanceMet",
    ]);
    expect(evidenceDigest.designDoc).toBe("Design document saved");
    expect(evidenceDigest.designReview).toBe("approve — looks good");
    expect(evidenceDigest.planReview).toBe("approve — solid");
    expect(evidenceDigest.verificationOut).toBe("typecheck: pass");
    expect(evidenceDigest.acceptanceMet).toBe("2/3 criteria met");
  });

  it("falls back to 'reviewed' / fail markers and non-array acceptance", () => {
    const { evidenceDigest } = derivePhaseHandoffContext({
      currentPhase: "build",
      targetPhase: "review",
      build: {
        designDoc: null,
        designReview: {},
        buildPlan: null,
        planReview: null,
        verificationOut: { typecheckPassed: false },
        acceptanceMet: { met: true },
      },
    });
    expect(evidenceDigest.designReview).toBe("reviewed — ");
    expect(evidenceDigest.verificationOut).toBe("typecheck: fail");
    expect(evidenceDigest.acceptanceMet).toBe("Evaluated");
  });
});

describe("deriveResumeImplementationMode", () => {
  it("prioritizes reset-blocked when tasks were reset", () => {
    expect(
      deriveResumeImplementationMode({ phase: "build", taskCount: 3, resetTasks: 1, verificationFailed: false }),
    ).toBe("reset-blocked");
  });

  it("returns replan-and-dispatch when there are no persisted tasks", () => {
    expect(
      deriveResumeImplementationMode({ phase: "build", taskCount: 0, resetTasks: 0, verificationFailed: false }),
    ).toBe("replan-and-dispatch");
  });

  it("returns rerun-verification only in review with failed verification", () => {
    expect(
      deriveResumeImplementationMode({ phase: "review", taskCount: 2, resetTasks: 0, verificationFailed: true }),
    ).toBe("rerun-verification");
    expect(
      deriveResumeImplementationMode({ phase: "build", taskCount: 2, resetTasks: 0, verificationFailed: true }),
    ).toBe("already-running");
  });

  it("returns already-running otherwise", () => {
    expect(
      deriveResumeImplementationMode({ phase: "review", taskCount: 2, resetTasks: 0, verificationFailed: false }),
    ).toBe("already-running");
  });
});

describe("formatResumeImplementationOutcomeMessage", () => {
  it("pluralizes the reset-blocked task count", () => {
    expect(formatResumeImplementationOutcomeMessage("reset-blocked", 1)).toBe(
      "Reset 1 task to BLOCKED; queued implementation resume.",
    );
    expect(formatResumeImplementationOutcomeMessage("reset-blocked", 3)).toBe(
      "Reset 3 tasks to BLOCKED; queued implementation resume.",
    );
  });

  it("returns the fixed message per mode", () => {
    expect(formatResumeImplementationOutcomeMessage("replan-and-dispatch", 0)).toMatch(/queued implementation dispatch/);
    expect(formatResumeImplementationOutcomeMessage("rerun-verification", 0)).toMatch(/verification recovery/);
    expect(formatResumeImplementationOutcomeMessage("already-running", 0)).toMatch(/already has observable work/);
  });
});

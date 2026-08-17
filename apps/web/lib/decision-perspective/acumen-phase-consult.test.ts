import { describe, expect, it, vi } from "vitest";

import {
  ACUMEN_CONSULT_DOMAIN_CLASS,
  MAX_ACUMEN_CONSULTS_PER_PHASE,
  runAcumenPhaseConsults,
  summarizeAcumenConsults,
} from "./acumen-phase-consult";
import type { evaluateProfessionDecisionGate } from "./profession-gate";

// W16 (BI-18519A73). The consult composition is advisory and fail-open: it
// borrows each impacted acumen's craft via the profession gate's declared-
// borrow contract, caps consult count, survives per-consult failures, and
// hands qualifying outcomes to the injectable gap-nomination hook.

type GateResult = Awaited<ReturnType<typeof evaluateProfessionDecisionGate>>;

function fakeGateResult(over: Partial<GateResult> & { professionKey: string }): GateResult {
  return {
    allowed: true,
    interactionId: `DI-${over.professionKey}`,
    evaluation: {
      outcomeType: "recommend",
      selectedProfileId: `wsid-${over.professionKey}`,
      fallbackProfileId: null,
      profileVersionId: "v1",
      confidenceBefore: 0.8,
      confidenceAfter: 0.8,
      confidenceScore: 0.8,
      coverageGap: false,
      principleConflict: false,
      domainClass: ACUMEN_CONSULT_DOMAIN_CLASS,
      resolvedProfileChain: [`wsid-${over.professionKey}`],
      materialCount: 1,
      freshnessDistribution: { current: 1, stale: 0, superseded: 0, contradicted: 0 },
      riskTier: "medium",
      question: "q",
      options: ["a"],
      rationale: "craft supports it",
      materialScores: [],
      sources: [],
    },
    operatorMessage: "ok",
    professionProfileSelected: true,
    ...over,
  } as GateResult;
}

const baseInput = {
  db: {} as never,
  question: "Start implementation for this build?",
  options: ["Start implementation", "Revise", "Escalate"],
  riskTier: "medium" as const,
  callingPopulation: "build_studio_phase_gate",
};

describe("runAcumenPhaseConsults", () => {
  it("returns [] when no acumen is impacted", async () => {
    const gate = vi.fn();
    const results = await runAcumenPhaseConsults({
      ...baseInput,
      filePaths: ["docs/readme.md"],
      professionGate: gate as never,
    });
    expect(results).toEqual([]);
    expect(gate).not.toHaveBeenCalled();
  });

  it("consults each impacted acumen as a declared borrow with the professional-practice class", async () => {
    const gate = vi.fn().mockImplementation(async (input: { declaredBorrow: { professionKey: string } }) =>
      fakeGateResult({ professionKey: input.declaredBorrow.professionKey }),
    );

    const results = await runAcumenPhaseConsults({
      ...baseInput,
      filePaths: ["packages/db/src/schema-helper.ts"],
      professionGate: gate as never,
    });

    expect(gate).toHaveBeenCalledTimes(1);
    expect(gate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentIdentity: {},
        declaredBorrow: {
          callingPopulation: "build_studio_phase_gate",
          professionKey: "data-architect",
        },
        domainClass: ACUMEN_CONSULT_DOMAIN_CLASS,
        riskTier: "medium",
        routeContext: "/build",
      }),
    );
    expect(results).toEqual([
      expect.objectContaining({
        professionKey: "data-architect",
        interactionId: "DI-data-architect",
        outcomeType: "recommend",
        confidenceScore: 0.8,
        professionProfileSelected: true,
      }),
    ]);
  });

  it("caps consults at MAX_ACUMEN_CONSULTS_PER_PHASE in registry order", async () => {
    const gate = vi.fn().mockImplementation(async (input: { declaredBorrow: { professionKey: string } }) =>
      fakeGateResult({ professionKey: input.declaredBorrow.professionKey }),
    );

    const results = await runAcumenPhaseConsults({
      ...baseInput,
      // Impacts data-architect, ux-design, software-engineer, security, devops-platform.
      filePaths: [
        "packages/db/src/a.ts",
        "apps/web/components/b.tsx",
        "apps/web/lib/c.ts",
        "apps/web/app/api/d/route.ts",
        "scripts/e.sh",
      ],
      professionGate: gate as never,
    });

    expect(results.length).toBe(MAX_ACUMEN_CONSULTS_PER_PHASE);
    expect(results.map((r) => r.professionKey)).toEqual([
      "data-architect",
      "ux-design",
      "software-engineer",
    ]);
  });

  it("fails open per consult: one acumen's error is recorded and the rest still run", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = vi.fn().mockImplementation(async (input: { declaredBorrow: { professionKey: string } }) => {
      if (input.declaredBorrow.professionKey === "data-architect") {
        throw new Error("resolver down");
      }
      return fakeGateResult({ professionKey: input.declaredBorrow.professionKey });
    });

    const results = await runAcumenPhaseConsults({
      ...baseInput,
      filePaths: ["packages/db/src/a.ts", "apps/web/components/b.tsx"],
      professionGate: gate as never,
    });

    expect(results).toEqual([
      { professionKey: "data-architect", error: "resolver down" },
      expect.objectContaining({ professionKey: "ux-design", outcomeType: "recommend" }),
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("acumen.consult.failed"));
    warn.mockRestore();
  });

  it("hands each consult outcome to the injectable nomination hook", async () => {
    const gate = vi.fn().mockImplementation(async (input: { declaredBorrow: { professionKey: string } }) =>
      fakeGateResult({
        professionKey: input.declaredBorrow.professionKey,
        evaluation: {
          ...fakeGateResult({ professionKey: input.declaredBorrow.professionKey }).evaluation,
          outcomeType: "escalate",
          confidenceScore: 0.35,
          coverageGap: false,
        },
      }),
    );
    const nominate = vi.fn().mockResolvedValue({ nominated: true, needId: "CWN-1" });

    await runAcumenPhaseConsults({
      ...baseInput,
      filePaths: ["packages/db/src/a.ts"],
      professionGate: gate as never,
      nominateGap: nominate,
    });

    expect(nominate).toHaveBeenCalledWith({
      professionKey: "data-architect",
      interactionId: "DI-data-architect",
      outcomeType: "escalate",
      confidenceScore: 0.35,
      professionProfileSelected: true,
      coverageGap: false,
      domainClass: ACUMEN_CONSULT_DOMAIN_CLASS,
      question: baseInput.question,
    });
  });

  it("swallows nomination failures with a structured log (audit-only contract)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const gate = vi.fn().mockImplementation(async (input: { declaredBorrow: { professionKey: string } }) =>
      fakeGateResult({ professionKey: input.declaredBorrow.professionKey }),
    );
    const nominate = vi.fn().mockRejectedValue(new Error("inbox down"));

    const results = await runAcumenPhaseConsults({
      ...baseInput,
      filePaths: ["packages/db/src/a.ts"],
      professionGate: gate as never,
      nominateGap: nominate,
    });

    expect(results.length).toBe(1);
    expect(results[0]!.error).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("acumen.gap.nomination-failed"));
    warn.mockRestore();
  });
});

describe("summarizeAcumenConsults", () => {
  it("returns empty string for no consults", () => {
    expect(summarizeAcumenConsults([])).toBe("");
  });

  it("summarizes outcomes, confidence, rationale, and fail-open errors", () => {
    const summary = summarizeAcumenConsults([
      {
        professionKey: "data-architect",
        interactionId: "DI-1",
        outcomeType: "escalate",
        confidenceScore: 0.35,
        rationale: "no craft material for this class",
        professionProfileSelected: false,
      },
      { professionKey: "ux-design", error: "boom" },
    ]);
    expect(summary).toContain("data-architect: escalate (0.35) — no craft material for this class");
    expect(summary).toContain("ux-design: consult failed (fail-open)");
    expect(summary).toContain("advisory");
  });
});

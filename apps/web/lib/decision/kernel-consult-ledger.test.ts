import { describe, it, expect, vi } from "vitest";

import {
  mapConsultOutcome,
  recordKernelConsultInteraction,
} from "./kernel-consult-ledger";
import type { DecisionResult } from "./option-scoring";
import type { DecisionCallerContext } from "./caller-context";

function makeResult(overrides: Partial<DecisionResult> = {}): DecisionResult {
  return {
    recommendation: {
      optionId: "option-a",
      composite: 4.2,
      margin: 1.5,
      confidence: "high",
    },
    scores: [
      {
        optionId: "option-a",
        composite: 4.2,
        contributions: [
          {
            principleId: "architecture-over-shortcuts",
            principleName: "Architecture over shortcuts",
            tier: "commandment",
            weight: 1,
            mode: "structured",
            alignment: 1,
            contribution: 1,
          },
        ],
      },
    ],
    flags: {
      tieMargin: 0.2,
      semanticFallbackRatio: 0,
      structuredCoverage: "strong",
      commandmentConflict: false,
      commandmentConflictPrinciples: [],
    },
    reasoning: "Recommends option-a.",
    ...overrides,
  };
}

const wwmdContext: DecisionCallerContext = {
  principalId: null,
  governingProfileId: "mark-dpf-platform",
  governingProfileKind: "platform",
  callingPopulation: "external_coding_agent",
  resolvedVia: "calling-population",
};

function makeDb(overrides: {
  profile?: { profileId: string; kind: string } | null;
  version?: { versionId: string } | null;
  createImpl?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
} = {}) {
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    decisionPerspectiveProfile: {
      findUnique: vi.fn(async () =>
        overrides.profile === undefined
          ? { profileId: "mark-dpf-platform", kind: "platform" }
          : overrides.profile,
      ),
    },
    decisionPerspectiveProfileVersion: {
      findFirst: vi.fn(async () =>
        overrides.version === undefined
          ? { versionId: "mark-dpf-platform-v1" }
          : overrides.version,
      ),
    },
    decisionInteraction: {
      create:
        overrides.createImpl ??
        (async (args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return args.data;
        }),
    },
  };
}

describe("mapConsultOutcome", () => {
  it("maps a confident, conflict-free recommendation to recommend/low-risk", () => {
    expect(mapConsultOutcome(makeResult())).toEqual({
      outcomeType: "recommend",
      riskTier: "low",
      confidenceScore: 0.9,
    });
  });

  it("maps a commandment conflict to escalate/high-risk", () => {
    const result = makeResult();
    result.flags.commandmentConflict = true;
    result.flags.commandmentConflictPrinciples = ["never-fabricate"];
    expect(mapConsultOutcome(result).outcomeType).toBe("escalate");
    expect(mapConsultOutcome(result).riskTier).toBe("high");
  });

  it("maps a low-margin call to escalate (needs human review)", () => {
    const result = makeResult();
    result.recommendation = { ...result.recommendation!, confidence: "low" };
    expect(mapConsultOutcome(result).outcomeType).toBe("escalate");
  });

  it("maps a no-signal result to defer (coverage gap)", () => {
    const result = makeResult({ recommendation: null });
    expect(mapConsultOutcome(result).outcomeType).toBe("defer");
    expect(mapConsultOutcome(result).confidenceScore).toBe(0);
  });

  // BI-5CE7CF0B: zero-contribution consults escalate to human review — the
  // gate was asked a real question it could not weigh, which is not the same
  // as no principles applying (defer).
  it("maps an insufficient-signal result to escalate, not defer", () => {
    const result = makeResult({ recommendation: null });
    result.flags.insufficientSignal = true;
    expect(mapConsultOutcome(result)).toEqual({
      outcomeType: "escalate",
      riskTier: "medium",
      confidenceScore: 0,
    });
  });
});

describe("recordKernelConsultInteraction", () => {
  it("persists a ledger row attributed to the governing profile", async () => {
    const db = makeDb();
    const outcome = await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "Which storage approach should we take?",
      optionIds: ["option-a", "option-b"],
      optionDescriptions: { "option-a": "Reuse table", "option-b": "New table" },
      appliedPrincipleCount: 21,
      callingSurface: "claude-code",
    });

    expect(outcome.recorded).toBe(true);
    expect(outcome.interactionId).toMatch(/^DI-/);
    expect(db.created).toHaveLength(1);
    const row = db.created[0];
    expect(row.profileId).toBe("mark-dpf-platform");
    expect(row.profileVersionId).toBe("mark-dpf-platform-v1");
    expect(row.domainClass).toBe("kernel-consult");
    // BI-FD7CBA06: external MCP consults must name their door for audit filters.
    expect(row.gateKey).toBe("kernel-consult");
    expect(row.outcomeType).toBe("recommend");
    expect(row.question).toBe("Which storage approach should we take?");
    expect(row.options).toEqual(["option-a", "option-b"]);
    expect(row.phaseFrom).toBeNull();
    expect(row.phaseTo).toBeNull();
    const payload = row.outcomePayload as Record<string, unknown>;
    expect(payload.tool).toBe("principle_decide");
    expect(payload.recommendedOptionId).toBe("option-a");
    expect(payload.callingPopulation).toBe("external_coding_agent");
    expect(payload.callingSurface).toBe("claude-code");
    expect(Array.isArray(payload.topContributors)).toBe(true);
  });

  it("skips observably when the governing profile is not provisioned", async () => {
    const db = makeDb({ profile: null });
    const outcome = await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: {
        ...wwmdContext,
        governingProfileId: "dpf-organizational-principles",
        governingProfileKind: "organization",
        callingPopulation: "in_platform_coworker",
      },
      question: "q",
      optionIds: ["a"],
      optionDescriptions: {},
      appliedPrincipleCount: 0,
    });
    expect(outcome).toEqual({
      recorded: false,
      profileId: "dpf-organizational-principles",
      reason: "profile-not-provisioned",
    });
    expect(db.created).toHaveLength(0);
  });

  it("fails open when the ledger write throws", async () => {
    const db = makeDb({
      createImpl: async () => {
        throw new Error("db down");
      },
    });
    const outcome = await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "q",
      optionIds: ["a"],
      optionDescriptions: {},
      appliedPrincipleCount: 1,
    });
    expect(outcome.recorded).toBe(false);
    expect(outcome.reason).toBe("write-failed");
  });
});

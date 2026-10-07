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
  /** Agent.agentId values that exist. */
  agents?: string[];
} = {}) {
  const created: Array<Record<string, unknown>> = [];
  const ledger: Array<{ where: { ledgerId: string }; create: Record<string, unknown> }> = [];
  return {
    created,
    ledger,
    agent: {
      findMany: vi.fn(async (args: { where: { agentId: { in: string[] } } }) =>
        args.where.agentId.in
          .filter((id) => (overrides.agents ?? []).includes(id))
          .map((agentId) => ({ agentId })),
      ),
    },
    decisionShadowLedger: {
      upsert: vi.fn(async (args: { where: { ledgerId: string }; create: Record<string, unknown> }) => {
        ledger.push(args);
        return args.create;
      }),
    },
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
    const outcome = mapConsultOutcome(makeResult());
    expect(outcome.outcomeType).toBe("recommend");
    expect(outcome.riskTier).toBe("low");
    // BI-2107B5D2: the score is now COMPUTED from the real margin, not the
    // constant 0.9 this used to assert. Constants meant every recommend row
    // carried the same number, so the margin distribution did not exist.
    expect(outcome.confidenceScore).toBeGreaterThanOrEqual(0.5);
    expect(outcome.verdictCause).toBeNull();
  });

  // BI-2107B5D2: a commandment conflict is a DECLINE — the gate weighed the
  // question and the answer is no, with a named cause. It used to escalate,
  // which made a decisive no indistinguishable from an unresolved maybe.
  it("maps a commandment conflict to decline/high-risk with its cause named", () => {
    const result = makeResult();
    result.flags.commandmentConflict = true;
    result.flags.commandmentConflictPrinciples = ["never-fabricate"];
    expect(mapConsultOutcome(result).outcomeType).toBe("decline");
    expect(mapConsultOutcome(result).riskTier).toBe("high");
    expect(mapConsultOutcome(result).verdictCause).toBe("commandment-conflict");
    // Retrying cannot resolve a conflict with a commandment.
    expect(mapConsultOutcome(result).retryHint).toBeNull();
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
      // BI-2107B5D2: a corpus gap is named, and says what to change — an
      // identical retry against the same empty corpus returns the same nothing.
      verdictCause: "insufficient-signal",
      retryHint: expect.any(String),
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
      scoredOptions: [
        { id: "option-a", description: "Reuse table", features: { blast_radius: -0.2 } },
        { id: "option-b", description: "New table", features: { blast_radius: -0.7 } },
      ],
      appliedPrincipleCount: 21,
      callingSurface: "claude-code",
      policyProjection: {
        policyAffirmativeOptionId: "proceed",
        dualControlRequired: false,
        policyActionBinding: {
          actionKey: "record_initiative_evidence",
          subject: { kind: "backlog-item", id: "BI-2014236E" },
          organizationId: "platform",
          professionId: null,
          routeContext: "/build/work/WC-48A3D214",
          artifactFingerprint: "sha256:exact",
        },
      },
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
    // BI-01F8F06D: a consult with no human behind it is unattended, and must be
    // excluded from an agreement denominator by construction. This fixture has
    // no triggeredByUserId, so it is an agent asking the kernel.
    expect(row.autonomous).toBe(true);
    expect(row.outcomeType).toBe("recommend");
    expect(row.question).toBe("Which storage approach should we take?");
    expect(row.options).toEqual(["option-a", "option-b"]);
    expect(row.phaseFrom).toBeNull();
    expect(row.phaseTo).toBeNull();
    // BI-F302B80E: the pick belongs in its own indexed column, not only in the
    // JSON blob. It was written to the payload and the seal while this column
    // stayed NULL, so 657 recorded recommendations across the corpus were
    // unqueryable — and agreement cannot be measured against a value nothing
    // can select. Assert the column, not just the payload copy.
    expect(row.recommendedOptionId).toBe("option-a");
    // BI-F302B80E part 2: record the MENU beside the pick. A row carrying a
    // recommendation but no scored options can be counted and never learned
    // from — weight-inference-adapter requires scoredOptions, the pick and the
    // later outcome together, and this path wrote null for the first of them.
    expect(row.scoredOptions).toEqual([
      { id: "option-a", description: "Reuse table", features: { blast_radius: -0.2 } },
      { id: "option-b", description: "New table", features: { blast_radius: -0.7 } },
    ]);
    // The outcome columns stay empty until the caller reports back. Absence is
    // "nobody said", never "they agreed".
    expect(row.chosenOptionId ?? null).toBeNull();
    expect(row.humanOutcome ?? null).toBeNull();
    const payload = row.outcomePayload as Record<string, unknown>;
    expect(payload.tool).toBe("principle_decide");
    expect(payload.recommendedOptionId).toBe("option-a");
    expect(payload.callingPopulation).toBe("external_coding_agent");
    expect(payload.callingSurface).toBe("claude-code");
    expect(payload.policyAffirmativeOptionId).toBe("proceed");
    expect(payload.dualControlRequired).toBe(false);
    expect(payload.policyActionBinding).toEqual({
      actionKey: "record_initiative_evidence",
      subject: { kind: "backlog-item", id: "BI-2014236E" },
      organizationId: "platform",
      professionId: null,
      routeContext: "/build/work/WC-48A3D214",
      artifactFingerprint: "sha256:exact",
    });
    expect(Array.isArray(payload.topContributors)).toBe(true);
  });

  // BI-6082C235: the coworker that asked the kernel was recorded only inside
  // outcomePayload.caller, so no decision could be attributed to a coworker
  // and the shadow ledger stayed empty. It now lands in its own column and the
  // decision is bridged into the ledger, at shadow, record only.
  it("records the asking coworker and bridges the decision into the shadow ledger", async () => {
    const db = makeDb({ agents: ["AGT-EXT-CLAUDE"] });
    const outcome = await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "q",
      optionIds: ["option-a", "option-b"],
      optionDescriptions: {},
      appliedPrincipleCount: 1,
      caller: { client: "claude-code/2", agentId: "AGT-EXT-CLAUDE" },
    });

    expect(outcome.recorded).toBe(true);
    expect(db.created[0]!.agentId).toBe("AGT-EXT-CLAUDE");
    expect(outcome.shadowLedger).toEqual({
      written: true,
      ledgerId: `DSL-${outcome.interactionId}`,
      agreement: null,
    });
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger[0]!.create).toMatchObject({
      agentId: "AGT-EXT-CLAUDE",
      activityType: "governed_decision_kernel_consult",
      riskClass: "internal-reversible",
      autonomyLevel: "shadow",
      decisionInteractionId: outcome.interactionId,
      agreement: null,
    });
  });

  it("records no coworker, and writes no ledger row, for an id no Agent row carries", async () => {
    const db = makeDb({ agents: [] });
    const outcome = await recordKernelConsultInteraction({
      db: db as never,
      result: makeResult(),
      callerContext: wwmdContext,
      question: "q",
      optionIds: ["a"],
      optionDescriptions: {},
      appliedPrincipleCount: 1,
      caller: { agentId: "AGT-GHOST" },
    });

    expect(outcome.recorded).toBe(true);
    expect(db.created[0]!.agentId).toBeNull();
    // The caller's declaration is still kept, verbatim, where it always was.
    expect((db.created[0]!.outcomePayload as { caller: { agentId: string } }).caller.agentId).toBe("AGT-GHOST");
    expect(outcome.shadowLedger).toBeNull();
    expect(db.ledger).toHaveLength(0);
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

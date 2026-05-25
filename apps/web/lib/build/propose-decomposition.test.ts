// apps/web/lib/build/propose-decomposition.test.ts
//
// Coverage for Phase 4b orchestrator that calls the SE coworker, parses the
// candidate JSON, validates each candidate, and persists the validated set.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.

import { describe, expect, it, vi } from "vitest";

import {
  buildDecompositionPrompt,
  proposeDecomposition,
  type ProposeDecompositionDb,
} from "./propose-decomposition";
import type { DecompositionCandidate } from "./decomposition-candidates";
import type {
  BuildDesignDoc,
  SizeAssessmentSnapshot,
} from "@/lib/explore/feature-build-types";

// --- Helpers ---------------------------------------------------------------

function makeDesignDoc(): BuildDesignDoc {
  return {
    problemStatement: "stop driving back to the warehouse",
    reusePlan: "n/a",
    proposedApproach: "list + usage + low-stock",
    acceptanceCriteria: ["AC0", "AC1", "AC2", "AC3", "AC4"],
  };
}

function makeAssessment(
  decision: SizeAssessmentSnapshot["decision"] = "decompose-required",
): SizeAssessmentSnapshot {
  return {
    decision,
    breakdown: {
      models: { count: 5, samples: [] },
      endpoints: { count: 2, samples: [] },
      acs: { count: 5 },
      multipliers: { count: 4, matchedKeywords: [] },
      routes: { count: 2, samples: [] },
    },
    trips: [
      { dimension: "models", level: "required", threshold: 5, observed: 5 },
      { dimension: "multipliers", level: "required", threshold: 4, observed: 4 },
    ],
    rationale: "test",
    thresholds: {
      models: { recommend: 3, required: 5 },
      endpoints: { recommend: 4, required: 7 },
      acs: { recommend: 12, required: 20 },
      multipliers: { recommend: 2, required: 4 },
      routes: { recommend: 2, required: 4 },
    },
    assessedAt: "2026-05-24T20:00:00.000Z",
  };
}

function makeValidCandidate(): DecompositionCandidate {
  return {
    candidateId: "candidate-1",
    rationale: "Read first, write second.",
    childScopes: [
      { childOrder: 1, title: "Read", summary: "Show parts", acceptanceCriteriaIndices: [0, 1], dependsOn: [] },
      { childOrder: 2, title: "Write", summary: "Record usage", acceptanceCriteriaIndices: [2, 3, 4], dependsOn: [1] },
    ],
  };
}

function makeReview(decision: SizeAssessmentSnapshot["decision"] | null = "decompose-required") {
  return {
    decision: "pass" as const,
    issues: [],
    summary: "ok",
    ...(decision != null ? { sizeAssessment: makeAssessment(decision) } : {}),
  };
}

type FakeBuildShape = {
  buildId: string;
  title: string;
  phase: string;
  designDoc: unknown;
  designReview: unknown;
  parentEpicId: string | null;
};

function makeFakeDb(
  build: FakeBuildShape | null,
): { db: ProposeDecompositionDb; updates: Array<{ data: Record<string, unknown> }> } {
  const updates: Array<{ data: Record<string, unknown> }> = [];
  const db: ProposeDecompositionDb = {
    featureBuild: {
      findUnique: vi.fn(async () => build as never) as unknown as ProposeDecompositionDb["featureBuild"]["findUnique"],
      update: vi.fn(async (args: { data: Record<string, unknown> }) => {
        updates.push({ data: args.data });
        return null as never;
      }) as unknown as ProposeDecompositionDb["featureBuild"]["update"],
    },
  };
  return { db, updates };
}

function makeBuild(overrides: Partial<FakeBuildShape> = {}): FakeBuildShape {
  return {
    buildId: "FB-DALE",
    title: "Truck inventory",
    phase: "ideate",
    designDoc: makeDesignDoc(),
    designReview: makeReview("decompose-required"),
    parentEpicId: null,
    ...overrides,
  };
}

const fixedNow = () => new Date("2026-05-24T20:30:00.000Z");

// --- Eligibility paths -----------------------------------------------------

describe("proposeDecomposition — eligibility checks", () => {
  it("rejects when build is missing", async () => {
    const { db } = makeFakeDb(null);
    const result = await proposeDecomposition({
      buildId: "FB-MISSING",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-not-found");
  });

  it("rejects when build is not in ideate", async () => {
    const { db } = makeFakeDb(makeBuild({ phase: "plan" }));
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-not-in-ideate");
  });

  it("rejects when designDoc is missing", async () => {
    const { db } = makeFakeDb(makeBuild({ designDoc: null }));
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-missing-design-doc");
  });

  it("rejects when designReview is not pass", async () => {
    const { db } = makeFakeDb(
      makeBuild({ designReview: { decision: "fail", issues: [], summary: "x" } }),
    );
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-design-review-not-passed");
  });

  it("rejects when no sizeAssessment is recorded (pre-Phase-2 build)", async () => {
    const { db } = makeFakeDb(makeBuild({ designReview: makeReview(null) }));
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-no-size-assessment");
  });

  it("rejects when size assessment decision is ok", async () => {
    const { db } = makeFakeDb(makeBuild({ designReview: makeReview("ok") }));
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-size-already-ok");
  });

  it("rejects recursive decomposition", async () => {
    const { db } = makeFakeDb(makeBuild({ parentEpicId: "epic-row-x" }));
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-already-decomposed");
  });
});

// --- Agent call path -------------------------------------------------------

describe("proposeDecomposition — agent call + parsing", () => {
  it("returns agent-call-failed when callAgent throws", async () => {
    const { db } = makeFakeDb(makeBuild());
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(async () => {
        throw new Error("model timeout");
      }),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("agent-call-failed");
    expect(result.error).toMatch(/model timeout/);
  });

  it("returns no-valid-candidates when agent returns garbage", async () => {
    const { db } = makeFakeDb(makeBuild());
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(async () => "not json at all"),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("no-valid-candidates");
  });

  it("returns no-valid-candidates when every candidate fails validation", async () => {
    const { db } = makeFakeDb(makeBuild());
    // Solo-child candidate fails validateCandidate (too-few-children).
    const bad = {
      candidates: [
        {
          candidateId: "c-bad",
          rationale: "Solo",
          childScopes: [
            { childOrder: 1, title: "Solo", summary: "", acceptanceCriteriaIndices: [0, 1, 2, 3, 4], dependsOn: [] },
          ],
        },
      ],
    };
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(async () => JSON.stringify(bad)),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("no-valid-candidates");
  });

  it("accepts valid candidates and surfaces rejected ones for observability", async () => {
    const { db, updates } = makeFakeDb(makeBuild());
    const mixed = {
      candidates: [
        makeValidCandidate(), // good
        {
          candidateId: "c-bad",
          rationale: "Bad split",
          childScopes: [
            { childOrder: 1, title: "Solo", summary: "", acceptanceCriteriaIndices: [0, 1, 2, 3, 4], dependsOn: [] },
          ],
        },
      ],
    };
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(async () => JSON.stringify(mixed)),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.candidateId).toBe("candidate-1");
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reasons.some((r) => r.includes("too-few-children"))).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("strips code fences from agent output", async () => {
    const { db } = makeFakeDb(makeBuild());
    const fenced = "```json\n" + JSON.stringify({ candidates: [makeValidCandidate()] }) + "\n```";
    const result = await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(async () => fenced),
      db,
      now: fixedNow,
    });
    expect(result.ok).toBe(true);
  });

  it("persists candidates to designReview.decompositionCandidates.latest", async () => {
    const { db, updates } = makeFakeDb(makeBuild());
    await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      callAgent: vi.fn(async () => JSON.stringify({ candidates: [makeValidCandidate()] })),
      db,
      now: fixedNow,
    });
    const persisted = updates[0]!.data.designReview as {
      decompositionCandidates: { latest: DecompositionCandidate[]; latestGeneratedAt: string };
    };
    expect(persisted.decompositionCandidates.latest).toHaveLength(1);
    expect(persisted.decompositionCandidates.latestGeneratedAt).toBe("2026-05-24T20:30:00.000Z");
  });

  it("appends prior candidates to priorRounds on regenerate", async () => {
    // Build already has a prior candidate set on its review.
    const buildWithPrior = makeBuild({
      designReview: {
        ...makeReview("decompose-required"),
        decompositionCandidates: {
          latest: [makeValidCandidate()],
          latestGeneratedAt: "2026-05-24T20:00:00.000Z",
          latestOperatorHint: null,
          priorRounds: [],
        },
      },
    });
    const { db, updates } = makeFakeDb(buildWithPrior);
    await proposeDecomposition({
      buildId: "FB-DALE",
      userId: "u",
      operatorHint: "make the read-first smaller",
      callAgent: vi.fn(async () => JSON.stringify({ candidates: [makeValidCandidate()] })),
      db,
      now: fixedNow,
    });
    const persisted = updates[0]!.data.designReview as {
      decompositionCandidates: {
        latest: DecompositionCandidate[];
        latestOperatorHint: string | null;
        priorRounds: unknown[];
      };
    };
    expect(persisted.decompositionCandidates.priorRounds).toHaveLength(1);
    expect(persisted.decompositionCandidates.latestOperatorHint).toBe("make the read-first smaller");
  });
});

// --- Prompt construction ---------------------------------------------------

describe("buildDecompositionPrompt", () => {
  it("includes the parent's 0-indexed acceptance criteria list", () => {
    const prompt = buildDecompositionPrompt(makeDesignDoc(), makeAssessment());
    expect(prompt).toMatch(/0\. AC0/);
    expect(prompt).toMatch(/4\. AC4/);
  });

  it("includes the size-assessment trip evidence", () => {
    const prompt = buildDecompositionPrompt(makeDesignDoc(), makeAssessment());
    expect(prompt).toMatch(/models=5/);
    expect(prompt).toMatch(/multipliers=4/);
  });

  it("includes the operator hint when supplied", () => {
    const prompt = buildDecompositionPrompt(makeDesignDoc(), makeAssessment(), "ship ledger separately");
    expect(prompt).toMatch(/ship ledger separately/);
    expect(prompt).toMatch(/Operator regenerate hint/);
  });

  it("omits the hint section when none supplied", () => {
    const prompt = buildDecompositionPrompt(makeDesignDoc(), makeAssessment());
    expect(prompt).not.toMatch(/Operator regenerate hint/);
  });

  it("explicitly demands JSON-only output", () => {
    const prompt = buildDecompositionPrompt(makeDesignDoc(), makeAssessment());
    expect(prompt).toMatch(/JSON object of this shape \(no prose around it/i);
  });

  it("names the validator's strict rules so the agent self-corrects", () => {
    const prompt = buildDecompositionPrompt(makeDesignDoc(), makeAssessment());
    expect(prompt).toMatch(/2 to 4 child scopes/);
    expect(prompt).toMatch(/no gaps and no duplicates/);
    expect(prompt).toMatch(/EXACTLY ONE child/);
    expect(prompt).toMatch(/No self-loops, no cycles/);
  });
});

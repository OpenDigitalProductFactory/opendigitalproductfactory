// apps/web/lib/gear-interface/governor/graduation.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

const gearRows = new Map<string, Record<string, unknown>>();

vi.mock("@dpf/db", () => ({
  prisma: {
    gearInterface: {
      findUnique: vi.fn(async ({ where }: { where: { idempotencyKey: string } }) => {
        return gearRows.get(where.idempotencyKey) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `gear-${gearRows.size + 1}`, ...data };
        gearRows.set(String(data.idempotencyKey), row);
        return row;
      }),
    },
  },
  Prisma: {},
}));

import { emitGraduation, emitVeto } from "./graduation";
import type { GovernorConsultResult } from "./index";
import type { CalibrationKey, TrustReading } from "../calibrator";

const TRIPLE: CalibrationKey = {
  agentIdForTriple: "agent-build-specialist",
  capabilityName: "build-phase-build",
  archetypeContext: "hvac",
  interfaceClass: "internal-adjacent",
  innerRing: 2,
  outerRing: 3,
  autonomyLevel: "hitl-required",
};

const TRUST: TrustReading = {
  score: 0.9,
  sampleSize: 24,
  confidence: 1.0,
  lastSeenAt: new Date(),
  recentFailureCount: 0,
  humanGradedCount: 4,
};

beforeEach(() => {
  gearRows.clear();
  vi.clearAllMocks();
});

describe("emitGraduation", () => {
  it("returns null when consult is not graduation-eligible", async () => {
    const result = await emitGraduation({
      triple: TRIPLE,
      consult: {
        verdict: "require-hitl",
        recommendedTier: "hitl-required",
        trust: TRUST,
        graduationEligible: false,
        rationale: "not eligible",
      },
      governorRef: "gov-1",
    });
    expect(result).toBeNull();
  });

  it("emits a graduation row with from/to tiers and governorRef set", async () => {
    const consult: GovernorConsultResult = {
      verdict: "allow-with-notify",
      recommendedTier: "hitl-fallback",
      trust: TRUST,
      graduationEligible: true,
      rationale: "hitl-required → hitl-fallback: trust 90% across 24 samples",
    };
    const result = await emitGraduation({ triple: TRIPLE, consult, governorRef: "gov-graduation-1" });
    expect(result).not.toBeNull();
    expect(result!.isNew).toBe(true);

    const stored = Array.from(gearRows.values())[0]!;
    expect(stored.outcomeType).toBe("graduation");
    expect(stored.graduationFromAutonomy).toBe("hitl-required");
    expect(stored.graduationToAutonomy).toBe("hitl-fallback");
    expect(stored.graduationSampleSize).toBe(24);
    expect(stored.graduationGovernorRef).toBe("gov-graduation-1");
    expect(stored.actorId).toBe("autonomy-governor");
    expect(stored.actorType).toBe("system");
    expect(stored.graderType).toBe("deliberation");
    expect(stored.innerRing).toBe(2);
    expect(stored.outerRing).toBe(3);
    expect(stored.archetypeContext).toBe("hvac");
  });

  it("is idempotent — same governorRef returns existing row on replay", async () => {
    const consult: GovernorConsultResult = {
      verdict: "allow-with-notify",
      recommendedTier: "hitl-fallback",
      trust: TRUST,
      graduationEligible: true,
      rationale: "eligible",
    };
    const a = await emitGraduation({ triple: TRIPLE, consult, governorRef: "gov-replay-1" });
    const b = await emitGraduation({ triple: TRIPLE, consult, governorRef: "gov-replay-1" });
    expect(a!.id).toBe(b!.id);
    expect(b!.isNew).toBe(false);
    expect(gearRows.size).toBe(1);
  });
});

describe("emitVeto", () => {
  it("emits a veto row linked to the graduation by governorRef", async () => {
    const result = await emitVeto({
      triple: TRIPLE,
      governorRef: "gov-graduation-1",
      operatorId: "operator-mark",
      rationale: "Three other triples regressed after the same kind of elevation last week.",
    });
    expect(result).not.toBeNull();
    const stored = Array.from(gearRows.values())[0]!;
    expect(stored.outcomeType).toBe("veto");
    expect(stored.slipDetected).toBe(true);
    expect(stored.slipReason).toBe("human-override");
    expect(stored.graduationGovernorRef).toBe("gov-graduation-1");
    expect(stored.actorType).toBe("human");
    expect(stored.actorId).toBe("operator-mark");
    expect(stored.graderType).toBe("human");
    expect(stored.torqueTechnical).toBe(0);
    expect(stored.graduationFromAutonomy).toBe(stored.graduationToAutonomy); // veto cancels elevation
  });

  it("uses a distinct idempotency key from the graduation it pairs with", async () => {
    const graduation = await emitGraduation({
      triple: TRIPLE,
      consult: {
        verdict: "allow-with-notify",
        recommendedTier: "hitl-fallback",
        trust: TRUST,
        graduationEligible: true,
        rationale: "x",
      },
      governorRef: "gov-pair-1",
    });
    const veto = await emitVeto({
      triple: TRIPLE,
      governorRef: "gov-pair-1",
      operatorId: "operator-mark",
      rationale: "rolled back",
    });
    expect(graduation!.idempotencyKey).not.toBe(veto!.idempotencyKey);
    expect(gearRows.size).toBe(2);
  });
});

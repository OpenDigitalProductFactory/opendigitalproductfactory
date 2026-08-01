import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_VIA_METHODS,
  assessIncumbentsViaPostureMatrix,
  assessmentIdFor,
  confirmCoverageAssessment,
  isAssessmentVia,
  isCoverageVerdict,
  providerOfIncumbent,
} from "./incumbent-coverage";

// D3 P1 tests (BI-548060D5). PrismaClient is injected, so a mock stands in —
// runs in the source-only worktree without a live client.

function makeDb(opts: {
  incumbents?: { productId: string; name: string; observationConfig: unknown }[];
  posture?: { verdict: string; coveringPrimitive: string | null; confidence: number; providerName: string; integrationCategory: string } | null;
  existing?: { verdict: string; assessedVia: string; status: string } | null;
}) {
  const create = vi.fn().mockResolvedValue({});
  const update = vi.fn().mockResolvedValue({});
  const db = {
    digitalProduct: {
      findMany: vi.fn().mockResolvedValue(opts.incumbents ?? []),
    },
    absorptionPosture: {
      findFirst: vi.fn().mockResolvedValue(opts.posture ?? null),
    },
    incumbentCoverageAssessment: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      create,
      update,
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { db, create, update };
}

const POSTURE = {
  verdict: "provider_led",
  coveringPrimitive: null,
  confidence: 0.3,
  providerName: "Mindbody",
  integrationCategory: "fitness-management",
};

describe("enum predicates", () => {
  it("assessedVia methods are the closed set", () => {
    expect([...ASSESSMENT_VIA_METHODS]).toEqual(["posture_matrix", "rule", "ai", "human_confirmed"]);
    expect(isAssessmentVia("posture_matrix")).toBe(true);
    expect(isAssessmentVia("guess")).toBe(false);
  });
  it("verdict vocabulary reuses AbsorptionPosture's", () => {
    expect(isCoverageVerdict("provider_led")).toBe(true);
    expect(isCoverageVerdict("gap")).toBe(true);
    expect(isCoverageVerdict("made_up")).toBe(false);
  });
});

describe("providerOfIncumbent / assessmentIdFor", () => {
  it("prefers observationConfig.vendor, falls back to name", () => {
    expect(providerOfIncumbent({ name: "MB App", observationConfig: { vendor: "Mindbody Inc" } })).toBe("Mindbody Inc");
    expect(providerOfIncumbent({ name: "Mindbody", observationConfig: null })).toBe("Mindbody");
  });
  it("derives a stable, deterministic assessmentId", () => {
    expect(assessmentIdFor("DP-incumbent-mindbody")).toBe("assess-dp-incumbent-mindbody");
  });
});

describe("assessIncumbentsViaPostureMatrix", () => {
  const inc = { productId: "DP-incumbent-mindbody", name: "Mindbody", observationConfig: { vendor: "Mindbody" } };

  it("creates an assessment carrying the posture verdict + provenance", async () => {
    const { db, create } = makeDb({ incumbents: [inc], posture: POSTURE, existing: null });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result).toEqual({ assessed: 1, matched: 1, gaps: 0, unchanged: 0 });
    const data = create.mock.calls[0]![0].data;
    expect(data.verdict).toBe("provider_led");
    expect(data.assessedVia).toBe("posture_matrix");
    expect(data.status).toBe("proposed");
    expect(data.assessmentId).toBe("assess-dp-incumbent-mindbody");
  });

  it("records a gap when no posture names the provider", async () => {
    const { db, create } = makeDb({ incumbents: [inc], posture: null, existing: null });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result.gaps).toBe(1);
    expect(create.mock.calls[0]![0].data.verdict).toBe("gap");
  });

  it("is idempotent — an unchanged posture_matrix default is left alone", async () => {
    const { db, create, update } = makeDb({
      incumbents: [inc],
      posture: POSTURE,
      existing: { verdict: "provider_led", assessedVia: "posture_matrix", status: "proposed" },
    });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result.unchanged).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("never clobbers a human-confirmed verdict", async () => {
    const { db, create, update } = makeDb({
      incumbents: [inc],
      posture: { ...POSTURE, verdict: "native_now" },
      existing: { verdict: "do_not_absorb", assessedVia: "human_confirmed", status: "confirmed" },
    });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result.unchanged).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("updates in place when the posture verdict changed", async () => {
    const { db, create, update } = makeDb({
      incumbents: [inc],
      posture: { ...POSTURE, verdict: "generic_connector" },
      existing: { verdict: "provider_led", assessedVia: "posture_matrix", status: "proposed" },
    });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result.assessed).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(update.mock.calls[0]![0].data.verdict).toBe("generic_connector");
  });
});

describe("confirmCoverageAssessment", () => {
  it("is the only path to confirmed + human_confirmed provenance", async () => {
    const { db, update } = makeDb({});
    await confirmCoverageAssessment(db as never, "assess-x", "adapter_bridge");
    const arg = update.mock.calls[0]![0];
    expect(arg.where).toEqual({ assessmentId: "assess-x" });
    expect(arg.data).toEqual({ assessedVia: "human_confirmed", status: "confirmed", verdict: "adapter_bridge" });
  });
});

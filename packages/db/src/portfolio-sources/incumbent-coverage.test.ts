import { describe, expect, it, vi } from "vitest";
import {
  ASSESSMENT_VIA_METHODS,
  assessIncumbentsViaPostureMatrix,
  assessIncumbentsViaRule,
  assessmentIdFor,
  confirmCoverageAssessment,
  coveringBusinessCapabilityForCategory,
  isAssessmentVia,
  isCoverageVerdict,
  normalizeAbsorptionIdentityKey,
  providerOfIncumbent,
  resolveAbsorptionPosture,
} from "./incumbent-coverage";

// D3 P1 tests (BI-548060D5). PrismaClient is injected, so a mock stands in —
// runs in the source-only worktree without a live client.

function makeDb(opts: {
  incumbents?: { productId: string; name: string; observationConfig: unknown }[];
  posture?: { verdict: string; coveringPrimitive: string | null; confidence: number; providerName: string; integrationCategory: string } | null;
  postures?: { verdict: string; coveringPrimitive: string | null; confidence: number; providerName: string; integrationCategory: string; catalogIdentityId?: string | null; archetypeIds?: string[] }[];
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
      findMany: vi.fn().mockResolvedValue(opts.postures ?? (opts.posture ? [opts.posture] : [])),
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

describe("resolveAbsorptionPosture", () => {
  const cms = {
    ...POSTURE,
    providerName: "WordPress",
    integrationCategory: "content-management",
    catalogIdentityId: "catalog-wordpress",
    archetypeIds: ["professional-services"],
  };
  const commerce = {
    ...POSTURE,
    providerName: "WordPress",
    integrationCategory: "commerce",
    catalogIdentityId: "catalog-wordpress-commerce",
    archetypeIds: ["retail"],
  };

  it("normalizes identity keys once for case and separator variation", () => {
    expect(normalizeAbsorptionIdentityKey("  WordPress.COM / CMS  ")).toBe("wordpress-com-cms");
  });

  it("prefers normalized catalog identity over provider ambiguity", async () => {
    const { db } = makeDb({ postures: [cms, commerce] });
    await expect(resolveAbsorptionPosture(db as never, {
      providerName: "WORDPRESS",
      catalogIdentityId: " CATALOG-WORDPRESS ",
    })).resolves.toMatchObject({ status: "matched", matchedBy: "catalog-identity", posture: cms });
  });

  it("uses an explicit normalized category when one provider has several postures", async () => {
    const { db } = makeDb({ postures: [cms, commerce] });
    await expect(resolveAbsorptionPosture(db as never, {
      providerName: "WORDPRESS ",
      integrationCategory: "Content Management",
    })).resolves.toMatchObject({ status: "matched", matchedBy: "provider-category", posture: cms });
  });

  it("falls back to provider-only only when exactly one normalized row exists", async () => {
    const { db } = makeDb({ postures: [cms] });
    await expect(resolveAbsorptionPosture(db as never, { providerName: " WORDPRESS " }))
      .resolves.toMatchObject({ status: "matched", matchedBy: "unique-provider", posture: cms });
  });

  it("uses an explicit capability when category is unavailable", async () => {
    const { db } = makeDb({
      postures: [
        { ...cms, coveringPrimitive: "managed-content" },
        { ...commerce, coveringPrimitive: "commerce-catalog" },
      ],
    });
    await expect(resolveAbsorptionPosture(db as never, {
      providerName: "WordPress",
      capabilityKey: "MANAGED CONTENT",
    })).resolves.toMatchObject({ status: "matched", matchedBy: "provider-capability", posture: { integrationCategory: "content-management" } });
  });

  it("returns evidenced ambiguity instead of choosing an arbitrary provider row", async () => {
    const { db } = makeDb({ postures: [commerce, cms] });
    const result = await resolveAbsorptionPosture(db as never, { providerName: "WORDPRESS" });
    expect(result).toMatchObject({
      status: "ambiguous",
      evidence: { providerKey: "wordpress", candidateCategories: ["commerce", "content-management"] },
    });
  });

  it("returns an evidenced gap when no normalized posture matches", async () => {
    const { db } = makeDb({ postures: [] });
    await expect(resolveAbsorptionPosture(db as never, { providerName: "Unknown CMS" }))
      .resolves.toMatchObject({ status: "missing", evidence: { providerKey: "unknown-cms" } });
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

  it("records multi-category ambiguity as a gap proposal instead of selecting the first row", async () => {
    const postures = [
      { ...POSTURE, providerName: "WordPress", integrationCategory: "commerce", catalogIdentityId: null, archetypeIds: [] },
      { ...POSTURE, providerName: "WordPress", integrationCategory: "content-management", catalogIdentityId: null, archetypeIds: [] },
    ];
    const { db, create } = makeDb({ incumbents: [{ ...inc, name: "WordPress", observationConfig: null }], postures });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result).toMatchObject({ assessed: 1, matched: 0, gaps: 1 });
    expect(create.mock.calls[0]![0].data.evidence).toMatchObject({
      resolution: "ambiguous",
      candidateCategories: ["commerce", "content-management"],
    });
  });

  it("uses an intake-recorded category to resolve the same multi-category provider", async () => {
    const postures = [
      { ...POSTURE, providerName: "WordPress", integrationCategory: "commerce", catalogIdentityId: null, archetypeIds: [] },
      { ...POSTURE, providerName: "WordPress", integrationCategory: "content-management", catalogIdentityId: null, archetypeIds: [] },
    ];
    const { db, create } = makeDb({
      incumbents: [{ ...inc, name: "WordPress", observationConfig: { vendor: "wordpress", integrationCategory: "CONTENT MANAGEMENT" } }],
      postures,
    });
    const result = await assessIncumbentsViaPostureMatrix(db as never);
    expect(result).toMatchObject({ assessed: 1, matched: 1, gaps: 0 });
    expect(create.mock.calls[0]![0].data.evidence.matchedPosture).toBe("WordPress/content-management");
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

describe("stage 2 — rule (covering business capability)", () => {
  it("resolves the covering capability for a covered category via the corpus", () => {
    const covering = coveringBusinessCapabilityForCategory("fitness-recreation");
    expect(covering).not.toBeNull();
    expect(covering!.category).toBe("fitness-recreation");
    expect(typeof covering!.businessCapabilityId).toBe("string");
  });

  it("returns null for an uncovered or missing category", () => {
    expect(coveringBusinessCapabilityForCategory("not-a-category")).toBeNull();
    expect(coveringBusinessCapabilityForCategory(null)).toBeNull();
  });

  function ruleDb(opts: { existing: { coveringBusinessCapabilityId: string | null; status: string } | null }) {
    const update = vi.fn().mockResolvedValue({});
    const db = {
      digitalProduct: {
        findMany: vi.fn().mockResolvedValue([
          { productId: "DP-incumbent-mindbody", name: "Mindbody", observationConfig: { vendor: "Mindbody" } },
        ]),
      },
      absorptionPosture: {
        findMany: vi.fn().mockResolvedValue([{
          ...POSTURE,
          catalogIdentityId: null,
          archetypeIds: ["gym", "yoga-studio"],
        }]),
      },
      storefrontArchetype: { findFirst: vi.fn().mockResolvedValue({ category: "fitness-recreation" }) },
      incumbentCoverageAssessment: {
        findUnique: vi.fn().mockResolvedValue(opts.existing),
        update,
      },
    };
    return { db, update };
  }

  it("enriches an existing assessment's covering capability", async () => {
    const { db, update } = ruleDb({ existing: { coveringBusinessCapabilityId: null, status: "proposed" } });
    const result = await assessIncumbentsViaRule(db as never);
    expect(result.enriched).toBe(1);
    expect(update.mock.calls[0]![0].data.coveringBusinessCapabilityId).toBeTruthy();
  });

  it("is idempotent when the covering capability is already set", async () => {
    const perspective = coveringBusinessCapabilityForCategory("fitness-recreation")!;
    const { db, update } = ruleDb({ existing: { coveringBusinessCapabilityId: perspective.businessCapabilityId, status: "proposed" } });
    const result = await assessIncumbentsViaRule(db as never);
    expect(result.skipped).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });

  it("never clobbers a human-confirmed assessment", async () => {
    const { db, update } = ruleDb({ existing: { coveringBusinessCapabilityId: null, status: "confirmed" } });
    const result = await assessIncumbentsViaRule(db as never);
    expect(result.skipped).toBe(1);
    expect(update).not.toHaveBeenCalled();
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

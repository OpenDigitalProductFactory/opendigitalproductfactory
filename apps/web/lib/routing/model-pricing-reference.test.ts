// Researched pricing must be exact or absent — never interpolated.
//
// The defect: every codex and zai model was unpriced in the live database, so
// `loader.ts` costed them at one flat provider rate. gpt-5.5-pro ($180/MTok out)
// and gpt-6-astra ($50) were both costed at $6 — 30x and 8x under. Any
// cost-weighted routing or budget decision taken on that data is invalid.
import { describe, it, expect } from "vitest";
import {
  referencePricingFor,
  normalizeModelIdForPricing,
  providerCostModel,
  pricingProvenance,
  pricedModelIds,
  referenceCardPricing,
} from "./model-pricing-reference";

describe("model pricing reference", () => {
  it("prices the frontier models that were most underpriced", () => {
    expect(referencePricingFor("gpt-6-astra")).toEqual({ inputPerMToken: 10, outputPerMToken: 50 });
    expect(referencePricingFor("gpt-5.5-pro")).toEqual({ inputPerMToken: 30, outputPerMToken: 180 });
    expect(referencePricingFor("claude-opus-5")).toEqual({ inputPerMToken: 5, outputPerMToken: 25 });
  });

  it("prices cheap models cheaply — the error ran both ways", () => {
    // Costed at the $6 provider default despite being $1.20.
    expect(referencePricingFor("gpt-5.6-luna")?.outputPerMToken).toBe(1.2);
    // Costed at the $4.40 provider default despite being $0.50.
    expect(referencePricingFor("glm-5.3-flash")?.outputPerMToken).toBe(0.5);
  });

  it("looks through a quarantine prefix to the real model", () => {
    const quarantined = "__dpf_quarantined__cmrli59gd07jb01qzz4ki5fw4__glm-5.2";
    expect(normalizeModelIdForPricing(quarantined)).toBe("glm-5.2");
    expect(referencePricingFor(quarantined)).toEqual(referencePricingFor("glm-5.2"));
  });

  it("REFUSES to guess a model it has not researched", () => {
    // Z.ai publishes no rate for glm-5-turbo, so it must read unpriced rather
    // than inherit a sibling's number.
    expect(referencePricingFor("glm-5-turbo")).toBeNull();
    expect(referencePricingFor("gpt-7-imaginary")).toBeNull();
    expect(referencePricingFor("")).toBeNull();
    expect(referencePricingFor(null)).toBeNull();
    expect(referencePricingFor(undefined)).toBeNull();
  });

  it("does NOT family-match, because siblings differ by orders of magnitude", () => {
    // gpt-5.6-luna is $1.20 and gpt-5.6-cyber is $75. A prefix match on "gpt-5.6"
    // would be a guess wearing a real number's clothes.
    expect(referencePricingFor("gpt-5.6")).toBeNull();
    expect(referencePricingFor("claude-opus")).toBeNull();
    expect(referencePricingFor("glm-5.3-flash-preview")).toBeNull();
  });

  it("records how each provider actually bills", () => {
    // A subscription's marginal token cost is not the same question as a
    // metered provider's rate; the router must be able to tell them apart.
    expect(providerCostModel("anthropic-sub")).toBe("subscription");
    expect(providerCostModel("codex")).toBe("token");
    expect(providerCostModel("local")).toBe("compute");
    expect(providerCostModel("nonexistent")).toBeNull();
  });

  it("carries provenance so a displayed price can cite its source and date", () => {
    const p = pricingProvenance();
    expect(p.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(p.sources)).toEqual(expect.arrayContaining(["openai", "anthropic", "zai"]));
  });

  it("is case and whitespace tolerant on lookup", () => {
    expect(referencePricingFor("  GPT-5.4  ")).toEqual(referencePricingFor("gpt-5.4"));
  });

  it("covers every model this install currently routes to", () => {
    // Regression guard: these are the ids observed in RouteDecisionLog.
    for (const id of ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "gpt-5.6-luna", "glm-5.2"]) {
      expect(referencePricingFor(id), id).not.toBeNull();
    }
    expect(pricedModelIds().length).toBeGreaterThan(40);
  });
});

describe("referenceCardPricing — what a provider adapter writes", () => {
  it("gives a researched model its real rate instead of nulls", () => {
    // Writing nulls is not neutral: the router then falls back to the
    // provider's single flat rate, collapsing every model under it to one
    // number, and a re-discovery erases whatever a backfill had recorded.
    // Measured live: gpt-6-astra was re-NULLed six days after the backfill,
    // and unpriced rows went 11 -> 34.
    const p = referenceCardPricing("claude-opus-5");
    expect(p.inputPerMToken).toBe(5);
    expect(p.outputPerMToken).toBe(25);
  });

  it("keeps returning nulls for a model it has not researched", () => {
    // The honest answer for an unknown model. Not the same as guessing one.
    const p = referenceCardPricing("glm-5-turbo");
    expect(p.inputPerMToken).toBeNull();
    expect(p.outputPerMToken).toBeNull();
  });

  it("carries the full card pricing shape, not a partial object", () => {
    const p = referenceCardPricing("claude-sonnet-5");
    expect(p).toHaveProperty("cacheReadPerMToken", null);
    expect(p).toHaveProperty("imageInputPerMToken", null);
  });

  it("prices the models the live install had wrong", () => {
    // These read 15/75 and 3/15 on the install — a generation stale, from an
    // adapter that wrote nulls over them and a seed that never corrected.
    expect(referenceCardPricing("claude-opus-5").outputPerMToken).toBe(25);
    expect(referenceCardPricing("claude-sonnet-5").outputPerMToken).toBe(10);
    expect(referenceCardPricing("gpt-6-astra").outputPerMToken).toBe(50);
  });
});

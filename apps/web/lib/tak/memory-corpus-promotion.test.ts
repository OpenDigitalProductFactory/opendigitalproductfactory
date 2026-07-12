import { describe, it, expect, vi } from "vitest";
import {
  isPromotableFact,
  buildFactCorpusInput,
  promoteOrgFactsToCorpus,
  type PromotableFact,
} from "./memory-corpus-promotion";

function fact(overrides: Partial<PromotableFact> = {}): PromotableFact {
  return {
    id: "UF-1",
    category: "domain_context",
    key: "shipping_regions",
    value: "EU only, Tuesdays",
    scope: "org",
    sensitivity: "normal",
    supersededAt: null,
    corpusPromotedAt: null,
    ...overrides,
  };
}

describe("isPromotableFact", () => {
  it("promotes a durable org-scoped normal business fact", () => {
    expect(isPromotableFact(fact())).toBe(true);
    expect(isPromotableFact(fact({ category: "decision" }))).toBe(true);
    expect(isPromotableFact(fact({ category: "constraint" }))).toBe(true);
  });

  it("rejects user-scoped, sensitive, superseded, or already-promoted facts", () => {
    expect(isPromotableFact(fact({ scope: "user" }))).toBe(false);
    expect(isPromotableFact(fact({ sensitivity: "sensitive" }))).toBe(false);
    expect(isPromotableFact(fact({ supersededAt: new Date() }))).toBe(false);
    expect(isPromotableFact(fact({ corpusPromotedAt: new Date() }))).toBe(false);
  });

  it("never promotes preference facts (per-user relationship memory, not org knowledge)", () => {
    expect(isPromotableFact(fact({ category: "preference" }))).toBe(false);
  });
});

describe("buildFactCorpusInput", () => {
  it("maps a fact onto the enrichOrgCorpus contract with qa/first-party provenance", () => {
    const input = buildFactCorpusInput(fact(), "ORG-1");
    expect(input.organizationId).toBe("ORG-1");
    expect(input.text).toBe("shipping_regions: EU only, Tuesdays");
    expect(input.trust).toBe("first-party");
    expect(input.provenance.sourceType).toBe("qa");
  });

  it("keys sourceRef on the stable fact key so re-promotion upserts the same page", () => {
    const a = buildFactCorpusInput(fact({ id: "UF-1", value: "old" }), "ORG-1");
    const b = buildFactCorpusInput(fact({ id: "UF-2", value: "new" }), "ORG-1");
    // Same key → identical sourceRef → same derived sourceKey downstream.
    expect(a.provenance.sourceRef).toEqual(b.provenance.sourceRef);
    expect(a.provenance.sourceRef).toMatchObject({ factKey: "shipping_regions" });
  });
});

describe("promoteOrgFactsToCorpus", () => {
  function makeDb(facts: PromotableFact[], org: { id: string } | null = { id: "ORG-1" }) {
    const updates: Array<{ id: string; corpusPromotedAt: unknown }> = [];
    return {
      updates,
      db: {
        organization: { findFirst: vi.fn(async (_args: unknown) => org) },
        userFact: {
          findMany: vi.fn(async (_args: unknown) => facts),
          update: vi.fn(async (args: unknown) => {
            const { where, data } = args as {
              where: { id: string };
              data: { corpusPromotedAt: unknown };
            };
            updates.push({ id: where.id, corpusPromotedAt: data.corpusPromotedAt });
            return {};
          }),
        },
      },
    };
  }

  it("promotes each eligible fact and stamps corpusPromotedAt", async () => {
    const { db, updates } = makeDb([fact({ id: "UF-1" }), fact({ id: "UF-2" })]);
    const enrich = vi.fn(async () => ({}));
    const res = await promoteOrgFactsToCorpus({ db, enrich });
    expect(res.promoted).toBe(2);
    expect(res.failed).toBe(0);
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(updates.map((u) => u.id)).toEqual(["UF-1", "UF-2"]);
    expect(updates[0]!.corpusPromotedAt).toBeInstanceOf(Date);
  });

  it("no-ops when the install has no organization", async () => {
    const { db } = makeDb([fact()], null);
    const enrich = vi.fn(async () => ({}));
    const res = await promoteOrgFactsToCorpus({ db, enrich });
    expect(res).toEqual({ promoted: 0, failed: 0 });
    expect(enrich).not.toHaveBeenCalled();
  });

  it("isolates a per-fact failure and continues (never aborts the pass)", async () => {
    const { db, updates } = makeDb([fact({ id: "UF-1" }), fact({ id: "UF-2" })]);
    const enrich = vi
      .fn()
      .mockRejectedValueOnce(new Error("inference blip"))
      .mockResolvedValueOnce({});
    const res = await promoteOrgFactsToCorpus({ db, enrich });
    expect(res.promoted).toBe(1);
    expect(res.failed).toBe(1);
    // Only the successful fact is stamped promoted.
    expect(updates.map((u) => u.id)).toEqual(["UF-2"]);
  });

  it("does not stamp a fact whose enrich succeeded but update is skipped when ineligible", async () => {
    // A preference fact slipping through the query is still rejected by the guard.
    const { db, updates } = makeDb([fact({ id: "UF-1", category: "preference" })]);
    const enrich = vi.fn(async () => ({}));
    const res = await promoteOrgFactsToCorpus({ db, enrich });
    expect(res.promoted).toBe(0);
    expect(enrich).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

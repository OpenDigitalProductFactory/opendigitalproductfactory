import { describe, expect, it } from "vitest";

import { DEMAND_PROJECTION_TEMPLATES } from "@dpf/db/federated-demand-contract";

import { buildDemandEnvelope, type ProjectableDemandSource } from "./demand-projection";

const source: ProjectableDemandSource = {
  localRecordRef: "BI-PRIVATE-123",
  title: "Portable capability request",
  summary: "A share-safe explanation of the reusable need.",
  workType: "feature",
  occurrenceCount: 3,
  product: "dpf-portal",
  scopeKind: "archetype-category",
  archetypeCategories: ["trades-maintenance"],
  archetypeIds: [],
  createdAt: new Date("2026-07-20T06:00:00.000Z"),
  updatedAt: new Date("2026-07-20T06:05:00.000Z"),
};

describe("buildDemandEnvelope", () => {
  it("projects a valid internal envelope with stable opaque references and digest", () => {
    const result = buildDemandEnvelope({
      source,
      identity: { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) },
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal",
      attribution: "organization",
    });

    expect(result.violations).toEqual([]);
    expect(result.envelope).toMatchObject({
      specVersion: "dpf.demand/1",
      title: source.title,
      summary: source.summary,
      audience: "internal",
      signal: { occurrenceCount: 3 },
      applicability: { product: "dpf-portal" },
      originVersion: source.updatedAt.getTime(),
    });
    expect(result.envelope.payloadDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result.envelope)).not.toContain(source.localRecordRef);
  });

  it("honors a narrower partner contract and never serializes local planning context", () => {
    const result = buildDemandEnvelope({
      source: {
        ...source,
        privatePlanning: { priority: 1, estimate: 13, workCapsuleId: "WC-SECRET" },
      } as typeof source,
      identity: { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) },
      contract: {
        ...DEMAND_PROJECTION_TEMPLATES.channel,
        fieldAllowList: {
          demand: [
            "specVersion", "envelopeId", "originInstallationId", "originRecordRef", "originVersion",
            "route", "audience", "title", "summary", "signal", "attribution", "createdAt", "updatedAt",
            "payloadDigest",
          ],
        },
      },
      audience: "partner",
      attribution: "pseudonymous",
    });

    expect(result.violations).toEqual([]);
    expect(result.envelope).not.toHaveProperty("workType");
    expect(result.envelope).not.toHaveProperty("applicability");
    expect(JSON.stringify(result.envelope)).not.toContain("WC-SECRET");
    expect(JSON.stringify(result.envelope)).not.toContain("estimate");
  });
});

describe("buildDemandEnvelope applicability (BI-7ED79807)", () => {
  const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };
  const build = (overrides: Partial<typeof source>) =>
    buildDemandEnvelope({
      source: { ...source, ...overrides },
      identity,
      contract: DEMAND_PROJECTION_TEMPLATES["same-organization"],
      audience: "internal",
      attribution: "organization",
    });

  it("projects archetype categories as namespaced refs so a receiver can scope relevance", () => {
    const result = build({ archetypeCategories: ["trades-maintenance", "logistics"] });
    expect(result.violations).toEqual([]);
    expect(result.envelope.applicability?.archetypeRefs).toEqual([
      "scope:archetype-category",
      "category:trades-maintenance",
      "category:logistics",
    ]);
  });

  it("marks a platform-scoped item as universally applicable, whatever the receiver's archetype", () => {
    const result = build({ scopeKind: "platform", archetypeCategories: [], archetypeIds: [] });
    expect(result.violations).toEqual([]);
    expect(result.envelope.applicability?.archetypeRefs).toEqual(["scope:platform"]);
  });

  it("projects specific archetype ids alongside categories", () => {
    const result = build({ archetypeCategories: ["logistics"], archetypeIds: ["cold-storage"] });
    expect(result.envelope.applicability?.archetypeRefs).toEqual([
      "scope:archetype-category",
      "category:logistics",
      "archetype:cold-storage",
    ]);
  });

  it("omits archetypeRefs entirely when the item declares no scope, rather than inventing one", () => {
    const result = build({ scopeKind: null, archetypeCategories: [], archetypeIds: [] });
    expect(result.violations).toEqual([]);
    expect(result.envelope.applicability?.archetypeRefs).toBeUndefined();
    expect(result.envelope.applicability).toEqual({ product: "dpf-portal" });
  });

  it("still carries archetype scope when the item has no product", () => {
    const result = build({ product: null });
    expect(result.envelope.applicability?.product).toBeUndefined();
    expect(result.envelope.applicability?.archetypeRefs).toEqual([
      "scope:archetype-category",
      "category:trades-maintenance",
    ]);
  });

  it("deduplicates and drops blank refs so the digest stays stable", () => {
    const result = build({ archetypeCategories: ["logistics", "logistics", "  "], archetypeIds: [""] });
    expect(result.envelope.applicability?.archetypeRefs).toEqual([
      "scope:archetype-category",
      "category:logistics",
    ]);
  });
});

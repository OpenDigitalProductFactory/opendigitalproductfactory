import { describe, expect, it } from "vitest";

import {
  federatedWorkOriginMarker,
  hasFederatedWorkOriginMarker,
  parseFederatedWorkOriginMarker,
  validateFederatedWorkPageV1,
  withFederatedWorkOriginMarker,
  type FederatedWorkPageV1,
} from "./federated-work-contract";

const origin = `inst_${"a".repeat(32)}`;

function page(overrides: Partial<FederatedWorkPageV1> = {}): FederatedWorkPageV1 {
  return {
    specVersion: "dpf.work-sync/1",
    originInstallationId: origin,
    generatedAt: "2026-09-02T04:00:00.000Z",
    items: [{
      itemId: "BI-ABCDEF01",
      title: "Mirror me",
      status: "open",
      type: "portfolio",
      body: "Body",
      priority: null,
      workType: "bug",
      triageOutcome: "build",
      effortSize: null,
      proposedOutcome: null,
      resolution: null,
      sensitivity: "internal",
      epicId: "EP-1FABA22D",
      source: "user-request",
      occurrenceCount: 1,
      scopeKind: "platform",
      archetypeCategories: [],
      archetypeIds: [],
      lifecycleTags: [],
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
      completedAt: null,
    }],
    epics: [{
      epicId: "EP-1FABA22D",
      title: "Purpose-aware installation",
      description: null,
      status: "in-progress",
      priority: null,
      investmentBucket: null,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
      completedAt: null,
    }],
    cursor: null,
    complete: true,
    ...overrides,
  };
}

describe("validateFederatedWorkPageV1", () => {
  it("accepts a well-formed page", () => {
    expect(validateFederatedWorkPageV1(page())).toEqual([]);
  });

  it("refuses the sensitivity tiers that never leave an installation", () => {
    const item = { ...page().items[0]!, sensitivity: "confidential" };
    expect(validateFederatedWorkPageV1(page({ items: [item] }))).toContain("items[0].sensitivity:local-only");
  });

  it("requires a cursor on an incomplete page and a real installation id", () => {
    expect(validateFederatedWorkPageV1(page({ complete: false }))).toContain("cursor:required-when-incomplete");
    expect(validateFederatedWorkPageV1(page({ originInstallationId: "not-an-id" }))).toContain("originInstallationId:invalid");
    expect(validateFederatedWorkPageV1(page({ specVersion: "dpf.work-sync/0" as never }))).toContain("specVersion:unsupported");
  });

  it("never throws on garbage", () => {
    expect(validateFederatedWorkPageV1(null)).toEqual(["page:not-an-object"]);
    expect(validateFederatedWorkPageV1({ items: "x", epics: 1 })).toEqual(
      expect.arrayContaining(["items:not-an-array", "epics:not-an-array"]),
    );
  });
});

describe("origin marker", () => {
  it("round-trips through the body and is idempotent", () => {
    const marked = withFederatedWorkOriginMarker("Context", origin, "BI-1");
    expect(marked).toBe(`Context\n\n${federatedWorkOriginMarker(origin, "BI-1")}`);
    expect(withFederatedWorkOriginMarker(marked, origin, "BI-1")).toBe(marked);
    expect(hasFederatedWorkOriginMarker(marked)).toBe(true);
    expect(parseFederatedWorkOriginMarker(marked)).toEqual({ originInstallationId: origin, recordId: "BI-1" });
  });

  it("matches only a standalone marker line, never prose that mentions it", () => {
    expect(hasFederatedWorkOriginMarker("The marker [origin:federatedWork:x:y] is documented here.")).toBe(false);
    expect(hasFederatedWorkOriginMarker(null)).toBe(false);
    expect(withFederatedWorkOriginMarker(null, origin, "BI-2")).toBe(federatedWorkOriginMarker(origin, "BI-2"));
  });
});

import { describe, expect, it } from "vitest";
import {
  PRODUCT_MANAGEMENT_PLAYBOOKS,
  buildPlaybookInputFingerprint,
  buildPlaybookPermissionDigest,
  buildProductManagementBriefSnapshot,
  listProductManagementPlaybooksForScope,
  parseProductManagementPlaybookConfig,
  shouldRefreshProductManagementPlaybook,
} from "./product-management-playbook";

describe("PRODUCT_MANAGEMENT_PLAYBOOKS", () => {
  it("declares the full reusable operating loop without duplicate authorities", () => {
    expect(PRODUCT_MANAGEMENT_PLAYBOOKS.map((recipe) => recipe.id)).toEqual([
      "weekly-intelligence",
      "product-line-performance-review",
      "demand-triage",
      "investment-preparation",
      "roadmap-refresh",
      "commercial-opportunity-review",
      "outcome-review",
      "stakeholder-brief",
    ]);

    for (const recipe of PRODUCT_MANAGEMENT_PLAYBOOKS) {
      expect(recipe.supportedScopes.length).toBeGreaterThan(0);
      expect(recipe.canonicalInputs.length).toBeGreaterThan(0);
      expect(recipe.allowedTools.length).toBeGreaterThan(0);
      expect(recipe.output.authority).toBe("derived");
      expect(recipe.output.importable).toBe(false);
      expect(recipe.proposedWrites.every((write) => write.canonical)).toBe(true);
      expect(recipe.approvalBoundary).toMatch(/preview|approval|review/);
      expect(recipe.failureBehavior).toMatch(/partial|stale|unavailable/i);
      expect(recipe.guidance.ownerOperator).not.toBe(
        recipe.guidance.productManager,
      );
      expect(buildPlaybookPermissionDigest(recipe)).toMatch(/^pm-permissions-/);
    }
  });

  it("uses progressive disclosure by scope without changing recipe identity", () => {
    expect(
      listProductManagementPlaybooksForScope("organization").map(
        (recipe) => recipe.id,
      ),
    ).toContain("stakeholder-brief");
    expect(
      listProductManagementPlaybooksForScope("product-line").map(
        (recipe) => recipe.id,
      ),
    ).toContain("product-line-performance-review");
    expect(
      listProductManagementPlaybooksForScope("product").map(
        (recipe) => recipe.id,
      ),
    ).not.toContain("product-line-performance-review");
  });
});

describe("parseProductManagementPlaybookConfig", () => {
  it("accepts the current version and canonical permission digest", () => {
    const recipe = PRODUCT_MANAGEMENT_PLAYBOOKS[0]!;
    expect(
      parseProductManagementPlaybookConfig({
        schemaVersion: 1,
        recipeId: recipe.id,
        permissionsDigest: buildPlaybookPermissionDigest(recipe),
        minimumRefreshMinutes: 60,
      }),
    ).toEqual({
      schemaVersion: 1,
      recipeId: recipe.id,
      permissionsDigest: buildPlaybookPermissionDigest(recipe),
      minimumRefreshMinutes: 60,
      lastSuccessfulFingerprint: null,
      lastRefreshQueuedAt: null,
      lastRefreshChangeKey: null,
    });
  });

  it("fails closed for stale permissions, unknown recipes, and unsafe rate limits", () => {
    expect(() =>
      parseProductManagementPlaybookConfig({
        schemaVersion: 1,
        recipeId: "weekly-intelligence",
        permissionsDigest: "old-permissions",
        minimumRefreshMinutes: 60,
      }),
    ).toThrow(/permission scope changed/i);
    expect(() =>
      parseProductManagementPlaybookConfig({
        schemaVersion: 1,
        recipeId: "invented-review",
        permissionsDigest: "anything",
        minimumRefreshMinutes: 60,
      }),
    ).toThrow(/unknown/i);
    expect(() =>
      parseProductManagementPlaybookConfig({
        schemaVersion: 1,
        recipeId: "weekly-intelligence",
        permissionsDigest: buildPlaybookPermissionDigest(
          PRODUCT_MANAGEMENT_PLAYBOOKS[0]!,
        ),
        minimumRefreshMinutes: 1,
      }),
    ).toThrow(/15 minutes/i);
  });
});

describe("playbook refresh and portability", () => {
  it("fingerprints canonical source identity and observation time deterministically", () => {
    const a = buildPlaybookInputFingerprint([
      {
        sourceKind: "knowledge-article",
        sourceId: "KA-2",
        asOf: new Date("2026-07-28T12:00:00Z"),
      },
      {
        sourceKind: "backlog-item",
        sourceId: "BI-1",
        asOf: new Date("2026-07-28T11:00:00Z"),
      },
    ]);
    const b = buildPlaybookInputFingerprint([
      {
        sourceKind: "backlog-item",
        sourceId: "BI-1",
        asOf: new Date("2026-07-28T11:00:00Z"),
      },
      {
        sourceKind: "knowledge-article",
        sourceId: "KA-2",
        asOf: new Date("2026-07-28T12:00:00Z"),
      },
    ]);
    expect(a).toBe(b);
    expect(a).toMatch(/^pm-input-/);
  });

  it("deduplicates unchanged inputs and rate-limits relevant changes", () => {
    const now = new Date("2026-07-28T12:00:00Z");
    expect(
      shouldRefreshProductManagementPlaybook({
        recipeId: "weekly-intelligence",
        changedSourceKind: "knowledge-article",
        nextFingerprint: "pm-input-new",
        lastSuccessfulFingerprint: "pm-input-old",
        lastRefreshQueuedAt: new Date("2026-07-28T10:00:00Z"),
        lastRefreshChangeKey: null,
        minimumRefreshMinutes: 60,
        now,
      }),
    ).toEqual({ shouldRefresh: true, reason: "relevant-change" });
    expect(
      shouldRefreshProductManagementPlaybook({
        recipeId: "weekly-intelligence",
        changedSourceKind: "knowledge-article",
        nextFingerprint: "pm-input-old",
        lastSuccessfulFingerprint: "pm-input-old",
        lastRefreshQueuedAt: null,
        lastRefreshChangeKey: null,
        minimumRefreshMinutes: 60,
        now,
      }),
    ).toEqual({ shouldRefresh: false, reason: "unchanged" });
    expect(
      shouldRefreshProductManagementPlaybook({
        recipeId: "weekly-intelligence",
        changedSourceKind: "product-objective",
        nextFingerprint: "pm-input-new",
        lastSuccessfulFingerprint: "pm-input-old",
        lastRefreshQueuedAt: null,
        lastRefreshChangeKey: null,
        minimumRefreshMinutes: 60,
        now,
      }),
    ).toEqual({ shouldRefresh: false, reason: "source-not-relevant" });
    expect(
      shouldRefreshProductManagementPlaybook({
        recipeId: "weekly-intelligence",
        changedSourceKind: "knowledge-article",
        nextFingerprint: "pm-input-new",
        lastSuccessfulFingerprint: "pm-input-old",
        lastRefreshQueuedAt: new Date("2026-07-28T11:30:00Z"),
        lastRefreshChangeKey: null,
        minimumRefreshMinutes: 60,
        now,
      }),
    ).toEqual({ shouldRefresh: false, reason: "rate-limited" });
    expect(
      shouldRefreshProductManagementPlaybook({
        recipeId: "weekly-intelligence",
        changedSourceKind: "knowledge-article",
        nextFingerprint: "pm-input-new",
        lastSuccessfulFingerprint: "pm-input-old",
        lastRefreshQueuedAt: new Date("2026-07-28T10:00:00Z"),
        lastRefreshChangeKey: "knowledge-article:KA-1:2026-07-28T11:00:00.000Z",
        changeKey: "knowledge-article:KA-1:2026-07-28T11:00:00.000Z",
        minimumRefreshMinutes: 60,
        now,
      }),
    ).toEqual({ shouldRefresh: false, reason: "duplicate-change" });
  });

  it("exports a provenance-bearing snapshot that cannot become planning authority", () => {
    const snapshot = buildProductManagementBriefSnapshot({
      recipeId: "stakeholder-brief",
      scope: {
        kind: "product",
        organizationId: "org-1",
        productLineId: "line-1",
        businessProductId: "product-1",
      },
      generatedAt: new Date("2026-07-28T12:00:00Z"),
      confidence: "partial",
      sources: [
        {
          sourceKind: "backlog-item",
          sourceId: "BI-1",
          asOf: new Date("2026-07-28T11:00:00Z"),
        },
      ],
      sections: [{ id: "decision", title: "Decision", body: "Review it." }],
    });
    expect(snapshot).toMatchObject({
      schemaVersion: 1,
      importable: false,
      authority: "derived-snapshot",
      recipeId: "stakeholder-brief",
      confidence: "partial",
    });
    expect(snapshot.sourceIds).toEqual(["backlog-item:BI-1"]);
    expect(snapshot.asOf).toBe("2026-07-28T11:00:00.000Z");
  });
});

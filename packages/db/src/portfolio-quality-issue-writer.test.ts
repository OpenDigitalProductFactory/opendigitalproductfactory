import { describe, expect, it, vi } from "vitest";
import {
  openOrUpdateQualityIssue,
  computeIssueKey,
  QUALITY_ISSUE_TYPES,
  QUALITY_ISSUE_REGISTRY,
} from "./portfolio-quality-issue-writer";

describe("computeIssueKey", () => {
  it("uses inventoryEntityId as the highest-priority scope key", () => {
    expect(
      computeIssueKey("type_not_promotable", {
        inventoryEntityId: "ent_1",
        portfolioId: "p_1",
      }),
    ).toBe("type_not_promotable:inventoryEntityId:ent_1");
  });

  it("falls back through priority order", () => {
    expect(computeIssueKey("incomplete_detail", { digitalProductId: "dp_1" })).toBe(
      "incomplete_detail:digitalProductId:dp_1",
    );
    expect(computeIssueKey("taxonomy_gap_proposal", { taxonomyNodeId: "tn_1" })).toBe(
      "taxonomy_gap_proposal:taxonomyNodeId:tn_1",
    );
  });

  it("falls back to portfolioId when narrower keys are absent", () => {
    expect(computeIssueKey("no_portfolio_root", { portfolioId: "p_1" })).toBe(
      "no_portfolio_root:portfolioId:p_1",
    );
  });

  it("falls back to inventoryRelationshipId as the lowest priority", () => {
    expect(
      computeIssueKey("incomplete_detail", { inventoryRelationshipId: "rel_1" }),
    ).toBe("incomplete_detail:inventoryRelationshipId:rel_1");
  });

  it("throws when scope is empty", () => {
    expect(() => computeIssueKey("type_not_promotable", {})).toThrow(/scope/);
  });
});

describe("openOrUpdateQualityIssue", () => {
  function mockDb() {
    const upsert = vi.fn().mockResolvedValue({ id: "qi_1", issueKey: "k", status: "open" });
    return { db: { portfolioQualityIssue: { upsert } }, upsert };
  }

  it("rejects unknown issueType before touching the db", async () => {
    const { db, upsert } = mockDb();
    await expect(
      openOrUpdateQualityIssue({
        db: db as never,
        // @ts-expect-error invalid type on purpose
        issueType: "nope",
        scope: { inventoryEntityId: "e" },
        summary: "x",
      }),
    ).rejects.toThrow(/unknown issue type/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("opens a new issue with sensible defaults", async () => {
    const { db, upsert } = mockDb();
    await openOrUpdateQualityIssue({
      db: db as never,
      issueType: "type_not_promotable",
      scope: { inventoryEntityId: "ent_1" },
      summary: "skipped",
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ issueKey: "type_not_promotable:inventoryEntityId:ent_1" });
    expect(args.create.status).toBe("open");
    expect(args.create.severity).toBe("warn"); // default
    expect(args.create.inventoryEntityId).toBe("ent_1");
    expect(args.update.status).toBeUndefined(); // update path does NOT flip status when re-detecting
  });

  it("update path refreshes lastDetectedAt and may overwrite severity/summary", async () => {
    const { db, upsert } = mockDb();
    await openOrUpdateQualityIssue({
      db: db as never,
      issueType: "incomplete_detail",
      scope: { digitalProductId: "dp_1" },
      severity: "error",
      summary: "missing manufacturer",
    });
    const args = upsert.mock.calls[0][0];
    expect(args.update.lastDetectedAt).toBeInstanceOf(Date);
    expect(args.update.severity).toBe("error");
    expect(args.update.summary).toBe("missing manufacturer");
  });

  it("status='resolve' sets resolvedAt and flips status on update", async () => {
    const { db, upsert } = mockDb();
    await openOrUpdateQualityIssue({
      db: db as never,
      issueType: "type_not_promotable",
      scope: { inventoryEntityId: "ent_1" },
      summary: "no longer skipped",
      status: "resolve",
    });
    const args = upsert.mock.calls[0][0];
    expect(args.create.status).toBe("resolved");
    expect(args.create.resolvedAt).toBeInstanceOf(Date);
    expect(args.update.status).toBe("resolved");
    expect(args.update.resolvedAt).toBeInstanceOf(Date);
  });

  it("populates every passed scope FK on create so the row carries the breadcrumb", async () => {
    const { db, upsert } = mockDb();
    await openOrUpdateQualityIssue({
      db: db as never,
      issueType: "incomplete_detail",
      scope: {
        inventoryEntityId: "ent_1",
        digitalProductId: "dp_1",
        taxonomyNodeId: "tn_1",
        portfolioId: "p_1",
      },
      summary: "missing manufacturer",
    });
    const args = upsert.mock.calls[0][0];
    expect(args.create.inventoryEntityId).toBe("ent_1");
    expect(args.create.digitalProductId).toBe("dp_1");
    expect(args.create.taxonomyNodeId).toBe("tn_1");
    expect(args.create.portfolioId).toBe("p_1");
    expect(args.create.inventoryRelationshipId).toBe(null);
  });

  it("omits details from update payload when caller does not pass it", async () => {
    const { db, upsert } = mockDb();
    await openOrUpdateQualityIssue({
      db: db as never,
      issueType: "type_not_promotable",
      scope: { inventoryEntityId: "ent_1" },
      summary: "no details this time",
    });
    const args = upsert.mock.calls[0][0];
    expect("details" in args.update).toBe(false);
    expect("details" in args.create).toBe(false);
  });

  it("includes details on both create and update payloads when passed", async () => {
    const { db, upsert } = mockDb();
    await openOrUpdateQualityIssue({
      db: db as never,
      issueType: "type_not_promotable",
      scope: { inventoryEntityId: "ent_1" },
      summary: "with context",
      details: { entityType: "network_client", source: "legacy-list" },
    });
    const args = upsert.mock.calls[0][0];
    expect(args.create.details).toEqual({ entityType: "network_client", source: "legacy-list" });
    expect(args.update.details).toEqual({ entityType: "network_client", source: "legacy-list" });
  });

  it("QUALITY_ISSUE_TYPES is derived from the lifecycle registry", () => {
    // Deliberately not a hardcoded list any more. This list previously named 8
    // types while the live database held 10 — 8 of them undeclared — because the
    // validation below is bypassed by direct prisma.portfolioQualityIssue.upsert
    // calls. The registry is now the single source of truth (BI-0B420A1D).
    expect(QUALITY_ISSUE_TYPES).toEqual(Object.keys(QUALITY_ISSUE_REGISTRY));
  });

  it("covers the promotion-gate types AND the types that were previously undeclared", () => {
    expect(QUALITY_ISSUE_TYPES).toEqual(
      expect.arrayContaining([
        // The original canonical set.
        "type_not_promotable",
        "name_not_promotable",
        "no_taxonomy",
        "no_portfolio_root",
        "low_confidence_promotion",
        "taxonomy_gap_proposal",
        "incomplete_detail",
        "enrichment_failed",
        // Live in the database but never declared until BI-0B420A1D.
        "stale_entity",
        "stale_relationship",
        "lifecycle_unverified",
        "catalog_match_ambiguous",
        "attribution_missing",
        "taxonomy_attribution_low_confidence",
        "health_alert",
        "gateway_connection_needed",
      ]),
    );
  });
});

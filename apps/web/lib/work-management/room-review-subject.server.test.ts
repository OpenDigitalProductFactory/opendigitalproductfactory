import { describe, expect, it, vi } from "vitest";
import { loadRoomReviewSubject } from "./room-review-subject.server";
import { projectRoomReviewSubject, type ReviewSubjectBookingRow } from "./room-review-subject";

const timestamp = "2026-10-25T00:00:00.000Z";
function booking(org = "org-one", ref = "BK-one"): ReviewSubjectBookingRow {
  const archetype = { id: "arch-camp", archetypeId: "campground", category: "hospitality", isActive: true, updatedAt: timestamp };
  return { bookingRef: ref, organizationId: org, storefrontId: `sf-${org}`, updatedAt: timestamp,
    storefront: { id: `sf-${org}`, organizationId: org, archetypeId: archetype.id,
      updatedAt: timestamp, archetype, archetypeCompositions: [] } };
}
function slot(row: ReviewSubjectBookingRow, id: string, options: { removed?: boolean; inactive?: boolean; productLine?: string } = {}) {
  return { id, storefrontId: row.storefront.id, archetypeId: `arch-${id}`, productLineId: options.productLine ?? null,
    role: "secondary", removedAt: options.removed ? timestamp : null, updatedAt: timestamp,
    archetype: { id: `arch-${id}`, archetypeId: `slug-${id}`, category: "hospitality",
      isActive: !options.inactive, updatedAt: timestamp } };
}
const auth = { population: "workforce" as const, grantedCapabilities: ["view_storefront"] };
const input = { sourceType: "booking", sourceId: "BK-one" };
const project = (row: ReviewSubjectBookingRow) => projectRoomReviewSubject({ ...input, booking: row });

describe("occurrence review subject source boundary", () => {
  it.each([
    { population: "customer" as const, grantedCapabilities: ["view_storefront"] },
    { population: "ai-coworker" as const, grantedCapabilities: ["view_storefront"] },
    { population: "workforce" as const, grantedCapabilities: [] },
  ])("refuses source facts before lookup for $population without the workforce source capability", async reader => {
    const findUnique = vi.fn();
    expect(await loadRoomReviewSubject({ storefrontBooking: { findUnique } }, input, reader))
      .toEqual({ status: "unknown", reason: "source-denied" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("uses canonical bookingRef for the registered alias and one bounded relation read", async () => {
    const findUnique = vi.fn(async () => booking());
    const result = await loadRoomReviewSubject({ storefrontBooking: { findUnique } },
      { ...input, sourceType: "storefront-booking" }, auth);
    expect(result).toMatchObject({ status: "resolved", organizationId: "org-one",
      source: { sourceKey: "booking", sourceId: "BK-one" }, primary: { ref: "arch-camp", slug: "campground" } });
    expect(findUnique).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { bookingRef: "BK-one" },
      select: expect.objectContaining({ storefront: { select: expect.objectContaining({
        archetypeCompositions: expect.objectContaining({ take: 33, orderBy: { id: "asc" } }),
      }) } }),
    }));
    expect(JSON.stringify(findUnique.mock.calls)).not.toContain("customerEmail");
  });

  it("keeps two organizations distinct even when one reader has both room admissions", async () => {
    const findUnique = vi.fn(async (args: unknown) => {
      const key = (args as { where: { bookingRef: string } }).where.bookingRef;
      return key === "BK-one" ? booking() : booking("org-two", "BK-two");
    });
    const db = { storefrontBooking: { findUnique } };
    const one = await loadRoomReviewSubject(db, input, auth);
    const two = await loadRoomReviewSubject(db, { ...input, sourceId: "BK-two" }, auth);
    expect(one).toMatchObject({ organizationId: "org-one", storefrontId: "sf-org-one" });
    expect(two).toMatchObject({ organizationId: "org-two", storefrontId: "sf-org-two" });
    expect(JSON.stringify(one)).not.toContain("org-two");
    expect(JSON.stringify(two)).not.toContain("org-one");
  });

  it.each(["backlog-item", "work-capsule", "field-service-job", "unknown"])("does not infer an unsupported %s subject", async sourceType => {
    const findUnique = vi.fn();
    expect(await loadRoomReviewSubject({ storefrontBooking: { findUnique } }, { ...input, sourceType }, auth))
      .toEqual({ status: "unknown", reason: "source-unsupported" });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("preserves source unavailability without exception details or inferred identity", async () => {
    const findUnique = vi.fn(async () => { throw new Error("secret organization detail"); });
    expect(await loadRoomReviewSubject({ storefrontBooking: { findUnique } }, input, auth))
      .toEqual({ status: "unknown", reason: "source-unavailable" });
  });

  it("keeps missing source distinct and never retries another identifier", async () => {
    const findUnique = vi.fn(async () => null);
    expect(await loadRoomReviewSubject({ storefrontBooking: { findUnique } }, input, auth))
      .toEqual({ status: "unknown", reason: "source-missing" });
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("canonical subject projection", () => {
  it.each(["organization", "storefront", "primary", "reference"])("refuses a %s mismatch without leaking either identity", kind => {
    const row = booking();
    if (kind === "organization") row.storefront.organizationId = "secret-org";
    if (kind === "storefront") row.storefront.id = "secret-storefront";
    if (kind === "primary") row.storefront.archetype.id = "wrong-fk";
    if (kind === "reference") row.bookingRef = "wrong-source";
    expect(project(row)).toEqual({ status: "unknown", reason: "scope-conflict" });
  });
  it("does not treat an inactive primary or invalid revision as usable evidence", () => {
    const row = booking(); row.storefront.archetype.isActive = false;
    expect(project(row)).toEqual({ status: "unknown", reason: "source-inactive" });
    row.storefront.archetype.isActive = true; row.updatedAt = "not-a-time";
    expect(project(row)).toEqual({ status: "unknown", reason: "source-unavailable" });
  });
  it("retains removed and inactive exclusions separately from unknown product-line and declaration scope", () => {
    const row = booking();
    row.storefront.archetypeCompositions = [slot(row, "removed", { removed: true }), slot(row, "inactive", { inactive: true }),
      slot(row, "product", { productLine: "product-one" }), slot(row, "unbound")];
    const result = project(row);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") throw new Error("expected fixture scope");
    expect(result.compositions.map(x => [x.ref, x.applicability, x.reason])).toEqual([
      ["inactive", "excluded", "inactive"], ["product", "unknown", "product-line-unverified"],
      ["removed", "excluded", "removed"], ["unbound", "unknown", "declaration-unverified"],
    ]);
    expect(result).not.toHaveProperty("requirements");
    expect(result).not.toHaveProperty("qualified");
  });
  it("rejects overflow instead of reporting truncated composition as complete", () => {
    const row = booking();
    row.storefront.archetypeCompositions = Array.from({ length: 33 }, (_, i) => slot(row, String(i)));
    expect(project(row)).toEqual({ status: "unknown", reason: "composition-incomplete" });
  });
  it("rejects cross-storefront, duplicate and conflicting primary composition rows", () => {
    for (const kind of ["cross-storefront", "duplicate", "primary"]) {
      const row = booking(); const candidate = slot(row, "one");
      row.storefront.archetypeCompositions = [candidate];
      if (kind === "cross-storefront") candidate.storefrontId = "other-storefront";
      if (kind === "duplicate") row.storefront.archetypeCompositions.push({ ...candidate });
      if (kind === "primary") candidate.role = "primary";
      expect(project(row)).toEqual({ status: "unknown", reason: "scope-conflict" });
    }
  });
  it("normalizes order and timestamps, changes identity on a source revision, and never mutates prior projections", () => {
    const row = booking(); row.storefront.archetypeCompositions = [slot(row, "b"), slot(row, "a")];
    const original = project(row); const saved = JSON.stringify(original);
    row.storefront.archetypeCompositions.reverse(); row.updatedAt = new Date(timestamp);
    expect(project(row)).toEqual(original);
    row.storefront.archetype.updatedAt = "2026-10-26T00:00:00.000Z";
    expect(project(row)).not.toEqual(original);
    expect(JSON.stringify(original)).toBe(saved);
  });
  it("bounds serialized provenance and returns no partial subject identity", () => {
    const row = booking(); row.storefront.archetype.category = "x".repeat(128 * 1024);
    expect(project(row)).toEqual({ status: "unknown", reason: "composition-incomplete" });
  });
});

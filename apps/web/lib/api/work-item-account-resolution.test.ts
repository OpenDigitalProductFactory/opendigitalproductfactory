/**
 * Tests for resolveWorkItemAccount — the WorkItem source → CustomerAccount
 * resolver that backs the mobile invoice screen's customer pre-fill.
 *
 * The set of recognized source types is a closed registry. Each branch must
 * have at least one happy-path and one miss-case test so adding a new source
 * forces an entry here, not just a Prisma call elsewhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockEngagementFindUnique,
  mockOpportunityFindUnique,
  mockBookingFindUnique,
  mockContactFindUnique,
  mockActivityFindUnique,
} = vi.hoisted(() => ({
  mockEngagementFindUnique: vi.fn(),
  mockOpportunityFindUnique: vi.fn(),
  mockBookingFindUnique: vi.fn(),
  mockContactFindUnique: vi.fn(),
  mockActivityFindUnique: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    engagement: { findUnique: mockEngagementFindUnique },
    opportunity: { findUnique: mockOpportunityFindUnique },
    storefrontBooking: { findUnique: mockBookingFindUnique },
    customerContact: { findUnique: mockContactFindUnique },
    activity: { findUnique: mockActivityFindUnique },
  },
}));

import {
  __RESOLVER_KEYS_FOR_TESTS,
  resolveWorkItemAccount,
} from "./work-item-account-resolution";

const ACCT = { id: "acct_cuid", accountId: "ACC-ACME", name: "Acme HVAC Co" };

beforeEach(() => {
  mockEngagementFindUnique.mockReset();
  mockOpportunityFindUnique.mockReset();
  mockBookingFindUnique.mockReset();
  mockContactFindUnique.mockReset();
  mockActivityFindUnique.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveWorkItemAccount — input guards", () => {
  it("returns null when sourceType is missing/empty/whitespace", async () => {
    expect(
      await resolveWorkItemAccount({ sourceType: null, sourceId: "x" }),
    ).toBeNull();
    expect(
      await resolveWorkItemAccount({ sourceType: "", sourceId: "x" }),
    ).toBeNull();
    expect(
      await resolveWorkItemAccount({ sourceType: "   ", sourceId: "x" }),
    ).toBeNull();
  });

  it("returns null when sourceId is missing/empty", async () => {
    expect(
      await resolveWorkItemAccount({ sourceType: "engagement", sourceId: null }),
    ).toBeNull();
    expect(
      await resolveWorkItemAccount({ sourceType: "engagement", sourceId: "" }),
    ).toBeNull();
  });

  it("returns null for an unknown sourceType without touching the DB", async () => {
    const result = await resolveWorkItemAccount({
      sourceType: "totally-made-up",
      sourceId: "WHATEVER-1",
    });
    expect(result).toBeNull();
    expect(mockEngagementFindUnique).not.toHaveBeenCalled();
    expect(mockOpportunityFindUnique).not.toHaveBeenCalled();
    expect(mockBookingFindUnique).not.toHaveBeenCalled();
    expect(mockActivityFindUnique).not.toHaveBeenCalled();
  });
});

describe("resolveWorkItemAccount — engagement", () => {
  it("resolves via Engagement.account", async () => {
    mockEngagementFindUnique.mockResolvedValueOnce({ account: ACCT });
    const result = await resolveWorkItemAccount({
      sourceType: "engagement",
      sourceId: "ENG-1",
    });
    expect(result).toEqual({
      id: ACCT.id,
      accountId: ACCT.accountId,
      name: ACCT.name,
    });
    expect(mockEngagementFindUnique.mock.calls[0][0].where).toEqual({
      engagementId: "ENG-1",
    });
  });

  it("returns null when the engagement has no account link (orphan source)", async () => {
    mockEngagementFindUnique.mockResolvedValueOnce({ account: null });
    expect(
      await resolveWorkItemAccount({
        sourceType: "engagement",
        sourceId: "ENG-orphan",
      }),
    ).toBeNull();
  });

  it("returns null when the engagement row was deleted", async () => {
    mockEngagementFindUnique.mockResolvedValueOnce(null);
    expect(
      await resolveWorkItemAccount({
        sourceType: "engagement",
        sourceId: "ENG-gone",
      }),
    ).toBeNull();
  });
});

describe("resolveWorkItemAccount — opportunity", () => {
  it("resolves via Opportunity.account", async () => {
    mockOpportunityFindUnique.mockResolvedValueOnce({ account: ACCT });
    const result = await resolveWorkItemAccount({
      sourceType: "opportunity",
      sourceId: "OPP-1",
    });
    expect(result?.accountId).toBe("ACC-ACME");
    expect(mockOpportunityFindUnique.mock.calls[0][0].where).toEqual({
      opportunityId: "OPP-1",
    });
  });
});

describe("resolveWorkItemAccount — booking", () => {
  it("resolves via StorefrontBooking → contact → account (two-hop)", async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ customerContactId: "con_1" });
    mockContactFindUnique.mockResolvedValueOnce({ account: ACCT });
    const result = await resolveWorkItemAccount({
      sourceType: "booking",
      sourceId: "BK-1",
    });
    expect(result?.accountId).toBe("ACC-ACME");
    expect(mockBookingFindUnique.mock.calls[0][0].where).toEqual({
      bookingRef: "BK-1",
    });
    expect(mockContactFindUnique.mock.calls[0][0].where).toEqual({
      id: "con_1",
    });
  });

  it("accepts the `storefront-booking` alias for backward-compatible sourceType", async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ customerContactId: "con_1" });
    mockContactFindUnique.mockResolvedValueOnce({ account: ACCT });
    const result = await resolveWorkItemAccount({
      sourceType: "storefront-booking",
      sourceId: "BK-1",
    });
    expect(result?.accountId).toBe("ACC-ACME");
  });

  it("returns null when the booking has no customerContactId (anonymous storefront customer)", async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ customerContactId: null });
    expect(
      await resolveWorkItemAccount({ sourceType: "booking", sourceId: "BK-2" }),
    ).toBeNull();
    expect(mockContactFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the contact's account is missing", async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ customerContactId: "con_1" });
    mockContactFindUnique.mockResolvedValueOnce({ account: null });
    expect(
      await resolveWorkItemAccount({ sourceType: "booking", sourceId: "BK-3" }),
    ).toBeNull();
  });
});

describe("resolveWorkItemAccount — activity", () => {
  it("resolves via Activity.account", async () => {
    mockActivityFindUnique.mockResolvedValueOnce({ account: ACCT });
    const result = await resolveWorkItemAccount({
      sourceType: "activity",
      sourceId: "ACT-1",
    });
    expect(result?.accountId).toBe("ACC-ACME");
    expect(mockActivityFindUnique.mock.calls[0][0].where).toEqual({
      activityId: "ACT-1",
    });
  });
});

describe("resolveWorkItemAccount — registry guard", () => {
  it("recognizes exactly the documented sourceType set", () => {
    // Closed registry — adding a new source means updating both the
    // resolver map and this test in the same commit.
    expect(__RESOLVER_KEYS_FOR_TESTS.sort()).toEqual(
      ["engagement", "opportunity", "storefront-booking", "booking", "activity"].sort(),
    );
  });
});

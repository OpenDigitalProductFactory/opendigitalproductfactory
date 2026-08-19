import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    integrationCredential: {
      findUnique: mockFindUnique,
    },
  },
}));

import { encryptJson } from "@/lib/govern/credential-crypto";
import { getFacebookLeadAdsAcquisitionSignal } from "./signal";

describe("getFacebookLeadAdsAcquisitionSignal", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
  });

  it("returns a sanitized CRM signal for a connected Facebook Lead Ads credential", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-lead-ads",
      provider: "facebook",
      status: "connected",
      fieldsEnc: encryptJson({
        accessToken: "meta-token",
        pageId: "page-123",
        pageName: "Acme Local",
        pageCategory: "Business Service",
      }),
      lastTestedAt: new Date("2026-05-26T09:30:00.000Z"),
      updatedAt: new Date("2026-05-26T09:35:00.000Z"),
    });

    const signal = await getFacebookLeadAdsAcquisitionSignal();

    expect(signal).toMatchObject({
      id: "facebook-lead-ads:page-123",
      kind: "facebook_lead_ads",
      source: "facebook_lead_ads",
      sourceRefId: "page-123",
      title: "Facebook Lead Ads connected for Acme Local",
      buyerLabel: "Acme Local",
      integrationHref: "/platform/tools/integrations/facebook-lead-ads",
    });
    expect(signal?.evidence.join(" ")).toContain("Business Service");
    expect(JSON.stringify(signal)).not.toContain("meta-token");
  });

  it("does not surface unconfigured credentials as acquisition signals", async () => {
    mockFindUnique.mockResolvedValue({
      integrationId: "facebook-lead-ads",
      provider: "facebook",
      status: "unconfigured",
      fieldsEnc: encryptJson({ pageId: "page-123" }),
      lastTestedAt: null,
      updatedAt: new Date("2026-05-26T09:35:00.000Z"),
    });

    await expect(getFacebookLeadAdsAcquisitionSignal()).resolves.toBeNull();
  });
});

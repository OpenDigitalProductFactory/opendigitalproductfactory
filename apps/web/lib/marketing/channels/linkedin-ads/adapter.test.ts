import { describe, it, expect } from "vitest";
import { createLinkedInAdsAdapter } from "./adapter";
import type { FetchImpl } from "./client";
import { LINKEDIN_ADS_REQUIRED_SCOPES } from "./client";
import type { ChannelCredentialBundle } from "../contracts";

function draft(overrides: Partial<{ body: string; channelId: string; assetType: string; metadata: Record<string, unknown> }> = {}) {
  return {
    draftId: "draft-ad-1",
    organizationId: "org-1",
    domain: "marketing",
    sourceType: "manual",
    sourceId: null,
    strategyId: null,
    status: "approved",
    channelId: overrides.channelId ?? "linkedin-ads",
    assetType: overrides.assetType ?? "ad-creative",
    body: overrides.body ?? "Tech founders: orchestration broken? Try Build Studio's recursive self-improvement loop.",
    bodyFormat: "plain",
    metadata: overrides.metadata ?? {
      dailyBudgetCents: 5000,
      audienceUrn: "urn:li:adTargetingFacet:audienceMatchingSegments:abc",
      adAccountUrn: "urn:li:sponsoredAccount:1234567",
      campaignName: "Phase 4 test",
    },
    createdByAgentId: "marketing-specialist",
    originalPromptId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Parameters<ReturnType<typeof createLinkedInAdsAdapter>["validateDraft"]>[0];
}

function credential(overrides: Partial<ChannelCredentialBundle> = {}): ChannelCredentialBundle {
  return {
    credentialId: "cred-1",
    integrationId: "linkedin-personal-social",
    provider: "linkedin",
    status: "connected",
    fields: {},
    tokens: { access_token: "FAKE_TOKEN" },
    ...overrides,
  };
}

describe("LinkedIn Ads adapter validateDraft", () => {
  const adapter = createLinkedInAdsAdapter();

  it("accepts a normal ad-creative draft", () => {
    expect(adapter.validateDraft(draft()).ok).toBe(true);
  });

  it("rejects unsupported asset type", () => {
    expect(adapter.validateDraft(draft({ assetType: "email" })).ok).toBe(false);
  });

  it("rejects wrong channel routing", () => {
    expect(adapter.validateDraft(draft({ channelId: "linkedin" })).ok).toBe(false);
  });

  it("rejects missing dailyBudgetCents", () => {
    const result = adapter.validateDraft(
      draft({
        metadata: {
          audienceUrn: "urn:li:adTargetingFacet:abc",
          adAccountUrn: "urn:li:sponsoredAccount:1234567",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects missing audience URN", () => {
    const result = adapter.validateDraft(
      draft({
        metadata: {
          dailyBudgetCents: 1000,
          adAccountUrn: "urn:li:sponsoredAccount:1234567",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects ad-account URN with wrong shape", () => {
    const result = adapter.validateDraft(
      draft({
        metadata: {
          dailyBudgetCents: 1000,
          audienceUrn: "urn:li:adTargetingFacet:abc",
          adAccountUrn: "not-a-urn",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects empty creative body", () => {
    expect(adapter.validateDraft(draft({ body: "   " })).ok).toBe(false);
  });
});

describe("LinkedIn Ads adapter publish (mocked fetch)", () => {
  it("places a campaign and returns the campaign URN", async () => {
    const fetchImpl: FetchImpl = async (url, init) => {
      if (url.includes("/v2/adCampaignsV2")) {
        const body = JSON.parse(String(init.body));
        expect(body.account).toBe("urn:li:sponsoredAccount:1234567");
        expect(body.dailyBudget.currencyCode).toBe("USD");
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: 999111, createdAt: "2026-06-03T00:00:00Z" }),
          text: async () => "",
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const adapter = createLinkedInAdsAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toBe("urn:li:sponsoredCampaign:999111");
    }
  });

  it("classifies 403 as insufficient scope, NOT retryable", async () => {
    const fetchImpl: FetchImpl = async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => "Forbidden — add r_ads to your LinkedIn app",
    });
    const adapter = createLinkedInAdsAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("linkedin_ads_insufficient_scope");
      expect(result.retryable).toBe(false);
    }
  });

  it("classifies 429 as retryable", async () => {
    const fetchImpl: FetchImpl = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "rate_limited",
    });
    const adapter = createLinkedInAdsAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it("mock mode returns synthetic URN + records proposed spend", async () => {
    const adapter = createLinkedInAdsAdapter({ mockMode: true });
    const result = await adapter.publish!(draft(), credential({ tokens: {} }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toMatch(/^urn:li:sponsoredCampaign:mock_/);
      const meta = result.channelMetadata as { spendCents: number; dailyBudgetCents: number };
      expect(meta.dailyBudgetCents).toBe(5000);
      expect(meta.spendCents).toBe(5000);
    }
  });
});

describe("LinkedIn Ads scopes", () => {
  it("includes r_ads + rw_ads alongside the personal-publish scopes", () => {
    expect([...LINKEDIN_ADS_REQUIRED_SCOPES].sort()).toEqual(
      ["email", "openid", "profile", "r_ads", "rw_ads", "w_member_social"],
    );
  });
});

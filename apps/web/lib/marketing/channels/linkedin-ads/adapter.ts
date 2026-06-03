import type {
  AdapterValidationResult,
  ChannelCredentialBundle,
  EngagementSnapshot,
  OutboundChannelAdapter,
  OutboundDraftLike,
  OutboundPublicationLike,
  PublishResult,
} from "../contracts";
import {
  fetchCampaignAnalytics,
  placeCampaign,
  type FetchImpl,
} from "./client";

const SUPPORTED_ASSET_TYPES = new Set(["ad-creative", "linkedin-ad", "LinkedIn ad"]);

export type LinkedInAdsAdapterDeps = {
  fetchImpl?: FetchImpl;
  mockMode?: boolean;
};

export function createLinkedInAdsAdapter(
  deps: LinkedInAdsAdapterDeps = {},
): OutboundChannelAdapter {
  const mockMode = deps.mockMode ?? process.env.ADS_MOCK_MODE === "1";

  return {
    channelId: "linkedin-ads",
    displayName: "LinkedIn Ads",
    capabilities: ["place-ad", "fetch-engagement"],
    credentialIntegrationId: "linkedin-personal-social", // Phase 4 reuses Phase 2's OAuth
    assetTypes: ["ad-creative", "linkedin-ad", "LinkedIn ad"],

    validateDraft(draft: OutboundDraftLike): AdapterValidationResult {
      if (!SUPPORTED_ASSET_TYPES.has(draft.assetType)) {
        return {
          ok: false,
          reason: `Unsupported asset type for LinkedIn Ads: ${JSON.stringify(draft.assetType)}`,
        };
      }
      if (draft.channelId !== "linkedin-ads") {
        return {
          ok: false,
          reason: `Unexpected channelId ${JSON.stringify(draft.channelId)} routed to linkedin-ads adapter`,
        };
      }
      const metadata = (draft.metadata ?? {}) as Record<string, unknown>;
      if (typeof metadata["dailyBudgetCents"] !== "number" || (metadata["dailyBudgetCents"] as number) <= 0) {
        return { ok: false, reason: "metadata.dailyBudgetCents must be a positive integer" };
      }
      if (typeof metadata["audienceUrn"] !== "string" || !(metadata["audienceUrn"] as string).startsWith("urn:li:")) {
        return { ok: false, reason: "metadata.audienceUrn must be a LinkedIn URN" };
      }
      if (typeof metadata["adAccountUrn"] !== "string" || !(metadata["adAccountUrn"] as string).startsWith("urn:li:sponsoredAccount:")) {
        return {
          ok: false,
          reason: "metadata.adAccountUrn must be a LinkedIn sponsored-account URN (urn:li:sponsoredAccount:...)",
        };
      }
      if (!draft.body || draft.body.trim().length === 0) {
        return { ok: false, reason: "Ad creative body is empty" };
      }
      return { ok: true };
    },

    async publish(draft, credential): Promise<PublishResult> {
      const validation = this.validateDraft(draft);
      if (!validation.ok) {
        return { ok: false, error: validation.reason, retryable: false };
      }

      const metadata = (draft.metadata ?? {}) as {
        dailyBudgetCents: number;
        totalBudgetCents?: number;
        audienceUrn: string;
        adAccountUrn: string;
        campaignName?: string;
      };

      const accessToken = readAccessToken(credential);
      if (!accessToken && !mockMode) {
        return {
          ok: false,
          error: "No access_token in credential cache. Reconnect LinkedIn integration with ads scope.",
          retryable: false,
        };
      }

      if (mockMode) {
        const fakeUrn = `urn:li:sponsoredCampaign:mock_${draft.draftId.slice(0, 10)}`;
        return {
          ok: true,
          externalId: fakeUrn,
          externalUrl: null,
          channelMetadata: {
            mock: true,
            dailyBudgetCents: metadata.dailyBudgetCents,
            spendCents: metadata.totalBudgetCents ?? metadata.dailyBudgetCents,
            audienceUrn: metadata.audienceUrn,
            adAccountUrn: metadata.adAccountUrn,
          },
        };
      }

      const result = await placeCampaign(
        accessToken!,
        {
          adAccountUrn: metadata.adAccountUrn,
          audienceUrn: metadata.audienceUrn,
          creativeBody: draft.body,
          dailyBudgetCents: metadata.dailyBudgetCents,
          totalBudgetCents: metadata.totalBudgetCents,
          campaignName: metadata.campaignName ?? `Campaign ${draft.draftId}`,
        },
        deps.fetchImpl,
      );
      if (!result.ok) {
        return { ok: false, error: result.error, retryable: result.retryable };
      }
      return {
        ok: true,
        externalId: result.campaignUrn,
        externalUrl: null,
        channelMetadata: {
          dailyBudgetCents: metadata.dailyBudgetCents,
          // Initial spendCents = the full proposed cap. KPI pullback overwrites
          // this with the actual costInUsdCents from adAnalyticsV2 once we have
          // real data. Conservative-by-default: the spend gate sees the cap as
          // already-spent until pullback proves otherwise.
          spendCents: metadata.totalBudgetCents ?? metadata.dailyBudgetCents,
          audienceUrn: metadata.audienceUrn,
          adAccountUrn: metadata.adAccountUrn,
          createdAt: result.createdAt,
        },
      };
    },

    async fetchEngagement(
      publication: OutboundPublicationLike,
      credential: ChannelCredentialBundle,
    ): Promise<EngagementSnapshot> {
      const accessToken = readAccessToken(credential);
      if (!accessToken && !mockMode) {
        throw new Error("No access_token in credential cache for LinkedIn Ads pullback");
      }
      if (mockMode) {
        return {
          channelId: "linkedin-ads",
          externalId: publication.externalId,
          polledAt: new Date(),
          metrics: {
            impressions: 1234,
            clicks: 56,
            costInUsdCents: 4321,
            conversions: 3,
          },
          raw: { mock: true },
        };
      }
      const result = await fetchCampaignAnalytics(accessToken!, publication.externalId, deps.fetchImpl);
      if ("error" in result) {
        throw new Error(`LinkedIn Ads analytics ${result.status}: ${result.error}`);
      }
      return {
        channelId: "linkedin-ads",
        externalId: publication.externalId,
        polledAt: new Date(),
        metrics: {
          impressions: result.impressions,
          clicks: result.clicks,
          costInUsdCents: result.costInUsdCents,
          conversions: result.conversions,
        },
        raw: result.raw,
      };
    },
  };
}

function readAccessToken(credential: ChannelCredentialBundle): string | null {
  const tok = credential.tokens["access_token"];
  return typeof tok === "string" && tok.length > 0 ? tok : null;
}

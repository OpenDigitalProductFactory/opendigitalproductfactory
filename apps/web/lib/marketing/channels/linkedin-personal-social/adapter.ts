import type {
  AdapterValidationResult,
  ChannelCredentialBundle,
  OutboundChannelAdapter,
  OutboundDraftLike,
  PublishResult,
} from "../contracts";
import {
  fetchUserInfo,
  memberUrnFromSub,
  postUrlFromId,
  publishUgcPost,
  type FetchImpl,
} from "./client";

// LinkedIn personal text posts allow up to 3000 chars of commentary
// (carriage returns included). UGC posts API rejects > 3000 chars
// commentary; we surface that as a validation error pre-call rather
// than waste a request.
const LINKEDIN_BODY_MAX_CHARS = 3000;

const SUPPORTED_ASSET_TYPES = new Set(["LinkedIn post", "linkedin-post"]);

export type LinkedInAdapterDeps = {
  fetchImpl?: FetchImpl;
  /** Set to true in tests/dev to skip the real HTTP call and return a fake post id.
   *  Adapter respects process.env.LINKEDIN_MOCK_MODE === "1" automatically. */
  mockMode?: boolean;
};

export function createLinkedInPersonalSocialAdapter(
  deps: LinkedInAdapterDeps = {},
): OutboundChannelAdapter {
  const mockMode = deps.mockMode ?? process.env.LINKEDIN_MOCK_MODE === "1";

  return {
    channelId: "linkedin-personal-social",
    displayName: "LinkedIn (personal)",
    capabilities: ["draft-preview", "publish-post"],
    credentialIntegrationId: "linkedin-personal-social",
    assetTypes: ["LinkedIn post", "linkedin-post"],

    validateDraft(draft: OutboundDraftLike): AdapterValidationResult {
      if (!SUPPORTED_ASSET_TYPES.has(draft.assetType)) {
        return {
          ok: false,
          reason: `Unsupported asset type for LinkedIn personal: ${JSON.stringify(draft.assetType)}`,
        };
      }
      if (draft.channelId !== "linkedin" && draft.channelId !== "linkedin-personal-social") {
        return {
          ok: false,
          reason: `Unexpected channelId ${JSON.stringify(draft.channelId)} routed to LinkedIn adapter`,
        };
      }
      if (draft.body.length > LINKEDIN_BODY_MAX_CHARS) {
        return {
          ok: false,
          reason: `Body length ${draft.body.length} exceeds LinkedIn limit ${LINKEDIN_BODY_MAX_CHARS}`,
        };
      }
      if (draft.body.trim().length === 0) {
        return { ok: false, reason: "Body is empty" };
      }
      return { ok: true };
    },

    async publish(draft, credential): Promise<PublishResult> {
      const validation = this.validateDraft(draft);
      if (!validation.ok) {
        return { ok: false, error: validation.reason, retryable: false };
      }

      if (mockMode) {
        const fakeId = `urn:li:share:mock_${draft.draftId.slice(0, 12)}`;
        return {
          ok: true,
          externalId: fakeId,
          externalUrl: postUrlFromId(fakeId),
          channelMetadata: { mock: true },
        };
      }

      const accessToken = readAccessToken(credential);
      if (!accessToken) {
        return {
          ok: false,
          error: "No access_token in credential cache. Reconnect LinkedIn integration.",
          retryable: false,
        };
      }

      // Prefer cached memberUrn (captured at OAuth completion); otherwise fetch.
      let memberUrn = typeof credential.fields["memberUrn"] === "string"
        ? (credential.fields["memberUrn"] as string)
        : null;

      if (!memberUrn) {
        const info = await fetchUserInfo(accessToken, deps.fetchImpl);
        if ("error" in info) {
          return {
            ok: false,
            error: `LinkedIn /v2/userinfo failed (${info.status}): ${info.error}`,
            retryable: info.status === 429 || info.status >= 500,
          };
        }
        memberUrn = memberUrnFromSub(info.sub);
      }

      const result = await publishUgcPost(
        accessToken,
        { memberUrn, body: draft.body },
        deps.fetchImpl,
      );
      if (!result.ok) {
        return { ok: false, error: result.error, retryable: result.retryable };
      }
      return {
        ok: true,
        externalId: result.id,
        externalUrl: postUrlFromId(result.id),
      };
    },
  };
}

function readAccessToken(credential: ChannelCredentialBundle): string | null {
  const tok = credential.tokens["access_token"];
  return typeof tok === "string" && tok.length > 0 ? tok : null;
}

import { describe, it, expect } from "vitest";
import { createLinkedInPersonalSocialAdapter } from "./adapter";
import type { FetchImpl } from "./client";
import { LINKEDIN_REQUIRED_SCOPES } from "./client";
import type { ChannelCredentialBundle } from "../contracts";

function draft(overrides: Partial<{ body: string; channelId: string; assetType: string }> = {}) {
  return {
    draftId: "draft-1",
    organizationId: "org-1",
    domain: "marketing",
    sourceType: "marketing-asset-task",
    sourceId: "task-1",
    strategyId: "strat-1",
    status: "approved",
    channelId: overrides.channelId ?? "linkedin",
    assetType: overrides.assetType ?? "LinkedIn post",
    body: overrides.body ?? "Hello LinkedIn — testing publish path with concrete content.",
    bodyFormat: "markdown",
    metadata: null,
    createdByAgentId: "marketing-specialist",
    originalPromptId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Parameters<ReturnType<typeof createLinkedInPersonalSocialAdapter>["validateDraft"]>[0];
}

function credential(overrides: Partial<ChannelCredentialBundle> = {}): ChannelCredentialBundle {
  return {
    credentialId: "cred-1",
    integrationId: "linkedin-personal-social",
    provider: "linkedin",
    status: "connected",
    fields: { memberUrn: "urn:li:person:abc123" },
    tokens: { access_token: "FAKE_ACCESS_TOKEN" },
    ...overrides,
  };
}

describe("LinkedIn adapter validateDraft", () => {
  const adapter = createLinkedInPersonalSocialAdapter();

  it("accepts a normal LinkedIn post draft", () => {
    expect(adapter.validateDraft(draft()).ok).toBe(true);
  });

  it("rejects unsupported asset types", () => {
    const result = adapter.validateDraft(draft({ assetType: "ad-creative" }));
    expect(result.ok).toBe(false);
  });

  it("rejects wrong channel routing", () => {
    const result = adapter.validateDraft(draft({ channelId: "email" }));
    expect(result.ok).toBe(false);
  });

  it("rejects body over 3000 chars (LinkedIn UGC limit)", () => {
    const result = adapter.validateDraft(draft({ body: "x".repeat(3001) }));
    expect(result.ok).toBe(false);
  });

  it("rejects empty body", () => {
    const result = adapter.validateDraft(draft({ body: "   " }));
    expect(result.ok).toBe(false);
  });
});

describe("LinkedIn adapter publish (mocked fetch)", () => {
  it("publishes successfully and returns externalId + URL", async () => {
    const fetchImpl: FetchImpl = async (url) => {
      if (url.includes("/v2/ugcPosts")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: "urn:li:share:7000111222333" }),
          text: async () => "",
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const adapter = createLinkedInPersonalSocialAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toBe("urn:li:share:7000111222333");
      expect(result.externalUrl).toContain("linkedin.com/feed/update/");
    }
  });

  it("surfaces 401 as auth failure, NOT retryable", async () => {
    const fetchImpl: FetchImpl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "invalid_token",
    });
    const adapter = createLinkedInPersonalSocialAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("linkedin_auth_failed");
      expect(result.retryable).toBe(false);
    }
  });

  it("surfaces 429 as retryable", async () => {
    const fetchImpl: FetchImpl = async () => ({
      ok: false,
      status: 429,
      json: async () => ({}),
      text: async () => "rate_limited",
    });
    const adapter = createLinkedInPersonalSocialAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
    }
  });

  it("fails fast when access_token is missing", async () => {
    const adapter = createLinkedInPersonalSocialAdapter();
    const result = await adapter.publish!(
      draft(),
      credential({ tokens: {} }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/access_token/);
      expect(result.retryable).toBe(false);
    }
  });

  it("mock mode returns a synthetic external id without HTTP", async () => {
    const adapter = createLinkedInPersonalSocialAdapter({ mockMode: true });
    const result = await adapter.publish!(draft(), credential({ tokens: {} }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toMatch(/^urn:li:share:mock_/);
    }
  });
});

describe("LinkedIn scopes", () => {
  it("requests only OIDC + w_member_social — never company-page or ads scopes", () => {
    expect([...LINKEDIN_REQUIRED_SCOPES].sort()).toEqual(
      ["email", "openid", "profile", "w_member_social"],
    );
    expect(LINKEDIN_REQUIRED_SCOPES).not.toContain("w_organization_social");
    expect(LINKEDIN_REQUIRED_SCOPES).not.toContain("rw_organization_admin");
    expect(LINKEDIN_REQUIRED_SCOPES).not.toContain("r_ads");
    expect(LINKEDIN_REQUIRED_SCOPES).not.toContain("rw_ads");
  });
});

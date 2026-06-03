import { describe, it, expect } from "vitest";
import { createEmailPostmarkAdapter } from "./adapter";
import type { FetchImpl } from "./client";
import type { ChannelCredentialBundle } from "../contracts";

function draft(overrides: Partial<{ body: string; channelId: string; assetType: string; metadata: Record<string, unknown> }> = {}) {
  return {
    draftId: "draft-email-1",
    organizationId: "org-1",
    domain: "marketing",
    sourceType: "marketing-asset-task",
    sourceId: "task-1",
    strategyId: "strat-1",
    status: "approved",
    channelId: overrides.channelId ?? "email",
    assetType: overrides.assetType ?? "email",
    body: overrides.body ?? "Hello — testing Phase 3 email path.",
    bodyFormat: "plain",
    metadata: overrides.metadata ?? { subject: "Hello", to: "founder@example.com" },
    createdByAgentId: "marketing-specialist",
    originalPromptId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as Parameters<ReturnType<typeof createEmailPostmarkAdapter>["validateDraft"]>[0];
}

function credential(overrides: Partial<ChannelCredentialBundle> = {}): ChannelCredentialBundle {
  return {
    credentialId: "cred-1",
    integrationId: "email-postmark",
    provider: "postmark",
    status: "connected",
    fields: { fromAddress: "founder@yourdomain.example", signingSecret: "secret" },
    tokens: { server_token: "FAKE_SERVER_TOKEN" },
    ...overrides,
  };
}

describe("Email-Postmark adapter validateDraft", () => {
  const adapter = createEmailPostmarkAdapter();

  it("accepts a normal email draft", () => {
    expect(adapter.validateDraft(draft()).ok).toBe(true);
  });

  it("rejects unsupported asset type", () => {
    expect(adapter.validateDraft(draft({ assetType: "LinkedIn post" })).ok).toBe(false);
  });

  it("rejects wrong channel routing", () => {
    expect(adapter.validateDraft(draft({ channelId: "linkedin" })).ok).toBe(false);
  });

  it("rejects missing subject", () => {
    expect(adapter.validateDraft(draft({ metadata: { to: "x@example.com" } })).ok).toBe(false);
  });

  it("rejects missing recipient", () => {
    expect(adapter.validateDraft(draft({ metadata: { subject: "Hi" } })).ok).toBe(false);
  });

  it("accepts 'Subject:' first-line shorthand", () => {
    const result = adapter.validateDraft(
      draft({ body: "Subject: Hello\n\nBody text", metadata: { to: "x@example.com" } }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("Email-Postmark adapter publish (mocked fetch)", () => {
  it("sends successfully and returns Postmark MessageID", async () => {
    const fetchImpl: FetchImpl = async (url, init) => {
      if (url.includes("/email")) {
        const body = JSON.parse(String(init.body));
        expect(body.From).toBe("founder@yourdomain.example");
        expect(body.To).toBe("founder@example.com");
        expect(body.Subject).toBe("Hello");
        return {
          ok: true,
          status: 200,
          json: async () => ({ MessageID: "msg-abc-123", SubmittedAt: "2026-05-27T00:00:00Z" }),
          text: async () => "",
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const adapter = createEmailPostmarkAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toBe("msg-abc-123");
      expect(result.externalUrl).toBeNull();
    }
  });

  it("classifies 401 as non-retryable invalid token", async () => {
    const fetchImpl: FetchImpl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => "invalid_token",
    });
    const adapter = createEmailPostmarkAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("postmark_invalid_server_token");
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
    const adapter = createEmailPostmarkAdapter({ fetchImpl });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it("fails fast when server_token missing", async () => {
    const adapter = createEmailPostmarkAdapter();
    const result = await adapter.publish!(draft(), credential({ tokens: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/server token/);
      expect(result.retryable).toBe(false);
    }
  });

  it("fails fast when fromAddress missing", async () => {
    const adapter = createEmailPostmarkAdapter();
    const result = await adapter.publish!(
      draft(),
      credential({ fields: { signingSecret: "x" } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/From address/);
    }
  });

  it("mock mode returns synthetic message id without HTTP", async () => {
    // Mock mode still requires a valid from + server_token so the adapter's
    // gating stays honest — it just skips the network call.
    const adapter = createEmailPostmarkAdapter({ mockMode: true });
    const result = await adapter.publish!(draft(), credential());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.externalId).toMatch(/^mock_postmark_/);
    }
  });
});

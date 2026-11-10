import { describe, expect, it, vi } from "vitest";

import type { ChannelCredentialBundle } from "../contracts";
import { createWordPressOutboundAdapter } from "./adapter";

const credential: ChannelCredentialBundle = {
  credentialId: "cred-row-1",
  integrationId: "wordpress-self-hosted",
  provider: "wordpress",
  status: "connected",
  fields: {
    reconnectFields: { siteUrl: "https://wordpress.example", username: "publisher" },
    secretFields: { applicationPassword: "secret" },
  },
  tokens: {},
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    draftId: "draft-1", organizationId: "org-1", domain: "marketing", sourceType: "manual",
    sourceId: null, strategyId: null, status: "approved", channelId: "wordpress-self-hosted",
    assetType: "wordpress-post", body: "Approved body", bodyFormat: "html",
    metadata: { title: "Approved title", slug: "approved-title", ...overrides },
    createdByAgentId: null, originalPromptId: null,
    createdAt: new Date("2026-08-22T00:00:00.000Z"), updatedAt: new Date("2026-08-22T00:01:00.000Z"),
  };
}

describe("WordPress outbound adapter", () => {
  it("accepts the closed canonical and legacy WordPress channel ids", () => {
    const adapter = createWordPressOutboundAdapter({ createClient: vi.fn() as never });
    expect(adapter.validateDraft(draft())).toEqual({ ok: true });
    expect(adapter.validateDraft({ ...draft(), channelId: "wordpress" })).toEqual({ ok: true });
    expect(adapter.validateDraft({ ...draft(), channelId: "wordpress-other" })).toEqual({
      ok: false,
      reason: "Draft is not routed to WordPress.",
    });
    expect(adapter.projectionIntent?.({ ...draft(), channelId: "wordpress" }, credential)).toMatchObject({
      connectorKey: "wordpress-self-hosted",
      connectionId: "wordpress-self-hosted",
    });
  });

  it("previews a stable projection and defaults even a requested publish to remote draft", () => {
    const adapter = createWordPressOutboundAdapter({ createClient: vi.fn() as never });
    expect(adapter.validateDraft(draft({ requestedStatus: "publish" }))).toEqual({ ok: true });
    expect(adapter.projectionIntent?.(draft(), credential)).toMatchObject({
      connectorKey: "wordpress-self-hosted",
      resourceKind: "post",
      sourceType: "outbound_draft",
      payload: { title: "Approved title", content: "Approved body", status: "draft" },
    });
  });

  it("updates an existing binding instead of creating a second post", async () => {
    const upsertContent = vi.fn(async () => ({ id: "42", url: "https://wordpress.example/?p=42", record: { id: 42, modified_gmt: "2026-08-22T00:02:00" } }));
    const adapter = createWordPressOutboundAdapter({ createClient: () => ({ upsertContent }) });
    const result = await adapter.publish!(draft(), credential, {
      projectionId: "ecp-1", existingExternalId: "42", payload: { title: "Approved title", content: "Approved body", status: "draft" },
    });
    expect(upsertContent).toHaveBeenCalledWith(expect.objectContaining({ externalId: "42", resourceKind: "post" }));
    expect(result).toMatchObject({ ok: true, externalId: "42" });
  });
});

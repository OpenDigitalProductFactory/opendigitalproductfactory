import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    aiProviderConnection: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    providerCapacityStatus: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  clearProviderCapacityStatus,
  recordProviderCapacityStatus,
  loadProviderCapacitySnapshots,
} from "./store";

const mockUpsert = prisma.providerCapacityStatus.upsert as ReturnType<typeof vi.fn>;
const NOW = new Date("2026-06-29T20:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue({ id: "capacity-row" });
});

describe("provider capacity store", () => {
  it("shares a conservative consumer quota restriction across aliases while keeping authentication local", async () => {
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([
      { providerId: "codex", state: "quota_resets_at", retryAt: new Date("2026-10-15T00:00:00Z"), lastObservedAt: NOW, providerConnection: null },
    ] as never);
    const quota = await loadProviderCapacitySnapshots();
    expect(quota.get("chatgpt")).toEqual(quota.get("codex"));
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([{ providerId: "codex", state: "reauth_required", retryAt: null, lastObservedAt: NOW, providerConnection: null }] as never);
    expect((await loadProviderCapacitySnapshots()).has("chatgpt")).toBe(false);
  });
  it("binds capacity attachment to the credential revision even when its row identity is reused", async () => {
    await recordProviderCapacityStatus({ providerId: "openai", source: "api",
      account: { connectionId: "account-a", credentialEntryId: "credential-a", credentialUpdatedAt: NOW },
      classification: { state: "reauth_required", action: "reconnect", safeSummary: "Reconnect this account.", confidence: "exact", isHumanActionRequired: true },
    });
    expect(prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ credentialEntry: { is: { updatedAt: NOW } } }),
    }));
  });
  it("records scoped authentication failures without overwriting provider health", async () => {
    await recordProviderCapacityStatus({ providerId: "openai", source: "api",
      account: { connectionId: "account-a", credentialEntryId: "credential-a" },
      classification: { state: "reauth_required", action: "reconnect", safeSummary: "Reconnect this account.", confidence: "exact", isHumanActionRequired: true },
    });
    expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { scopeKey: expect.stringMatching(/^account:/) },
      create: expect.objectContaining({ providerId: null }),
    }));
    expect(prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ connectionId: "account-a", providerId: "openai", credentialEntryId: "credential-a" }),
      data: { capacityStatusId: "capacity-row" },
    }));
  });
  it("upserts the current provider capacity classification", async () => {
    await recordProviderCapacityStatus({
      providerId: "zai-coding",
      source: "opencode",
      observedAt: NOW,
      classification: {
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
        safeSummary: "Z.ai needs coding credits.",
        confidence: "exact",
        isHumanActionRequired: true,
      },
      rawSnippet: "Insufficient balance",
    });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { providerId: "zai-coding" },
      create: expect.objectContaining({
        providerId: "zai-coding",
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
        source: "opencode",
        rawSnippet: "Insufficient balance",
        isHumanActionRequired: true,
      }),
      update: expect.objectContaining({
        state: "billing_action_required",
        action: "add_credits_or_plan",
        providerCode: "1113",
        source: "opencode",
        rawSnippet: "Insufficient balance",
        isHumanActionRequired: true,
      }),
    });
  });

  it("marks a provider available after a successful call", async () => {
    await clearProviderCapacityStatus({
      providerId: "zai-coding",
      source: "api",
      observedAt: NOW,
    });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { providerId: "zai-coding" },
      create: expect.objectContaining({
        providerId: "zai-coding",
        state: "available",
        action: "none",
        lastSuccessAt: NOW,
        isHumanActionRequired: false,
      }),
      update: expect.objectContaining({
        state: "available",
        action: "none",
        retryAt: null,
        providerCode: null,
        lastSuccessAt: NOW,
        isHumanActionRequired: false,
      }),
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(async (run) => run(prisma)),
    $queryRaw: vi.fn().mockResolvedValue([{ id: "immutable-a" }]),
    aiProviderConnection: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    providerCapacityStatus: {
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { accountCapacityScope, capacityCredentialRevision } from "./scopes";
import { accountRuntimeKey } from "../provider-account-candidates";
import {
  clearProviderCapacityStatus,
  recordProviderCapacityStatus,
  loadProviderCapacitySnapshots,
} from "./store";

const mockUpsert = prisma.providerCapacityStatus.upsert as ReturnType<typeof vi.fn>;
const NOW = new Date("2026-06-29T20:00:00.000Z");
const credential = { id: "credential-a", status: "ok", updatedAt: NOW, secretRef: "encrypted-test", clientSecret: null, cachedToken: null, refreshToken: null };
const identity = { accountId: "immutable-a", connectionId: "account-a", credentialEntryId: credential.id, credentialUpdatedAt: NOW, credentialRevision: capacityCredentialRevision(credential) };

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsert.mockResolvedValue({ id: "capacity-row" });
  vi.mocked(prisma.$queryRaw).mockResolvedValue([{ ...credential, id: "immutable-a", credentialId: credential.id }]);
});

afterEach(() => vi.restoreAllMocks());

describe("provider capacity store", () => {
  it("projects current account recovery facts without credential or raw provider material", async () => {
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([{
      providerId: null, scopeKey: accountCapacityScope("openai", identity.accountId),
      state: "reauth_required", retryAt: null, lastObservedAt: NOW, lastSuccessAt: NOW,
      safeSummary: "Reconnect this account.", action: "reconnect", isHumanActionRequired: true,
      rawSnippet: "must-never-reach-the-overview",
      observedCredentialRevision: identity.credentialRevision,
      ownedAccount: { id: identity.accountId, providerId: "openai", connectionId: identity.connectionId,
        status: "active", credentialEntryId: credential.id, credentialEntry: credential },
    }] as never);
    const snapshots = await loadProviderCapacitySnapshots();
    expect(snapshots.get(accountRuntimeKey("openai", identity.connectionId))).toEqual({
      state: "reauth_required", retryAtMs: null, observedAtMs: NOW.getTime(), lastSuccessAtMs: NOW.getTime(),
      safeSummary: "Reconnect this account.", action: "reconnect", isHumanActionRequired: true,
    });
    expect(snapshots.has("openai")).toBe(false);
  });
  it("does not write either health or shared quota for a replaced account", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([]);
    await recordProviderCapacityStatus({ providerId: "openai", source: "api",
      account: identity,
      classification: { state: "rate_limited", action: "retry_with_backoff", safeSummary: "Wait before retrying.", confidence: "exact", isHumanActionRequired: false },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(prisma.aiProviderConnection.updateMany).not.toHaveBeenCalled();
  });
  it("rejects replacement ciphertext even when timestamp and credential id are unchanged", async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ ...credential, id: "immutable-a", credentialId: credential.id, secretRef: "replacement-ciphertext" }]);
    await clearProviderCapacityStatus({ providerId: "openai", source: "api", account: identity });
    expect(mockUpsert).not.toHaveBeenCalled();
  });
  it("updates one current health row across token rotations", async () => {
    await clearProviderCapacityStatus({ providerId: "openai", source: "api", account: identity });
    const rotated = { ...credential, updatedAt: new Date(NOW.getTime()+1000), cachedToken: "rotated-ciphertext" };
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ ...rotated, id: "immutable-a", credentialId: credential.id }]);
    await clearProviderCapacityStatus({ providerId: "openai", source: "api", account: { ...identity, credentialUpdatedAt: rotated.updatedAt, credentialRevision: capacityCredentialRevision(rotated) } });
    expect(mockUpsert.mock.calls[0]![0].where).toEqual(mockUpsert.mock.calls[1]![0].where);
    expect(mockUpsert.mock.calls[1]![0].update.observedCredentialRevision).not.toBe(mockUpsert.mock.calls[0]![0].update.observedCredentialRevision);
    expect(vi.mocked(prisma.$queryRaw).mock.invocationCallOrder[0]).toBeLessThan(mockUpsert.mock.invocationCallOrder[0]!);
  });
  it("ignores obsolete credential health on the current account projection", async () => {
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([{ providerId: null, scopeKey: "account:obsolete", state: "reauth_required", retryAt: null, lastObservedAt: NOW,
      observedCredentialRevision: "old-revision", ownedAccount: { id: identity.accountId, providerId: "openai", connectionId: identity.connectionId, status: "active", credentialEntry: credential } }] as never);
    expect((await loadProviderCapacitySnapshots()).size).toBe(0);
  });
  it("retains revision-valid recovery details for an unconfigured overview account without adding routing eligibility", async () => {
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([{
      providerId: null, scopeKey: accountCapacityScope("openai", identity.accountId), state: "reauth_required",
      retryAt: null, lastObservedAt: NOW, safeSummary: "Reconnect this account.", action: "reconnect",
      isHumanActionRequired: true, observedCredentialRevision: identity.credentialRevision,
      ownedAccount: { id: identity.accountId, providerId: "openai", connectionId: identity.connectionId,
        status: "unconfigured", credentialEntryId: credential.id, credentialEntry: credential },
    }] as never);
    expect((await loadProviderCapacitySnapshots()).size).toBe(0);
    expect((await loadProviderCapacitySnapshots({ includeInactiveAccountHealth: true })).get(accountRuntimeKey("openai", identity.connectionId)))
      .toMatchObject({ safeSummary: "Reconnect this account.", action: "reconnect", isHumanActionRequired: true });
  });
  it("shares a conservative consumer quota restriction across aliases while keeping authentication local", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(NOW.getTime());
    const retryAt = new Date(NOW.getTime() + 60_000);
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([
      { providerId: "codex", state: "quota_resets_at", retryAt, lastObservedAt: NOW, providerConnection: null },
    ] as never);
    const quota = await loadProviderCapacitySnapshots();
    expect(quota.get("codex")).toMatchObject({ state: "quota_resets_at", retryAtMs: retryAt.getTime() });
    expect(quota.get("chatgpt")).toEqual(quota.get("codex"));
    clock.mockReturnValue(retryAt.getTime() - 1);
    expect((await loadProviderCapacitySnapshots()).get("chatgpt")).toEqual(quota.get("codex"));
    clock.mockReturnValue(retryAt.getTime());
    expect((await loadProviderCapacitySnapshots()).has("chatgpt")).toBe(false);
    vi.mocked(prisma.providerCapacityStatus.findMany).mockResolvedValue([{ providerId: "codex", state: "reauth_required", retryAt: null, lastObservedAt: NOW, providerConnection: null }] as never);
    expect((await loadProviderCapacitySnapshots()).has("chatgpt")).toBe(false);
  });
  it("binds capacity attachment to the credential revision even when its row identity is reused", async () => {
    await recordProviderCapacityStatus({ providerId: "openai", source: "api",
      account: identity,
      classification: { state: "reauth_required", action: "reconnect", safeSummary: "Reconnect this account.", confidence: "exact", isHumanActionRequired: true },
    });
    expect(prisma.aiProviderConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ credentialEntry: { is: { updatedAt: NOW } } }),
    }));
  });
  it("records scoped authentication failures without overwriting provider health", async () => {
    await recordProviderCapacityStatus({ providerId: "openai", source: "api",
      account: identity,
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

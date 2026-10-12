import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/client/client";

import { activateProviderWithDefaultConnection, ensureDefaultProviderConnection, refreshDefaultProviderConnectionOwners, setProviderStatusWithDefaultConnection } from "./provider-connection";

describe("default account authentication convergence", () => {
  const provider = { providerId: "codex", name: "Codex", category: "direct", authMethod: "oauth2_authorization_code", endpointType: "responses" };
  function fixture(owner: string | null = null) {
    return {
      modelProvider: { findUnique: vi.fn().mockResolvedValue(provider) },
      credentialEntry: { findUnique: vi.fn().mockResolvedValue({ id: "credential", providerConnection: owner ? { connectionId: owner } : null }) },
      aiProviderFinanceProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      providerCapacityStatus: { findUnique: vi.fn().mockResolvedValue(null) },
      aiProviderConnection: { upsert: vi.fn().mockResolvedValue({}), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
  }
  it("creates the default from persisted OAuth configuration rather than the registry API-key default", async () => {
    const db = fixture();
    await ensureDefaultProviderConnection(db as unknown as PrismaClient, { ...provider, authMethod: "api_key" }, "disabled");
    expect(db.aiProviderConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ authMethod: "oauth", executionChannel: "subscription-cli", status: "disabled" }),
      update: { label: "Codex", authMethod: "oauth", executionChannel: "subscription-cli" },
    }));
  });
  it("repairs stale default auth/channel while leaving status and reviewed posture intact", async () => {
    const db = fixture();
    await refreshDefaultProviderConnectionOwners(db as unknown as PrismaClient, "codex");
    expect(db.aiProviderConnection.updateMany).toHaveBeenCalledWith({
      where: { connectionId: "provider-default-codex" },
      data: { authMethod: "oauth", executionChannel: "subscription-cli", financeProfileId: null, credentialEntryId: "credential", capacityStatusId: null },
    });
  });
  it("does not reassign a legacy credential already owned by an additional account", async () => {
    const db = fixture("provider-account-other");
    await refreshDefaultProviderConnectionOwners(db as unknown as PrismaClient, "codex");
    const { where, data } = db.aiProviderConnection.updateMany.mock.calls[0]![0];
    expect(where).toEqual({ connectionId: "provider-default-codex" });
    expect(data).not.toHaveProperty("credentialEntryId");
    expect(data).toMatchObject({ authMethod: "oauth", executionChannel: "subscription-cli" });
  });
});

describe("operator routing status", () => {
  it("disables both halves atomically and surfaces failure for rollback", async () => {
    const missing = new Error("connection missing");
    const tx = {
      modelProvider: { update: vi.fn().mockResolvedValue({}) },
      aiProviderConnection: { update: vi.fn().mockRejectedValue(missing) },
    };
    const db = { $transaction: vi.fn(async (work: (t: typeof tx) => Promise<void>) => work(tx)) };
    await expect(setProviderStatusWithDefaultConnection(db as unknown as PrismaClient, { providerId: "local", status: "inactive" })).rejects.toBe(missing);
    expect(tx.modelProvider.update).toHaveBeenCalledWith({ where: { providerId: "local" }, data: { status: "inactive" } });
    expect(tx.aiProviderConnection.update).toHaveBeenCalledWith({ where: { connectionId: "provider-default-local" }, data: { status: "inactive" } });
  });
});

describe("activateProviderWithDefaultConnection", () => {
  it("activates the provider and its canonical connection in one transaction", async () => {
    const transaction = {
      modelProvider: { update: vi.fn().mockResolvedValue({}) },
      aiProviderConnection: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    };

    await activateProviderWithDefaultConnection(prisma as unknown as PrismaClient, {
      providerId: "local",
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
    });

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(transaction.modelProvider.update).toHaveBeenCalledWith({
      where: { providerId: "local" },
      data: {
        status: "active",
        sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      },
    });
    expect(transaction.aiProviderConnection.update).toHaveBeenCalledWith({
      where: { connectionId: "provider-default-local" },
      data: { status: "active" },
    });
  });

  it("surfaces a missing canonical connection so the transaction can roll back", async () => {
    const missingConnection = new Error("canonical connection missing");
    const transaction = {
      modelProvider: { update: vi.fn().mockResolvedValue({}) },
      aiProviderConnection: { update: vi.fn().mockRejectedValue(missingConnection) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    };

    await expect(
      activateProviderWithDefaultConnection(prisma as unknown as PrismaClient, {
        providerId: "local",
        sensitivityClearance: ["public"],
      }),
    ).rejects.toBe(missingConnection);

    expect(transaction.modelProvider.update).toHaveBeenCalledOnce();
    expect(transaction.aiProviderConnection.update).toHaveBeenCalledOnce();
  });
});

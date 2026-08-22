import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/client/client";

import { activateProviderWithDefaultConnection } from "./provider-connection";

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

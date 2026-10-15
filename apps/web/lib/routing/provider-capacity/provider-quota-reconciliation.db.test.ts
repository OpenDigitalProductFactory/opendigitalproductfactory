import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma, type Prisma } from "@dpf/db";
import { reconcileProviderQuotaObservation } from "./store";
import type { ProviderQuotaObservation } from "./types";

// Only the canonical leased slot database may receive these temporary rows.
const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled = Boolean(process.env.DPF_NONPROD_LEASE_ID && database
  && ["localhost", "127.0.0.1"].includes(database.hostname)
  && /^\/dpf_local_ci_\d+$/.test(database.pathname));
type Fixture = { providerId: string; connectionId: string; observation: ProviderQuotaObservation };

async function withFixture(
  linked: boolean,
  run: (tx: Prisma.TransactionClient, fixture: Fixture) => Promise<void>,
  afterCommit?: (fixture: Fixture) => Promise<void>,
) {
  const providerId = `quota-fence-test-${randomUUID()}`;
  let fixture: Fixture | undefined;
  try {
    await prisma.$transaction(async tx => {
      await tx.modelProvider.create({ data: { providerId, name: "Isolated quota fixture", families: [], authMethod: "none" } });
      const capacity = await tx.providerCapacityStatus.create({ data: {
        providerId, state: "quota_resets_at", action: "retry_at", safeSummary: "Fixture restriction",
        confidence: "exact", source: "oauth",
      } });
      const connectionId = `${providerId}-account`;
      await tx.aiProviderConnection.create({ data: {
        connectionId, providerId, executionChannel: "direct-api", status: "inactive",
        ...(linked ? { capacityStatusId: capacity.id } : {}),
      } });
      // Represents the caller's successful connection CAS, before its savepoint.
      await tx.aiProviderConnection.update({ where: { connectionId }, data: { status: "active" } });
      fixture = { providerId, connectionId, observation: {
        id: capacity.id, providerId, state: "quota_resets_at", updatedAt: capacity.updatedAt,
        ownerConnectionId: linked ? connectionId : null,
      } };
      await run(tx, fixture);
    }, { timeout: 15_000 });
    if (afterCommit && fixture) await afterCommit(fixture);
  } finally {
    // Exact newly generated provider only; cascading removes its fixture rows.
    await prisma.modelProvider.deleteMany({ where: { providerId } });
  }
}

describe.runIf(enabled)("quota reconciliation on leased PostgreSQL", () => {
  it.each([false, true])("compiles the nullable/named owner predicate (linked=%s)", async linked => {
    await withFixture(linked, async (tx, { observation }) => {
      expect(await reconcileProviderQuotaObservation(tx, observation)).toBe("cleared");
      expect((await tx.providerCapacityStatus.findUniqueOrThrow({ where: { id: observation.id } })).state).toBe("available");
      expect(await reconcileProviderQuotaObservation(tx, observation)).toBe("changed");
    });
  });

  it.each([false, true])("preserves an ownership handoff without a capacity version change (linked=%s)", async linked => {
    await withFixture(linked, async (tx, { providerId, connectionId, observation }) => {
      await tx.aiProviderConnection.update({ where: { connectionId }, data: { capacityStatusId: null } });
      await tx.aiProviderConnection.create({ data: {
        connectionId: `${connectionId}-new-owner`, providerId, executionChannel: "direct-api",
        capacityStatusId: observation.id,
      } });
      expect(await reconcileProviderQuotaObservation(tx, observation)).toBe("changed");
      const row = await tx.providerCapacityStatus.findUniqueOrThrow({ where: { id: observation.id } });
      expect(row.state).toBe("quota_resets_at");
      expect(row.updatedAt).toEqual(observation.updatedAt);
    });
  });

  it("preserves a newer same-state observation", async () => {
    await withFixture(true, async (tx, { observation }) => {
      const nextVersion = new Date(observation.updatedAt.getTime() + 10);
      await tx.providerCapacityStatus.update({ where: { id: observation.id }, data: { updatedAt: nextVersion } });
      expect(await reconcileProviderQuotaObservation(tx, observation)).toBe("changed");
      expect((await tx.providerCapacityStatus.findUniqueOrThrow({ where: { id: observation.id } })).updatedAt).toEqual(nextVersion);
    });
  });

  it("recovers a real SQL error and commits earlier authentication without clearing quota", async () => {
    await withFixture(true, async (tx, { observation }) => {
      const failingWrite = {
        $executeRaw: tx.$executeRaw.bind(tx),
        providerCapacityStatus: { updateMany: async () => {
          // Genuine PostgreSQL transaction-aborting error at the write boundary.
          await tx.$queryRaw`SELECT 1 / 0`;
          return { count: 0 };
        } },
      } as unknown as Prisma.TransactionClient;
      expect(await reconcileProviderQuotaObservation(failingWrite, observation)).toBe("write-failed");
      expect((await tx.providerCapacityStatus.findUniqueOrThrow({ where: { id: observation.id } })).state).toBe("quota_resets_at");
    }, async ({ connectionId, observation }) => {
      expect((await prisma.aiProviderConnection.findUniqueOrThrow({ where: { connectionId } })).status).toBe("active");
      expect((await prisma.providerCapacityStatus.findUniqueOrThrow({ where: { id: observation.id } })).state).toBe("quota_resets_at");
    });
  });
});

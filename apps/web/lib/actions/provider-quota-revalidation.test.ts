import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@dpf/db";

const { db } = vi.hoisted(() => ({ db: {
  providerCapacityStatus: { findUnique: vi.fn(), updateMany: vi.fn() },
  credentialEntry: { findUnique: vi.fn() },
  $executeRaw: vi.fn(),
} }));
vi.mock("@dpf/db", () => ({ prisma: db }));
import { captureProviderQuotaObservation } from "./provider-quota-revalidation";
import { reconcileProviderQuotaObservation } from "@/lib/routing/provider-capacity/store";

const defaultAccount = { providerId: "chatgpt", connectionId: "provider-default-chatgpt", credentialEntryId: "credential-default" };
const accountB = { ...defaultAccount, connectionId: "account-b", credentialEntryId: "credential-b" };
const version = new Date("2026-10-14T04:00:00Z");
type CapacityRow = {
  id: string; providerId: string; state: string; updatedAt: Date;
  providerConnection: { connectionId: string } | null;
};
let row: CapacityRow | null;
const tx = db as unknown as Prisma.TransactionClient;

beforeEach(() => {
  vi.clearAllMocks();
  db.$executeRaw.mockReset().mockResolvedValue(0);
  row = { id: "old-capacity", providerId: "chatgpt", state: "quota_resets_at", updatedAt: version, providerConnection: null };
  db.providerCapacityStatus.findUnique.mockImplementation(async () => row);
  db.credentialEntry.findUnique.mockResolvedValue({ id: "credential-default", providerConnection: { connectionId: defaultAccount.connectionId } });
  // Model conditional SQL writes: omitted conditions really would permit a
  // stale write, so deleting the version/ownership predicate breaks the tests.
  db.providerCapacityStatus.updateMany.mockImplementation(async (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    if (!row) return { count: 0 };
    for (const key of ["id", "providerId", "state"] as const) {
      if (key in input.where && row[key] !== input.where[key]) return { count: 0 };
    }
    if ("updatedAt" in input.where && row.updatedAt.getTime() !== (input.where.updatedAt as Date).getTime()) return { count: 0 };
    if ("providerConnection" in input.where) {
      const owner = (input.where.providerConnection as { is: { connectionId: string } | null }).is;
      if ((owner?.connectionId ?? null) !== (row.providerConnection?.connectionId ?? null)) return { count: 0 };
    }
    row = { ...row, state: input.data.state as string, updatedAt: new Date(row.updatedAt.getTime() + 1) };
    return { count: 1 };
  });
});

describe("selected-account quota observation", () => {
  it("captures unlinked legacy quota only for its credential-owning default", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    expect(observation).toMatchObject({ id: "old-capacity", ownerConnectionId: null, updatedAt: version });
    expect(db.credentialEntry.findUnique).toHaveBeenCalledWith({
      where: { providerId: "chatgpt" }, select: { id: true, providerConnection: { select: { connectionId: true } } },
    });
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("cleared");
    expect(row?.state).toBe("available");
    expect(db.providerCapacityStatus.updateMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { id: "old-capacity", providerId: "chatgpt", state: "quota_resets_at", updatedAt: version, providerConnection: { is: null } },
      data: expect.objectContaining({ retryAt: null, retryAfterSeconds: null, source: "oauth", lastSuccessAt: expect.any(Date) }),
    }));
  });

  it("captures a directly linked account without aliasing its credentials", async () => {
    row!.providerConnection = { connectionId: "account-b" };
    const observation = await captureProviderQuotaObservation(accountB);
    expect(observation?.ownerConnectionId).toBe("account-b");
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("cleared");
  });

  it.each(["rate_limited", "cooling_down"])("reconciles the selected account's %s observation", async (state) => {
    row!.state = state;
    const observation = await captureProviderQuotaObservation(defaultAccount);
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("cleared");
  });

  it("does not let another account clear the legacy provider quota", async () => {
    expect(await captureProviderQuotaObservation(accountB)).toBeNull();
    expect(db.credentialEntry.findUnique).not.toHaveBeenCalled();
  });

  it("does not clear a quota row owned by another connection", async () => {
    row!.providerConnection = { connectionId: "account-b" };
    expect(await captureProviderQuotaObservation(defaultAccount)).toBeNull();
  });

  it.each(["different-credential", null])("requires the matching legacy default credential (%s)", async (id) => {
    db.credentialEntry.findUnique.mockResolvedValue(id ? { id, providerConnection: null } : null);
    expect(await captureProviderQuotaObservation(defaultAccount)).toBeNull();
  });

  it("does not accept a default credential claimed by another connection", async () => {
    db.credentialEntry.findUnique.mockResolvedValue({ id: "credential-default", providerConnection: { connectionId: "account-b" } });
    expect(await captureProviderQuotaObservation(defaultAccount)).toBeNull();
  });

  it("does not look up quota without a selected credential", async () => {
    expect(await captureProviderQuotaObservation({ ...defaultAccount, credentialEntryId: null })).toBeNull();
    expect(db.providerCapacityStatus.findUnique).not.toHaveBeenCalled();
  });

  it.each(["available", "billing_action_required", "reauth_required", "unsupported_plan", "request_too_large", "provider_degraded", "unknown"])("preserves non-quota condition %s", async (state) => {
    row!.state = state;
    expect(await captureProviderQuotaObservation(defaultAccount)).toBeNull();
  });

  it("does not create availability when quota evidence is absent", async () => {
    row = null;
    expect(await captureProviderQuotaObservation(defaultAccount)).toBeNull();
    expect(db.providerCapacityStatus.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a mismatched provider observation", async () => {
    row!.providerId = "codex";
    expect(await captureProviderQuotaObservation(defaultAccount)).toBeNull();
  });
});

describe("quota observation fencing", () => {
  it("preserves a newer same-state quota observation", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    row!.updatedAt = new Date(version.getTime() + 1);
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("changed");
    expect(row!.state).toBe("quota_resets_at");
  });

  it("preserves an ownership handoff even without a timestamp change", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    row!.providerConnection = { connectionId: "account-b" };
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("changed");
    expect(row!.state).toBe("quota_resets_at");
  });

  it("preserves a changed capacity condition even without a timestamp change", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    row!.state = "billing_action_required";
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("changed");
    expect(row!.state).toBe("billing_action_required");
  });

  it("does not replay completion against a replaced quota row", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    row!.id = "replacement-capacity";
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("changed");
  });

  it("does not recreate a deleted quota row", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    row = null;
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("changed");
  });

  it("allows only one completion against the captured observation", async () => {
    const observation = await captureProviderQuotaObservation(defaultAccount);
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("cleared");
    expect(await reconcileProviderQuotaObservation(tx, observation!)).toBe("changed");
  });
});

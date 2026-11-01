import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshDefaultProviderConnectionOwners } from "../../../packages/db/src/provider-connection";
import { prepareProviderQuotaFixtures } from "./provider-quota-recovery-fixtures";
import { projectProviderRoutingControl } from "../lib/routing/provider-routing-control";

beforeEach(() => {
  for (const [key, value] of Object.entries({ CI: "true", GITHUB_ACTIONS: "true", DPF_PROVIDER_QUOTA_SCENARIO_CI: "1",
    GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
    DATABASE_URL: "postgresql://dpf:ci_test_password@localhost:5432/dpf", UX_SWEEP_BASE_URL: "http://localhost:3000" })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

function database(existingCredential = false) {
  const provider = { providerId: "chatgpt", name: "ChatGPT", category: "direct", authMethod: "oauth2_authorization_code",
    endpointType: "responses", status: "inactive", baseUrl: null, updatedAt: new Date(0) };
  const account: Record<string, unknown> = { id: "account-row", organizationId: null, label: "ChatGPT", status: "unconfigured",
    authMethod: "oauth", executionChannel: "subscription-cli", credentialEntryId: null, capacityStatusId: null, quotaStatusId: null, updatedAt: new Date(0) };
  let credential: Record<string, unknown> | null = null;
  const writes = vi.fn();
  const write = async () => { writes(); return {}; };
  const db = {
    modelProvider: { findUniqueOrThrow: vi.fn(async () => provider), findUnique: vi.fn(async () => provider), update: vi.fn(write) },
    credentialEntry: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => existingCredential && where.providerId === "chatgpt" ? 1 : 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { writes(); credential = data; return data; }),
      findUnique: vi.fn(async ({ where }: { where: { providerId: string } }) => credential?.providerId === where.providerId
        ? { ...credential, providerConnection: { connectionId: "provider-default-chatgpt" } } : null),
    },
    aiProviderFinanceProfile: { findUnique: vi.fn(async () => null) },
    aiProviderConnection: {
      findUnique: vi.fn(async () => ({ ...account })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { writes(); Object.assign(account, data); return { ...account }; }),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { writes(); Object.assign(account, data); return { count: 1 }; }),
    },
    providerCapacityStatus: { count: vi.fn(async () => 0), create: vi.fn(write), findUnique: vi.fn(async () => null) },
    modelProfile: { count: vi.fn(async () => 0), create: vi.fn(write) },
    scheduledJob: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []), create: vi.fn(write), update: vi.fn(write) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return { db: db as unknown as Parameters<typeof prepareProviderQuotaFixtures>[0], account, writes };
}

describe("provider recovery fixture default ownership", () => {
  it("keeps its credential attached when the canonical default-owner reconciler runs", async () => {
    const { db, account } = database();
    const fixture = await prepareProviderQuotaFixtures(db, "http://127.0.0.1:40000");
    expect(account.credentialEntryId).toBe(fixture.credentialId);
    await refreshDefaultProviderConnectionOwners(db, "chatgpt");
    expect(account.credentialEntryId).toBe(fixture.credentialId);
  });
  it("refuses an existing empty legacy credential before any fixture write", async () => {
    const { db, writes } = database(true);
    await expect(prepareProviderQuotaFixtures(db, "http://127.0.0.1:40000")).rejects.toThrow("refuses configured state");
    expect(writes).not.toHaveBeenCalled();
  });
  it("retains the normal credential veto despite an available capacity observation", () => {
    const control = projectProviderRoutingControl({ pw: { provider: { providerId: "chatgpt", status: "active",
      authMethod: "oauth2_authorization_code", endpointType: "responses", category: "direct" }, credential: null },
      modelCount: 1, localOnly: false, now: Date.now(), capacity: { state: "available", safeSummary: "Synthetic check completed" } });
    expect(control.eligibility.state).toBe("needs_credentials");
    expect(control.eligibility.eligible).toBe(false);
    expect(control.restrictions).toContainEqual(expect.objectContaining({ key: "setup" }));
  });
});

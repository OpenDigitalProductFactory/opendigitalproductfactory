import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccountRow } from "./ai-provider-data";
import type { ProviderWithCredential } from "./ai-provider-types";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), connections: vi.fn(), business: vi.fn(), evidence: vi.fn(), review: vi.fn(), capacity: vi.fn(), recovery: vi.fn() }));
vi.mock("./subscription-quota-recovery", () => ({ loadSubscriptionQuotaRecoveryViews: mocks.recovery }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ timeZone: "America/Chicago" }) }));
vi.mock("@/lib/routing/provider-capacity/store", () => ({ loadProviderCapacitySnapshots: mocks.capacity }));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findMany: mocks.connections } } }));
vi.mock("./ai-provider-data", () => ({ getProviderAccounts: mocks.accounts }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({ loadBusinessSuitabilityContext: mocks.business, connectionPosture: (connection: unknown) => connection, providerCatalogFacts: (provider: unknown) => provider }));
vi.mock("@/lib/routing/provider-suitability/evidence", () => ({ PROVIDER_TRUST_CLAIM_KEYS: ["no-training"], resolveProviderTrustEvidence: mocks.evidence }));
vi.mock("@/lib/routing/provider-suitability/provider-trust", () => ({ resolveProviderTrustFacts: (input: unknown) => input }));
vi.mock("@/lib/routing/provider-suitability/provider-connection-review", () => ({ projectProviderConnectionReview: mocks.review }));
import { loadProviderAccountOverview } from "./provider-account-overview.server";

const pw = { provider: { providerId: "codex", name: "Codex", status: "active" }, credential: null } as ProviderWithCredential;
const copy = { companyWork: "Company work", publicOnly: "Public only", workBlocked: "Blocked", notVerified: "Not verified", capacityUnknown: "Not reported", verifiedModels: "account models", catalogModels: "catalog models", paused: "Paused", degraded: "Needs attention", signIn: "Sign in to this account", sharedProviderLimits: "Provider-wide limits", reviewAccountBilling: "Review account billing", reviewConnectionSettings: "Review connection settings", tokenNeedsRenewal: "Token needs renewal", routingCheckUnavailable: "Routing restrictions could not be confirmed.", apiKeyMethod: "API key", workloadMethod: "Client credentials", oauthMethod: "Provider sign-in", readinessRestricted: "Routing paused", readinessUnverified: "Status unconfirmed" };
const account = { id: "connection-db", connectionId: "provider-account-team", providerId: "codex", isDefault: false, label: "Team", status: "active", credential: null, accessibleModelIds: [], modelsVerifiedAt: null, lastReviewedAt: null, supplierContractId: null } as unknown as ProviderAccountRow;
beforeEach(() => { vi.resetAllMocks(); mocks.recovery.mockResolvedValue(new Map()); mocks.capacity.mockResolvedValue(new Map()); mocks.accounts.mockResolvedValue([account]); mocks.business.mockResolvedValue({ businessContextConfigured: true }); mocks.connections.mockResolvedValue([{ ...account, provider: pw.provider, trustEvidence: [], supplierContract: null }]); mocks.evidence.mockReturnValue({ posture: { connectionId: account.connectionId } }); mocks.review.mockReturnValue({ scope: "public-only", headline: "Review terms" }); });
describe("provider account presentation truth", () => {
  it.each(["local", "openai"])("keeps %s account restrictions visible without unrelated subscription controls", async providerId => {
    const selected = { ...account, providerId, connectionId: `provider-default-${providerId}`, isDefault: true,
      credential: { hasUsableMaterial: true } };
    mocks.accounts.mockResolvedValue([selected]);
    const controls = new Map([[providerId, { eligibility: { label: "Check account settings" },
      restrictions: [{ key: "connection", summary: "Review this account's connection", until: null }] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [{ provider: { providerId, name: providerId }, credential: null } as ProviderWithCredential],
      modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy });
    expect(row.resetSummary).toContain("Review this account's connection");
    expect(row.quotaRecovery).toBeUndefined();
  });
  it.each(["codex", "chatgpt", "anthropic-sub"])("retains recovery or provider usage for the %s subscription", async providerId => {
    mocks.accounts.mockResolvedValue([{ ...account, providerId, connectionId: `provider-default-${providerId}`,
      isDefault: true, status: "paused" }]);
    const [row] = await loadProviderAccountOverview({ providers: [{ provider: { providerId, name: providerId }, credential: null } as ProviderWithCredential],
      modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(row.quotaRecovery).toBeDefined();
    expect(row.quotaRecovery?.usageUrl).toMatch(/^https:\/\//);
    expect(row.quotaRecovery?.canCheck).toBe(false);
  });
  it("shows owned recovery and shared quota without borrowing the default account's authentication failure", async () => {
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${account.connectionId}`, {
      state: "billing_action_required", safeSummary: "This account needs credits.", action: "add_credits_or_plan", isHumanActionRequired: true,
    }]]));
    const controls = new Map([["codex", { eligibility: { label: "Default sign-in failed" }, weeklyHint: "Weekly limit reached",
      restrictions: [{ key: "connection", summary: "Reconnect the default account", until: null },
        { key: "quota", summary: "Shared usage limit", until: "2026-10-15T00:00:00Z" }] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy });
    expect(row.statusLabel).toBe("Needs attention");
    expect(row.capacitySummary).toContain("This account needs credits.");
    expect(row.resetSummary).toContain("Review account billing");
    expect(row.resetSummary).toContain("Provider-wide limits");
    expect(row.resetSummary).toContain("2026-10-15T00:00:00Z");
    expect(row.resetSummary).not.toContain("Reconnect the default");
    expect(mocks.capacity).toHaveBeenCalledWith({ includeInactiveAccountHealth: true });
  });
  it("does not call an expired additional token authenticated or hide its recovery", async () => {
    mocks.accounts.mockResolvedValue([{ ...account, credential: { status: "expired", hasUsableMaterial: true } }]);
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(row.statusLabel).toBe("Needs attention");
    expect(row.resetSummary).toContain("Token needs renewal");
  });
  it("keeps connection management available when the optional health read cannot be confirmed", async () => {
    mocks.capacity.mockRejectedValue(new Error("Health read unavailable"));
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(row.connectionId).toBe(account.connectionId);
    expect(row.capacitySummary).toBe("Not reported");
    expect(row.resetSummary).toContain("Routing restrictions could not be confirmed");
  });
  it("offers API-key recovery through connection settings rather than an unavailable OAuth sign-in", async () => {
    mocks.accounts.mockResolvedValue([{ ...account, authMethod: "api-key" }]);
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${account.connectionId}`, {
      state: "reauth_required", safeSummary: "Update this account's API key.", action: "reconnect", isHumanActionRequired: true,
    }]]));
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(row.resetSummary).toContain("Review connection settings");
    expect(row.resetSummary).not.toContain("Sign in to this account");
  });
  it("does not borrow default access, quota or readiness for an additional account", async () => {
    const rows = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(rows[0]).toMatchObject({ connectionId: account.connectionId, allowedWork: "Public only", allowedWorkSummary: "Review terms", modelSummary: "Not verified", capacitySummary: "Not reported", resetSummary: null });
    expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({ evidenceConnectionId: "connection-db", connection: expect.objectContaining({ connectionId: account.connectionId }) }));
    expect(rows[0]).not.toHaveProperty("contractEvidence");
    expect(rows[0]).not.toHaveProperty("entitlements");
  });
  it("keeps verified empty access distinct from unverified catalog inventory", async () => {
    mocks.accounts.mockResolvedValue([{ ...account, modelsVerifiedAt: "2026-10-01T00:00:00Z" }]);
    const rows = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(rows[0].modelSummary).toBe("0 account models");
    expect(rows[0].capacitySummary).toBe("Not reported");
  });
  it("hides untouched seed defaults while retaining paused Local", async () => {
    const local = { ...account, providerId: "local", connectionId: "provider-default-local", isDefault: true, status: "paused" };
    mocks.accounts.mockResolvedValue([{ ...account, connectionId: "provider-default-codex", isDefault: true }, local]);
    const rows = await loadProviderAccountOverview({ providers: [pw, { provider: { providerId: "local", name: "Local" }, credential: null } as ProviderWithCredential], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
    expect(rows.map(row => row.providerId)).toEqual(["local"]);
    expect(rows[0].statusLabel).toBe("Paused");
  });
});


describe("readiness keeps account proof separate from provider aggregates", () => {
  it("uses account-owned success and keeps an additional account independent of default authentication", async () => {
    mocks.accounts.mockResolvedValue([{ ...account, authMethod: "api-key", credential: { hasUsableMaterial: true } }]);
    const now = new Date("2026-10-28T20:00:00Z");
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${account.connectionId}`, { state: "available", lastSuccessAtMs: now.getTime()-1000 }]]));
    const controls = new Map([["codex", { eligibility: { eligible: false, state: "needs_credentials" }, healthStatus: "needs_reauth",
      restrictions: [{ key: "connection", summary: "Reconnect the default account", until: null }] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("working");
  });
  it.each([false, true])("keeps an additional account unconfirmed without shared routing observations (recent success: %s)", async recentSuccess => {
    const now = new Date("2026-10-28T20:00:00Z");
    mocks.accounts.mockResolvedValue([{ ...account, authMethod: "api-key", credential: { hasUsableMaterial: true } }]);
    mocks.capacity.mockResolvedValue(recentSuccess ? new Map([[`codex:account:${account.connectionId}`,
      { state: "available", lastSuccessAtMs: now.getTime() - 1000 }]]) : new Map());
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy, now });
    expect(row.readiness).toMatchObject({ state: "unverified", summary: copy.routingCheckUnavailable });
  });
  it.each(["inactive", "disabled", "paused", "unconfigured"])("retains the provider's %s routing veto for an active additional account", async status => {
    const now = new Date("2026-10-28T20:00:00Z");
    mocks.accounts.mockResolvedValue([{ ...account, authMethod: "api-key", credential: { hasUsableMaterial: true } }]);
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${account.connectionId}`,
      { state: "available", lastSuccessAtMs: now.getTime() - 1000 }]]));
    const controls = new Map([["codex", { eligibility: { eligible: false, state: "disabled" }, restrictions: [] }]]) as never;
    const provider = { ...pw, provider: { ...pw.provider, status } };
    const [row] = await loadProviderAccountOverview({ providers: [provider], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.readiness).toMatchObject({ state: "paused", label: copy.readinessRestricted });
  });
  it.each([["api-key", "API key"], ["workload-identity", "Client credentials"], ["oauth", "Provider sign-in"]])(
    "labels the persisted %s account contract", async (authMethod, label) => {
      mocks.accounts.mockResolvedValue([{ ...account, authMethod, credential: { hasUsableMaterial: true } }]);
      const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy });
      expect(row.connectionSummary).toMatch(new RegExp(`^${label} ·`));
    },
  );
  it("does not borrow provider aggregate success as proof for the default account", async () => {
    const now = new Date("2026-10-28T20:00:00Z");
    mocks.accounts.mockResolvedValue([{ ...account, isDefault: true, credential: { hasUsableMaterial: true } }]);
    mocks.capacity.mockResolvedValue(new Map([["codex", { state: "available", lastSuccessAtMs: now.getTime()-1000 }]]));
    const controls = new Map([["codex", { eligibility: { eligible: true, state: "routable" }, restrictions: [], healthSummary: "No hold" }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("enabled");
  });
});


describe("legacy default account activation", () => {
  it("shows existing provider activation without borrowing it for an additional account", async () => {
    const configured = { provider: { providerId: "codex", name: "Codex", status: "active" }, credential: { hasUsableMaterial: true } } as ProviderWithCredential;
    mocks.accounts.mockResolvedValue([{ ...account, isDefault: true, status: "unconfigured" }, { ...account, status: "unconfigured" }]);
    const controls = new Map([["codex", { eligibility: { eligible: true, state: "routable" }, restrictions: [], healthSummary: "No hold" }]]) as never;
    const rows = await loadProviderAccountOverview({ providers: [configured], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy });
    expect(rows.map(row => row.readiness?.state)).toEqual(["enabled", "blocked"]);
  });
});

describe("readiness and quota recovery coexistence", () => {
  const now = new Date("2026-10-31T20:00:00Z");
  const connectionId = "provider-default-codex";
  const nextCheckAt = "2026-10-31T21:00:00Z";
  beforeEach(() => {
    mocks.accounts.mockResolvedValue([{ ...account, connectionId, isDefault: true, authMethod: "api-key",
      credential: { hasUsableMaterial: true } }]);
    mocks.recovery.mockResolvedValue(new Map([[connectionId, { models: [{ modelId: "checked-model", name: "Checked model" }],
      selectedModelId: "checked-model", hourly: true, nextCheckAt, lastCheckAt: now.toISOString(), lastResult: "recovered" }]]));
  });
  it("uses the durable recovery schedule instead of an absent legacy restriction", async () => {
    const controls = new Map([["codex", { eligibility: { eligible: true, state: "routable" }, restrictions: [] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.quotaRecovery).toMatchObject({ nextCheckAt, selectedModelId: "checked-model", hourly: true, canCheck: true });
    expect(row.quotaRecheckAt).toBe(nextCheckAt);
  });
  it("does not resurrect a legacy schedule after the durable commission stops", async () => {
    mocks.recovery.mockResolvedValue(new Map([[connectionId, { models: [], nextCheckAt: null, hourly: false }]]));
    const controls = new Map([["codex", { eligibility: { eligible: true, state: "routable" }, restrictions: [
      { key: "quota-recovery", summary: "Old projected schedule", until: nextCheckAt } ] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.quotaRecheckAt).toBeNull();
    expect(row.quotaRecovery).toMatchObject({ hourly: false, nextCheckAt: null });
  });
  it("does not borrow default authentication or its scheduled job for an additional account", async () => {
    mocks.accounts.mockResolvedValue([{ ...account, authMethod: "api-key", credential: { hasUsableMaterial: true } }]);
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${account.connectionId}`, { state: "available", lastSuccessAtMs: now.getTime() - 1000 }]]));
    const controls = new Map([["codex", { eligibility: { eligible: false, state: "needs_credentials" }, healthStatus: "needs_reauth",
      restrictions: [{ key: "connection", summary: "Reconnect the default account", until: null }] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("working");
    expect(row.connectionSummary).toMatch(/^API key/);
    expect(row.quotaRecovery).toMatchObject({ hourly: false, nextCheckAt: null, canCheck: false });
    expect(mocks.recovery).not.toHaveBeenCalled();
  });
  it("preserves exact model proof while a provider lifecycle hold prevents checks", async () => {
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${connectionId}`, { state: "available", lastSuccessAtMs: now.getTime() - 1000,
      executionProof: { modelId: "checked-model", observedAt: now.getTime() - 1000, expiresAt: now.getTime() + 60_000 } }]]));
    const controls = new Map([["codex", { eligibility: { eligible: false, state: "disabled" }, restrictions: [] }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [{ ...pw, provider: { ...pw.provider, status: "inactive" } }],
      modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("paused");
    expect(row.quotaRecovery).toMatchObject({ checkedModelId: "checked-model", proofExpiresAt: new Date(now.getTime() + 60_000).toISOString(), canCheck: false });
  });
  it("retains recovery details while missing shared controls keep readiness unconfirmed", async () => {
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${connectionId}`, { state: "available", lastSuccessAtMs: now.getTime() - 1000 }]]));
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("unverified");
    expect(row.quotaRecovery).toMatchObject({ selectedModelId: "checked-model", nextCheckAt });
  });
});

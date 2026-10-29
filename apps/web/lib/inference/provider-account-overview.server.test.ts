import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccountRow } from "./ai-provider-data";
import type { ProviderWithCredential } from "./ai-provider-types";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), connections: vi.fn(), business: vi.fn(), evidence: vi.fn(), review: vi.fn(), capacity: vi.fn() }));
vi.mock("@/lib/routing/provider-capacity/store", () => ({ loadProviderCapacitySnapshots: mocks.capacity }));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findMany: mocks.connections } } }));
vi.mock("./ai-provider-data", () => ({ getProviderAccounts: mocks.accounts }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({ loadBusinessSuitabilityContext: mocks.business, connectionPosture: (connection: unknown) => connection, providerCatalogFacts: (provider: unknown) => provider }));
vi.mock("@/lib/routing/provider-suitability/evidence", () => ({ PROVIDER_TRUST_CLAIM_KEYS: ["no-training"], resolveProviderTrustEvidence: mocks.evidence }));
vi.mock("@/lib/routing/provider-suitability/provider-trust", () => ({ resolveProviderTrustFacts: (input: unknown) => input }));
vi.mock("@/lib/routing/provider-suitability/provider-connection-review", () => ({ projectProviderConnectionReview: mocks.review }));
import { loadProviderAccountOverview } from "./provider-account-overview.server";

const pw = { provider: { providerId: "codex", name: "Codex" }, credential: null } as ProviderWithCredential;
const copy = { companyWork: "Company work", publicOnly: "Public only", workBlocked: "Blocked", notVerified: "Not verified", capacityUnknown: "Not reported", verifiedModels: "account models", catalogModels: "catalog models", paused: "Paused", degraded: "Needs attention", signIn: "Sign in to this account", sharedProviderLimits: "Provider-wide limits", reviewAccountBilling: "Review account billing", reviewConnectionSettings: "Review connection settings", tokenNeedsRenewal: "Token needs renewal", routingCheckUnavailable: "Routing restrictions could not be confirmed." };
const account = { id: "connection-db", connectionId: "provider-account-team", providerId: "codex", isDefault: false, label: "Team", status: "active", credential: null, accessibleModelIds: [], modelsVerifiedAt: null, lastReviewedAt: null, supplierContractId: null } as unknown as ProviderAccountRow;
beforeEach(() => { vi.resetAllMocks(); mocks.capacity.mockResolvedValue(new Map()); mocks.accounts.mockResolvedValue([account]); mocks.business.mockResolvedValue({ businessContextConfigured: true }); mocks.connections.mockResolvedValue([{ ...account, provider: pw.provider, trustEvidence: [], supplierContract: null }]); mocks.evidence.mockReturnValue({ posture: { connectionId: account.connectionId } }); mocks.review.mockReturnValue({ scope: "public-only", headline: "Review terms" }); });
describe("provider account presentation truth", () => {
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
    mocks.accounts.mockResolvedValue([{ ...account, authMethod: "api_key", credential: { hasUsableMaterial: true } }]);
    const now = new Date("2026-10-28T20:00:00Z");
    mocks.capacity.mockResolvedValue(new Map([[`codex:account:${account.connectionId}`, { state: "available", lastSuccessAtMs: now.getTime()-1000 }]]));
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls: new Map(), resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("working");
  });
  it("does not borrow provider aggregate success as proof for the default account", async () => {
    const now = new Date("2026-10-28T20:00:00Z");
    mocks.accounts.mockResolvedValue([{ ...account, isDefault: true, credential: { hasUsableMaterial: true } }]);
    mocks.capacity.mockResolvedValue(new Map([["codex", { state: "available", lastSuccessAtMs: now.getTime()-1000 }]]));
    const controls = new Map([["codex", { eligibility: { eligible: true, state: "routable" }, restrictions: [], healthSummary: "No hold" }]]) as never;
    const [row] = await loadProviderAccountOverview({ providers: [pw], modelSummaries: new Map(), controls, resolvesPhases: new Map(), copy, now });
    expect(row.readiness?.state).toBe("enabled");
  });
});

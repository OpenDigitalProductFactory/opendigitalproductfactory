import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAccountRow } from "./ai-provider-data";
import type { ProviderWithCredential } from "./ai-provider-types";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), connections: vi.fn(), business: vi.fn(), evidence: vi.fn(), review: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { aiProviderConnection: { findMany: mocks.connections } } }));
vi.mock("./ai-provider-data", () => ({ getProviderAccounts: mocks.accounts }));
vi.mock("@/lib/i18n/t.server", () => ({ getT: async () => (key: string) => key }));
vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({ loadBusinessSuitabilityContext: mocks.business, connectionPosture: (connection: unknown) => connection, providerCatalogFacts: (provider: unknown) => provider }));
vi.mock("@/lib/routing/provider-suitability/evidence", () => ({ PROVIDER_TRUST_CLAIM_KEYS: ["no-training"], resolveProviderTrustEvidence: mocks.evidence }));
vi.mock("@/lib/routing/provider-suitability/provider-trust", () => ({ resolveProviderTrustFacts: (input: unknown) => input }));
vi.mock("@/lib/routing/provider-suitability/provider-connection-review", () => ({ projectProviderConnectionReview: mocks.review }));
import { loadProviderAccountOverview } from "./provider-account-overview.server";

const pw = { provider: { providerId: "codex", name: "Codex" }, credential: null } as ProviderWithCredential;
const copy = { companyWork: "Company work", publicOnly: "Public only", workBlocked: "Blocked", notVerified: "Not verified", capacityUnknown: "Not reported", verifiedModels: "account models", catalogModels: "catalog models", paused: "Paused" };
const account = { id: "connection-db", connectionId: "provider-account-team", providerId: "codex", isDefault: false, label: "Team", status: "active", credential: null, accessibleModelIds: [], modelsVerifiedAt: null, lastReviewedAt: null, supplierContractId: null } as unknown as ProviderAccountRow;
beforeEach(() => { vi.resetAllMocks(); mocks.accounts.mockResolvedValue([account]); mocks.business.mockResolvedValue({ businessContextConfigured: true }); mocks.connections.mockResolvedValue([{ ...account, provider: pw.provider, trustEvidence: [], supplierContract: null }]); mocks.evidence.mockReturnValue({ posture: { connectionId: account.connectionId } }); mocks.review.mockReturnValue({ scope: "public-only", headline: "Review terms" }); });
describe("provider account presentation truth", () => {
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

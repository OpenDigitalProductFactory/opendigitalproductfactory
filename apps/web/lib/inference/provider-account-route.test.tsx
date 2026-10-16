import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), provider: vi.fn(), connection: vi.fn(), legacyCredential: vi.fn(), bearer: vi.fn(), recipes: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NotFound"); }, redirect: () => { throw new Error("Redirect"); } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "operator", platformRole: "owner", isSuperuser: true } }) }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: async () => ({ authMethod: "api_key" }) }, credentialEntry: { findUnique: mocks.legacyCredential }, aiProviderConnection: { findUnique: mocks.connection } }, getInfraCIs: async () => [] }));
vi.mock("@/lib/ai-provider-data", () => ({ getProviderAccounts: mocks.accounts, getProviderById: mocks.provider, getProviders: async () => [], getDiscoveredModels: async () => [], getModelProfiles: async () => [], getModelClassCounts: async () => [], getRecipesForProvider: mocks.recipes, getTokenSpendByProvider: async () => [] }));
vi.mock("@/lib/inference/ai-provider-internals", () => ({ getProviderBearerToken: mocks.bearer }));
vi.mock("@/lib/inference/provider-account-overview.server", () => ({ getProviderAccountCopy: async () => ({ allowedWork: "Allowed work", models: "Models", modelsExecution: "Models and execution", usage: "Usage", diagnostics: "Diagnostics" }) }));
vi.mock("@/lib/inference/ai-provider-cost-view", () => ({ buildProviderCostView: () => ({}) }));
vi.mock("@/lib/inference/provider-routing-control-data", () => ({ loadProviderRoutingControls: async () => new Map() }));
vi.mock("@/lib/actions/endpoint-performance", () => ({ getRoutingProfiles: async () => [], getEndpointPerformance: async () => ({}), getRecentRouteDecisions: async () => [] }));
vi.mock("@/lib/finance/ai-provider-finance", () => ({ getAiProviderFinanceDetail: async () => ({}) }));
vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({ connectionPosture: (value: unknown) => value, providerCatalogFacts: (value: unknown) => value, loadBusinessSuitabilityContext: async () => ({}) }));
vi.mock("@/lib/routing/provider-suitability/evidence", () => ({ PROVIDER_TRUST_CLAIM_KEYS: [], resolveProviderTrustEvidence: () => ({ posture: {}, claims: [] }) }));
vi.mock("@/lib/routing/provider-suitability/provider-trust", () => ({ resolveProviderTrustFacts: () => ({}) }));
vi.mock("@/lib/routing/provider-suitability/provider-connection-review", () => ({ projectProviderConnectionReview: () => ({ scope: "public-only", headline: "Public", summary: "Review terms", requiredClaimKeys: [], requiredRegions: [], actions: [] }) }));
vi.mock("@/lib/actions/provider-clearance-override", () => ({ listActiveProviderClearanceOverrides: async () => [] }));
vi.mock("@/components/platform/local-models/provider-detail-policy", () => ({ shouldShowProviderAccountPosture: () => true }));
vi.mock("@/components/platform/ProviderDetailForm", () => ({ ProviderDetailForm: () => null }));
vi.mock("@/components/platform/ProviderAccountConnectionForm", () => ({ ProviderAccountConnectionForm: () => null }));
vi.mock("@/components/platform/OAuthConnectionStatus", () => ({ OAuthConnectionStatus: () => null }));
vi.mock("@/components/platform/OllamaManagement", () => ({ OllamaManagement: () => null }));
import ProviderDetailPage from "@/app/(shell)/platform/ai/providers/[providerId]/page";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";
import { ProviderAccountConnectionForm } from "@/components/platform/ProviderAccountConnectionForm";
import { OAuthConnectionStatus } from "@/components/platform/OAuthConnectionStatus";
import { ProviderDetailSections } from "@/components/platform/ProviderDetailSections";
import { RecipePanel } from "@/components/platform/RecipePanel";

const initial = { providerId: "codex", connectionId: "provider-default-codex", isDefault: true, authMethod: "api-key", status: "active", credential: { hasUsableMaterial: true } };
const extra = { ...initial, connectionId: "provider-account-team", isDefault: false, label: "Team", credential: null, modelsVerifiedAt: null };
function elements(node: ReactNode): Array<ReactElement<{ children?: ReactNode }>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...elements(node.props.children)];
}
async function resolvedSections(node: unknown): Promise<Array<ReactElement<Record<string, unknown>>>> {
  if (Array.isArray(node)) return (await Promise.all(node.map(resolvedSections))).flat();
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") {
    return resolvedSections(await (node.type as (props: unknown) => Promise<unknown>)(node.props));
  }
  const sections = Array.isArray(node.props.sections) ? node.props.sections as Array<{ content: unknown }> : [];
  return [node, ...await resolvedSections(node.props.children), ...await resolvedSections(node.props.executionRecipes), ...await resolvedSections(sections.map(section => section.content))];
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.accounts.mockResolvedValue([initial, extra]); mocks.recipes.mockResolvedValue([]);
  mocks.provider.mockResolvedValue({ provider: { providerId: "codex", name: "Codex", endpointType: "model", authMethod: "api_key", sensitivityClearance: [] }, credential: { status: "ok", secretHint: "default-key-hint" } });
  mocks.connection.mockResolvedValue({ id: "connection-db", provider: { providerId: "codex" }, entitlements: {}, trustEvidence: [], supplierContract: null });
});
describe("provider account route boundary", () => {
  it.each([initial.connectionId, extra.connectionId])("keeps provider recipes under Models and execution for %s", async connectionId => {
    mocks.recipes.mockResolvedValue([{ id: "recipe-one", contractFamily: "coding.refactor", modelId: "codex-one", executionAdapter: "chat", status: "champion", version: 1, origin: "test" }]);
    const owners = await resolvedSections(await ProviderDetailPage({ params: Promise.resolve({ providerId: "codex" }), searchParams: Promise.resolve({ account: connectionId }) }));
    const sections = owners.filter(owner => owner.type === ProviderDetailSections).flatMap(owner =>
      owner.props.sections as Array<{ key: string; title: string; content: unknown }>);
    if (connectionId === initial.connectionId) {
      const settings = owners.find(owner => owner.type === ProviderDetailForm);
      expect((await resolvedSections(settings?.props.executionRecipes)).some(owner => owner.type === RecipePanel)).toBe(true);
    } else {
      const models = sections.find(section => section.key === "models");
      expect(models?.title).toBe("Models and execution");
      expect((await resolvedSections(models?.content)).some(owner => owner.type === RecipePanel)).toBe(true);
    }
    const usage = sections.find(section => section.key === "usage");
    expect((await resolvedSections(usage?.content)).some(owner => owner.type === RecipePanel)).toBe(false);
  });
  it.each(["missing", "", "foreign-account"])("rejects explicit %s before reading default credentials or refreshing tokens", async selection => {
    mocks.accounts.mockResolvedValue([initial, { ...extra, providerId: "anthropic", connectionId: "foreign-account" }]);
    await expect(ProviderDetailPage({ params: Promise.resolve({ providerId: "codex" }), searchParams: Promise.resolve({ account: selection }) })).rejects.toThrow("NotFound");
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.legacyCredential).not.toHaveBeenCalled(); expect(mocks.bearer).not.toHaveBeenCalled();
  });
  it("renders the selected extra account without default credential controls or default OAuth status", async () => {
    const tree = await ProviderDetailPage({ params: Promise.resolve({ providerId: "codex" }), searchParams: Promise.resolve({ account: extra.connectionId }) });
    const nodes = elements(tree);
    expect(nodes.some(node => node.type === ProviderAccountConnectionForm)).toBe(true);
    expect(nodes.find(node => node.type === ProviderAccountConnectionForm)?.key).toBe(extra.connectionId);
    expect(nodes.some(node => node.type === ProviderDetailForm)).toBe(false);
    expect(nodes.some(node => node.type === OAuthConnectionStatus)).toBe(false);
    expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: extra.connectionId } }));
  });
  it("retains existing default-provider links and their legacy credential controls", async () => {
    const tree = await ProviderDetailPage({ params: Promise.resolve({ providerId: "codex" }), searchParams: Promise.resolve({}) });
    expect(elements(tree).some(node => node.type === ProviderDetailForm)).toBe(true);
    expect(elements(tree).some(node => node.type === ProviderAccountConnectionForm)).toBe(false);
    expect(mocks.connection).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: initial.connectionId } }));
  });
  it("renders fresh masked OAuth state after a selected account self-heals", async () => {
    const expired = { status: "ok", hasUsableMaterial: true, hasRefreshToken: true, tokenExpiresAt: new Date(Date.now() - 60_000).toISOString() };
    const fresh = { ...expired, tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    let refreshed = false;
    mocks.connection.mockImplementation(async (input: { select?: unknown }) => input.select
      ? { providerId: "codex", authMethod: "oauth", credentialEntry: { tokenExpiresAt: new Date(expired.tokenExpiresAt), refreshToken: "test-refresh" } }
      : { id: "connection-db", provider: { providerId: "codex" }, entitlements: {}, trustEvidence: [], supplierContract: null });
    mocks.accounts.mockImplementation(async () => [{ ...extra, authMethod: "oauth", credential: refreshed ? fresh : expired }]);
    mocks.bearer.mockImplementation(async () => { refreshed = true; return { token: "test-access" }; });
    const tree = await ProviderDetailPage({ params: Promise.resolve({ providerId: "codex" }), searchParams: Promise.resolve({ account: extra.connectionId }) });
    const status = elements(tree).find(node => node.type === OAuthConnectionStatus);
    expect((status?.props as { credential?: { tokenExpiresAt: string } }).credential?.tokenExpiresAt).toBe(fresh.tokenExpiresAt);
    expect(mocks.bearer).toHaveBeenCalledWith("codex", extra.connectionId);
  });
});

import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ accounts: vi.fn(), provider: vi.fn(), connection: vi.fn(), legacyCredential: vi.fn(), bearer: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NotFound"); }, redirect: () => { throw new Error("Redirect"); } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "operator", platformRole: "owner", isSuperuser: true } }) }));
vi.mock("@/lib/permissions", () => ({ can: () => true }));
vi.mock("@dpf/db", () => ({ prisma: { modelProvider: { findUnique: async () => ({ authMethod: "api_key" }) }, credentialEntry: { findUnique: mocks.legacyCredential }, aiProviderConnection: { findUnique: mocks.connection } }, getInfraCIs: async () => [] }));
vi.mock("@/lib/ai-provider-data", () => ({ getProviderAccounts: mocks.accounts, getProviderById: mocks.provider, getProviders: async () => [], getDiscoveredModels: async () => [], getModelProfiles: async () => [], getModelClassCounts: async () => [], getRecipesForProvider: async () => [], getTokenSpendByProvider: async () => [] }));
vi.mock("@/lib/inference/ai-provider-internals", () => ({ getProviderBearerToken: mocks.bearer }));
vi.mock("@/lib/inference/provider-account-overview.server", () => ({ getProviderAccountCopy: async () => ({ allowedWork: "Allowed work", models: "Models", usage: "Usage", diagnostics: "Diagnostics" }) }));
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

const initial = { providerId: "codex", connectionId: "provider-default-codex", isDefault: true, authMethod: "api-key", status: "active", credential: { hasUsableMaterial: true } };
const extra = { ...initial, connectionId: "provider-account-team", isDefault: false, label: "Team", credential: null, modelsVerifiedAt: null };
function elements(node: ReactNode): Array<ReactElement<{ children?: ReactNode }>> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node, ...elements(node.props.children)];
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.accounts.mockResolvedValue([initial, extra]);
  mocks.provider.mockResolvedValue({ provider: { providerId: "codex", name: "Codex", endpointType: "model", authMethod: "api_key", sensitivityClearance: [] }, credential: { status: "ok", secretHint: "default-key-hint" } });
  mocks.connection.mockResolvedValue({ id: "connection-db", provider: { providerId: "codex" }, entitlements: {}, trustEvidence: [], supplierContract: null });
});
describe("provider account route boundary", () => {
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
});

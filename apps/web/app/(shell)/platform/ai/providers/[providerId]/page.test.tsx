import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import ProviderDetailPage from "./page";
import { ProviderDetailForm } from "@/components/platform/ProviderDetailForm";
import { ProviderDetailSections } from "@/components/platform/ProviderDetailSections";
import { ProviderCostSourcePanel } from "@/components/platform/ProviderCostSourcePanel";
import { RecipePanel } from "@/components/platform/RecipePanel";
import { shouldShowProviderAccountPosture } from "@/components/platform/local-models/provider-detail-policy";

const fixture = vi.hoisted(() => ({ canWrite: true, financeError: false, recipeError: false, recipes: [] as Array<{
  id: string; contractFamily: string; modelId: string; executionAdapter: string; status: string; version: number; origin: string;
}> }));
const recipe = { id: "recipe-one", contractFamily: "coding.refactor", modelId: "local-one", executionAdapter: "chat", status: "champion", version: 1, origin: "test" };
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("Not found"); }, redirect: () => { throw new Error("Redirect"); } }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { platformRole: "platform_manager" } }) }));
vi.mock("@/lib/permissions", () => ({ can: () => fixture.canWrite }));
vi.mock("@dpf/db", () => ({ getInfraCIs: async () => [], prisma: {
  aiProviderConnection: { findUnique: async () => null }, modelProvider: { findUnique: async () => ({ authMethod: "none" }) },
} }));
vi.mock("@/lib/ai-provider-data", () => ({
  getProviderById: async (providerId: string) => ({ provider: { providerId, name: providerId, status: "active", category: "local",
    endpointType: "openai-compatible", authMethod: "none", costModel: "compute", computeWatts: 180, electricityRateKwh: 0.2 }, credential: null }),
  getProviderAccounts: async () => [], getProviders: async () => [], getDiscoveredModels: async () => [], getModelProfiles: async () => [],
  getRecipesForProvider: async () => { if (fixture.recipeError) throw new Error("Recipes unavailable"); return fixture.recipes; },
  getModelClassCounts: async () => [], getTokenSpendByProvider: async () => [],
}));
vi.mock("@/lib/inference/ai-provider-internals", () => ({ getProviderBearerToken: vi.fn() }));
vi.mock("@/lib/inference/provider-routing-control-data", () => ({ loadProviderRoutingControls: async () => new Map() }));
vi.mock("@/lib/inference/provider-account-overview.server", () => ({ getProviderAccountCopy: async () => ({
  providerSettings: "Provider settings", usage: "Usage and billing", diagnostics: "Diagnostics and history",
  modelsExecution: "Models and execution", loadingRecipes: "Loading execution recipes", recipesUnavailable: "Recipes unavailable",
}) }));
vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({ loadBusinessSuitabilityContext: async () => ({}), connectionPosture: vi.fn(), providerCatalogFacts: vi.fn() }));
vi.mock("@/lib/actions/provider-clearance-override", () => ({ listActiveProviderClearanceOverrides: async () => [] }));
vi.mock("@/lib/finance/ai-provider-finance", () => ({ getAiProviderFinanceDetail: async () => { if (fixture.financeError) throw new Error("Finance unavailable"); return null; } }));
vi.mock("@/lib/inference/ai-provider-cost-view", () => ({ buildProviderCostView: () => ({}) }));
vi.mock("@/lib/actions/endpoint-performance", () => ({ getRoutingProfiles: async () => [],
  getEndpointPerformance: async () => ({ performances: [], recentEvals: [], testRuns: [], profile: null }), getRecentRouteDecisions: async () => [],
}));
vi.mock("@/components/platform/ProviderDetailForm", () => ({ ProviderDetailForm: () => null }));
vi.mock("@/components/platform/OllamaManagement", () => ({ OllamaManagement: () => null }));
vi.mock("@/components/platform/ProviderRoutingControlPanel", () => ({ ProviderRoutingControlPanel: () => null }));
vi.mock("@/components/platform/ProviderCostSourcePanel", () => ({ ProviderCostSourcePanel: () => null }));
vi.mock("@/components/finance/AiProviderFinancePanel", () => ({ AiProviderFinancePanel: () => null }));

// Resolve only the asynchronous route sections, as RSC does. Client owners stay
// intact so this checks whether the route actually includes their existing UI.
async function sectionOwners(value: unknown): Promise<ReactElement<Record<string, unknown>>[]> {
  if (Array.isArray(value)) return (await Promise.all(value.map(sectionOwners))).flat();
  if (!isValidElement<Record<string, unknown>>(value)) return [];
  if (typeof value.type === "function" && value.type.constructor.name === "AsyncFunction") {
    return sectionOwners(await (value.type as (props: unknown) => Promise<unknown>)(value.props));
  }
  const sections = Array.isArray(value.props.sections) ? value.props.sections as Array<{ content: unknown }> : [];
  return [value, ...await sectionOwners(value.props.children), ...await sectionOwners(value.props.executionRecipes), ...await sectionOwners(sections.map(section => section.content))];
}

describe("local provider page preservation", () => {
  beforeEach(() => { fixture.canWrite = true; fixture.financeError = false; fixture.recipeError = false; fixture.recipes = []; });
  it.each(["local", "ollama"])("places existing %s recipes under Models and execution, outside billing", async providerId => {
    fixture.recipes = [recipe];
    const owners = await sectionOwners(await ProviderDetailPage({ params: Promise.resolve({ providerId }), searchParams: Promise.resolve({}) }));
    const sections = owners.filter(owner => owner.type === ProviderDetailSections).flatMap(owner =>
      owner.props.sections as Array<{ key: string; title: string; content: unknown }>);
    const settings = owners.find(owner => owner.type === ProviderDetailForm);
    expect((await sectionOwners(settings?.props.executionRecipes)).some(owner => owner.type === RecipePanel)).toBe(true);
    const usage = sections.find(section => section.key === "usage");
    expect((await sectionOwners(usage?.content)).some(owner => owner.type === RecipePanel)).toBe(false);
  });
  it("keeps execution recipes available when finance fails", async () => {
    fixture.financeError = true; fixture.recipes = [recipe];
    const owners = await sectionOwners(await ProviderDetailPage({ params: Promise.resolve({ providerId: "local" }), searchParams: Promise.resolve({}) }));
    expect(owners.some(owner => owner.type === RecipePanel)).toBe(true);
  });
  it("keeps billing available when execution recipes fail", async () => {
    fixture.recipeError = true;
    const owners = await sectionOwners(await ProviderDetailPage({ params: Promise.resolve({ providerId: "local" }), searchParams: Promise.resolve({}) }));
    expect(owners.some(owner => owner.type === ProviderCostSourcePanel)).toBe(true);
  });
  it.each(["local", "ollama"])("keeps existing settings and billing owners behind disclosures for %s", async providerId => {
    const owners = await sectionOwners(await ProviderDetailPage({ params: Promise.resolve({ providerId }), searchParams: Promise.resolve({}) }));
    const settings = owners.find(owner => owner.type === ProviderDetailForm);
    expect(settings).toBeDefined();
    expect(settings?.props.canWrite).toBe(true);
    expect((settings?.props.pw as { provider: { computeWatts: number } }).provider.computeWatts).toBe(180);
    const titles = owners.filter(owner => owner.type === ProviderDetailSections).flatMap(owner =>
      (owner.props.sections as Array<{ title: string }>).map(section => section.title));
    expect(titles).toContain("Provider settings");
    expect(titles).toContain("Usage and billing");
  });
  it("retains the existing read-only settings boundary", async () => {
    fixture.canWrite = false;
    const owners = await sectionOwners(await ProviderDetailPage({ params: Promise.resolve({ providerId: "local" }), searchParams: Promise.resolve({}) }));
    expect(owners.find(owner => owner.type === ProviderDetailForm)?.props.canWrite).toBe(false);
  });
});

describe("provider detail account posture policy", () => {
  it.each(["local", "ollama"])("omits cloud account and training questions for %s", (providerId) => {
    expect(shouldShowProviderAccountPosture(providerId, "openai-compatible")).toBe(false);
  });

  it("keeps account posture for remote inference providers", () => {
    expect(shouldShowProviderAccountPosture("openai", "openai-compatible")).toBe(true);
  });

  it("keeps service providers on their dedicated detail surface", () => {
    expect(shouldShowProviderAccountPosture("github", "service")).toBe(false);
  });
});

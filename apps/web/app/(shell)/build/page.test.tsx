import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), capability: vi.fn(), builds: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: { platformDevConfig: { findUnique: vi.fn(async () => ({ clientId: null, governedBacklogEnabled: false })) } } }));
vi.mock("@/lib/build/build-studio-capability", () => ({ loadBuildStudioCapability: mocks.capability }));
vi.mock("@/lib/feature-build-data", () => ({
  getFeatureBuilds: mocks.builds, getFeatureBuildById: vi.fn(async () => null), getExecutionEpicRollups: vi.fn(async () => []),
}));
vi.mock("@/lib/backlog-data", () => ({ getPortfoliosForSelect: vi.fn(async () => []) }));
vi.mock("@/lib/build/customer-status-loader", () => ({ loadBuildStudioCustomerStatuses: vi.fn(async () => ({})) }));
vi.mock("@/lib/portal-context", () => ({ resolvePortalContextEnvelope: vi.fn(async () => null) }));
vi.mock("@/lib/govern/permissions", () => ({ can: vi.fn(() => false) }));
vi.mock("@/components/build/EnableRunnerButton", () => ({ EnableRunnerButton: () => null }));
vi.mock("@/components/build/BuildStudio", () => ({ BuildStudio: ({ builds }: { builds: Array<{ title: string }> }) => <div>{builds.map(build => <p key={build.title}>{build.title}</p>)}</div> }));
vi.mock("@/components/build/DecompositionCoordinator", () => ({ DecompositionCoordinator: () => null }));
vi.mock("@/components/i18n/MessagesProvider", () => ({ MessagesProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: vi.fn(async () => ({ language: "en", formatLocale: "en-US" })) }));
vi.mock("@dpf/i18n", () => ({ namespaceMessages: () => ({}) }));
vi.mock("child_process", () => ({ execSync: vi.fn(() => "fixture-branch") }));

import BuildPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner-fixture", platformRole: "admin" } });
  mocks.builds.mockResolvedValue([{ id: "saved-build-fixture", buildId: "FB-SAVED", title: "Retained verification proof" }]);
});

describe("saved Build Studio history without execution capability", () => {
  it.each(["no_active_llm_providers", "only_local_provider_active", "no_strong_tier_model_available"])("keeps saved records readable when capability reports %s", async reason => {
    mocks.capability.mockResolvedValue({ ok: false, reason, enableableRunners: [], suggestedProviders: [], activeProviderNames: [] });
    const html = renderToStaticMarkup(await BuildPage({ searchParams: Promise.resolve({ buildId: "FB-SAVED" }) }));
    expect(mocks.builds).toHaveBeenCalledWith("owner-fixture");
    expect(html).toContain("Retained verification proof");
  });

  it("does not load saved records for an unauthenticated visitor", async () => {
    mocks.auth.mockResolvedValue(null);
    expect(await BuildPage({ searchParams: Promise.resolve({}) })).toBeNull();
    expect(mocks.builds).not.toHaveBeenCalled();
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it("keeps capability observation failure distinct from empty saved history", async () => {
    mocks.capability.mockRejectedValue(new Error("capability unavailable"));
    const html = renderToStaticMarkup(await BuildPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Runner availability could not be checked");
    expect(html).toContain("Retained verification proof");
  });

  it("reports a saved-data load failure without claiming empty history", async () => {
    mocks.capability.mockResolvedValue({ ok: false, reason: "no_active_llm_providers", enableableRunners: [], suggestedProviders: [], activeProviderNames: [] });
    mocks.builds.mockRejectedValue(new Error("saved data unavailable"));
    const html = renderToStaticMarkup(await BuildPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Saved history unavailable.");
    expect(html).not.toContain("No saved builds.");
  });
});

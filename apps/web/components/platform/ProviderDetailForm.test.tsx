// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as testingRender, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { configureProvider, testProviderAuth, discoverModels, profileModels } from "@/lib/actions/ai-providers";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import { ProviderDetailForm } from "./ProviderDetailForm";
const render = (ui: ReactNode) => testingRender(
  <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>{ui}</MessagesProvider>,
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  configureProvider: vi.fn(),
  testProviderAuth: vi.fn(),
  discoverModels: vi.fn(),
  profileModels: vi.fn(),
  toggleProviderStatus: vi.fn(),
}));

vi.mock("@/lib/actions/provider-oauth", () => ({
  startProviderOAuth: vi.fn(),
  disconnectProviderOAuth: vi.fn(),
}));

const providerFixture: ProviderWithCredential = {
  provider: {
    id: "provider-1",
    providerId: "zai",
    name: "Z.ai",
    families: ["glm"],
    enabledFamilies: ["glm"],
    status: "active",
    costModel: "token",
    category: "direct",
    baseUrl: "https://api.z.ai/v1",
    authMethod: "api_key",
    supportedAuthMethods: ["api_key"],
    authHeader: "Authorization",
    endpoint: null,
    inputPricePerMToken: null,
    outputPricePerMToken: null,
    computeWatts: null,
    electricityRateKwh: null,
    docsUrl: null,
    consoleUrl: null,
    billingLabel: null,
    costPerformanceNotes: null,
    endpointType: "model",
    serviceKind: null,
    sensitivityClearance: ["internal"],
    capabilityTier: "adequate",
    costBand: "standard",
    taskTags: [],
    mcpTransport: null,
    maxConcurrency: null,
    authorizeUrl: null,
    tokenUrl: null,
    oauthClientId: null,
    oauthRedirectUri: null,
  },
  credential: {
    providerId: "zai",
    secretHint: "sk-...",
    clientId: null,
    clientSecretHint: null,
    tokenEndpoint: null,
    scope: null,
    status: "ok",
    tokenExpiresAt: null,
    hasRefreshToken: false,
    hasUsableMaterial: true,
  },
};

describe("ProviderDetailForm", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("keeps workspace editing open when clearing an ID to replace it", () => {
    const fixture = { ...providerFixture,
      provider: { ...providerFixture.provider, providerId: "anthropic", name: "Anthropic" },
      credential: { ...providerFixture.credential!, providerWorkspaceId: "wrkspc_accountA" },
    };
    render(<ProviderDetailForm pw={fixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    fireEvent.change(screen.getByLabelText("Anthropic workspace ID"), { target: { value: "" } });
    expect(screen.getByText("Organization-scoped key").closest("details")?.hasAttribute("open")).toBe(true);
  });

  it("saves the Anthropic workspace without requiring the key to be re-entered", async () => {
    vi.mocked(configureProvider).mockResolvedValue({});
    vi.mocked(testProviderAuth).mockResolvedValue({ ok: true, message: "Connected" });
    const fixture = { ...providerFixture, provider: { ...providerFixture.provider, providerId: "anthropic", name: "Anthropic" } };
    render(<ProviderDetailForm pw={fixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    fireEvent.click(screen.getByText("Organization-scoped key"));
    fireEvent.change(screen.getByLabelText("Anthropic workspace ID"), { target: { value: "wrkspc_accountA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & verify connection" }));
    await waitFor(() => expect(configureProvider).toHaveBeenCalledWith(expect.objectContaining({ providerId: "anthropic", providerWorkspaceId: "wrkspc_accountA" })));
    expect(vi.mocked(configureProvider).mock.calls[0][0]).not.toHaveProperty("secretRef");
  });
  it("keeps ChatGPT shared authentication changes in the Codex management page", () => {
    const fixture: ProviderWithCredential = { ...providerFixture, provider: { ...providerFixture.provider, providerId: "chatgpt", authMethod: "oauth2_authorization_code", supportedAuthMethods: ["oauth2_authorization_code"], authorizeUrl: "https://auth.openai.com/oauth/authorize" } };
    render(<ProviderDetailForm pw={fixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    expect(screen.queryByRole("button", { name: /sign in|disconnect/i })).toBeNull();
  });
  it("recovers the ready button after a rejected save", async () => {
    vi.mocked(configureProvider).mockRejectedValue(new Error("network failure"));
    render(<ProviderDetailForm pw={providerFixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    fireEvent.click(screen.getByRole("button", { name: "Save & verify connection" }));
    await waitFor(() => expect(screen.getByText(/Setup failed\. Retry\./)).toBeTruthy());
    // The failure message is set inside the transition; the button label and
    // disabled state only reset once the transition settles, which can be a
    // later render than the one that shows the message.
    const button = await screen.findByRole("button", { name: "Save & verify connection" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(testProviderAuth).not.toHaveBeenCalled();
  });
  it("reuses the catalog prepared by saving and surfaces a failed probe", async () => {
    vi.mocked(configureProvider).mockResolvedValue({});
    vi.mocked(testProviderAuth).mockResolvedValue({ ok: false, message: "HTTP 429" });
    render(<ProviderDetailForm pw={providerFixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    fireEvent.click(screen.getByRole("button", { name: "Save & verify connection" }));
    await waitFor(() => expect(screen.getByText(/HTTP 429/)).toBeTruthy());
    expect(testProviderAuth).toHaveBeenCalledWith("zai", false);
    expect(discoverModels).not.toHaveBeenCalled();
    expect(profileModels).not.toHaveBeenCalled();
    expect(screen.getByText("Failed")).toBeTruthy();
  });
  it("presents one managed readiness action instead of separate setup chores", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={providerFixture}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );

    expect(html).toContain("Connection");
    expect(html).toContain("Workload data-use rules apply.");
    expect(html).toContain("Save &amp; verify connection");
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain("Test &amp; Discover");
    expect(html).not.toContain("Discover &amp; Profile Models");
    expect(html).not.toContain("Advanced: model families");
  });

  it("keeps historical model cards behind disclosure and refreshes without duplicate profiling", async () => {
    const model = { id: "history", providerId: "zai", modelId: "historical-model", rawMetadata: {}, discoveredAt: new Date(), lastSeenAt: new Date() };
    vi.mocked(discoverModels).mockResolvedValue({ discovered: 1, newCount: 0, profiled: 1 });
    render(<ProviderDetailForm pw={providerFixture} canWrite models={[model]} profiles={[]} hasActiveProvider />);
    expect(screen.queryByText("historical-model")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced diagnostics" }));
    expect(screen.getByText("historical-model")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh model diagnostics" }));
    await waitFor(() => expect(screen.getByText("1 model discovered (0 new)")).toBeTruthy());
    expect(profileModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hide diagnostics" }));
    expect(screen.queryByText("historical-model")).toBeNull();
  });

  // BI-2DD7042A: connected/expired must be judged by the tokenExpiresAt
  // timestamp, not the stored status enum. The enum only flips to "expired"
  // when a refresh attempt FAILS — an idle provider's lapsed token kept
  // status="ok", rendered green "Connected", and hid the working sign-in
  // button while the OAuth card above said "Token expired".
  const HOUR = 60 * 60 * 1000;
  const oauthFixture = (tokenExpiresAt: string, hasRefreshToken: boolean): ProviderWithCredential => ({
    provider: {
      ...providerFixture.provider,
      providerId: "anthropic-sub",
      name: "Claude / Anthropic (OAuth Subscription)",
      authMethod: "oauth2_authorization_code",
      supportedAuthMethods: ["oauth2_authorization_code"],
      authorizeUrl: "https://claude.ai/oauth/authorize",
      tokenUrl: "https://platform.claude.com/v1/oauth/token",
      oauthClientId: "client-id",
    },
    credential: {
      ...providerFixture.credential!,
      providerId: "anthropic-sub",
      status: "ok",
      tokenExpiresAt,
      hasRefreshToken,
    },
  });

  it("treats a timestamp-expired token as expired even when the status enum still says ok", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={oauthFixture(new Date(Date.now() - 2 * HOUR).toISOString(), true)}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );
    expect(html).not.toContain("Connected · token expires");
    expect(html).toContain("refreshes automatically on next use");
    // The WORKING sign-in path (startProviderOAuth) must be reachable.
    expect(html).toContain("Sign in with");
  });

  it("shows Connected for a valid unexpired OAuth token", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={oauthFixture(new Date(Date.now() + 24 * HOUR).toISOString(), true)}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );
    expect(html).toContain("Connected · token expires");
  });
});

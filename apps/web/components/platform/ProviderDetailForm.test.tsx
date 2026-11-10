// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render as testingRender, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { configureProvider, testProviderAuth, discoverModels, profileModels } from "@/lib/actions/ai-providers";
import { renderToStaticMarkup as serverRender } from "react-dom/server";

import type { ProviderWithCredential } from "@/lib/ai-provider-types";
import { SOURCE_CATALOG } from "@dpf/i18n";
import { ProviderDetailForm } from "./ProviderDetailForm";
import { probeQuiescence } from "@/components/auth/UpgradeHold";
import { startProviderOAuth, disconnectProviderOAuth } from "@/lib/actions/provider-oauth";
const render = (ui: ReactNode) => testingRender(
  <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>{ui}</MessagesProvider>,
);
const renderToStaticMarkup = (ui: ReactNode) => serverRender(
  <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>{ui}</MessagesProvider>,
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/auth/UpgradeHold", () => ({ probeQuiescence: vi.fn().mockResolvedValue({ level: "normal", runId: null }) }));

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
  it.each([true, false])("keeps server-owned recipes with the existing Models and execution disclosure (write=%s)", canWrite => {
    render(<ProviderDetailForm pw={providerFixture} canWrite={canWrite} models={[]} profiles={[]} hasActiveProvider
      executionRecipes={<p>Execution recipes · 29</p>} />);
    const toggle = screen.getByRole("button", { name: "Models and execution" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Execution recipes · 29")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Execution recipes · 29")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText("Execution recipes · 29")).toBeNull();
    expect(configureProvider).not.toHaveBeenCalled();
    expect(discoverModels).not.toHaveBeenCalled();
  });
  it("preserves exact-account recovery when default ChatGPT shared ownership is unproven", async () => {
    const fixture: ProviderWithCredential = { ...providerFixture, provider: { ...providerFixture.provider, providerId: "chatgpt", name: "ChatGPT", authMethod: "oauth2_authorization_code", supportedAuthMethods: ["oauth2_authorization_code"] }, credential: { ...providerFixture.credential!, status: "ok", tokenExpiresAt: new Date(Date.now() + 3600000).toISOString() } };
    vi.mocked(startProviderOAuth).mockResolvedValue({ error: "Fixture sign-in result" });
    render(<ProviderDetailForm pw={fixture} canWrite models={[]} profiles={[]} hasActiveProvider defaultConnectionId="provider-default-chatgpt" />);
    expect(screen.queryByRole("link", { name: "Manage shared sign-in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(startProviderOAuth).toHaveBeenCalledWith("chatgpt", "provider-default-chatgpt"));
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });
  it("keeps OAuth mutations disabled for a read-only viewer while retaining diagnostics", () => {
    const fixture: ProviderWithCredential = { ...providerFixture, provider: { ...providerFixture.provider, providerId: "codex", authMethod: "oauth2_authorization_code", supportedAuthMethods: ["oauth2_authorization_code"] } };
    render(<ProviderDetailForm pw={fixture} canWrite={false} models={[]} profiles={[]} hasActiveProvider />);
    expect((screen.getByRole("button", { name: "Sign in with Z.ai" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Models and execution" }) as HTMLButtonElement).disabled).toBe(false);
  });

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
    render(<ProviderDetailForm pw={fixture} canWrite models={[]} profiles={[]} hasActiveProvider sharedAuthRecovery={{ help: SOURCE_CATALOG.providerAccounts.sharedSignInHelp, label: SOURCE_CATALOG.providerAccounts.manageSharedSignIn }} />);
    expect(screen.queryByRole("button", { name: /sign in|disconnect/i })).toBeNull();
    expect(screen.getByRole("link", { name: "Manage shared sign-in" }).getAttribute("href")).toBe("/platform/ai/providers/codex");
  });
  it("recovers the ready button after a rejected save", async () => {
    vi.mocked(configureProvider).mockRejectedValue(new Error("network failure"));
    render(<ProviderDetailForm pw={providerFixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    fireEvent.click(screen.getByRole("button", { name: "Save & verify connection" }));
    await waitFor(() => expect(screen.getByText(/Reload this page/)).toBeTruthy());
    // The failure message is set inside the transition; the button label and
    // disabled state only reset once the transition settles, which can be a
    // later render than the one that shows the message.
    const button = await screen.findByRole("button", { name: "Save & verify connection" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(testProviderAuth).not.toHaveBeenCalled();
  });
  it("explains an upgrade refusal rather than asking the operator to retry a paused setup", async () => {
    vi.mocked(configureProvider).mockRejectedValue(new Error("Unexpected server response"));
    vi.mocked(probeQuiescence).mockResolvedValueOnce({ level: "draining", runId: "QR-test" });
    render(<ProviderDetailForm pw={providerFixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    fireEvent.click(screen.getByRole("button", { name: "Save & verify connection" }));
    await waitFor(() => expect(screen.getByText(/Connection setup is paused/)).toBeTruthy());
    expect(screen.queryByText(/Setup failed/)).toBeNull();
    expect(testProviderAuth).not.toHaveBeenCalled();
  });
  it("offers non-destructive reconnect for a saved OAuth token whose date has not expired", async () => {
    vi.mocked(startProviderOAuth).mockResolvedValueOnce({ error: "Sign-in unavailable" });
    const fixture: ProviderWithCredential = { ...providerFixture,
      provider: { ...providerFixture.provider, providerId: "codex", authMethod: "oauth2_authorization_code", supportedAuthMethods: ["oauth2_authorization_code"] },
      credential: { ...providerFixture.credential!, tokenExpiresAt: "2099-01-01T00:00:00Z" },
    };
    render(<ProviderDetailForm pw={fixture} canWrite models={[]} profiles={[]} hasActiveProvider />);
    expect(screen.queryByText(/Connected · token expires/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(startProviderOAuth).toHaveBeenCalledWith("codex"));
    expect(disconnectProviderOAuth).not.toHaveBeenCalled();
    expect(await screen.findByText(/Sign-in unavailable/)).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Models and execution" }));
    expect(screen.getByText("historical-model")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh model diagnostics" }));
    await waitFor(() => expect(screen.getByText("1 model discovered (0 new)")).toBeTruthy());
    expect(profileModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Models and execution" }));
    expect(screen.queryByText("historical-model")).toBeNull();
  });

  // BI-2DD7042A: connected/expired must be judged by the tokenExpiresAt
  // timestamp, not the stored status enum. The enum only flips to "expired"
  // when a refresh attempt FAILS — an idle provider's lapsed token kept
  // status="ok", rendered green "Connected", and hid the working sign-in
  // button while the OAuth card above said "Token expired".
  const HOUR = 60 * 60 * 1000;
  const subscriptionStatusFixture = (tokenExpiresAt: string, hasRefreshToken: boolean): ProviderWithCredential => ({
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
        pw={subscriptionStatusFixture(new Date(Date.now() - 2 * HOUR).toISOString(), true)}
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

  it("shows saved sign-in and reconnect for an unexpired OAuth token", () => {
    const html = renderToStaticMarkup(
      <ProviderDetailForm
        pw={subscriptionStatusFixture(new Date(Date.now() + 24 * HOUR).toISOString(), true)}
        canWrite={true}
        models={[]}
        profiles={[]}
        hasActiveProvider={true}
      />,
    );
    expect(html).toContain("Sign-in saved · token expires");
    expect(html).toContain("Sign in again");
  });
});

// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/i18n/locale-context.server", () => ({ getLocaleContext: async () => ({ language: "en-US" }) }));
vi.mock("@/lib/actions/platform-dev-config", () => ({
  getPlatformDevConfig: async () => null,
  getUntrackedFeatureCount: async () => 0,
  hasGitBackupCredential: async () => false,
  hasContributionToken: async () => false,
  listPrivatePathRules: async () => [],
  getGitHubConnectedState: async () => null,
}));
vi.mock("@/lib/build/identity-privacy", () => ({ getDisplayPseudonym: async () => null }));
vi.mock("@/lib/build/build-studio-config", () => ({ getAutonomousPlaybookMode: () => "off" }));
vi.mock("@/lib/flags/contribution-model", () => ({ isContributionModelEnabled: () => false }));
vi.mock("@/lib/backlog/acceptance-sweep/close-authorisation-view", () => ({ loadCloseAuthorisationView: vi.fn() }));
vi.mock("@/lib/work-management/author-stage-preauthorisation-view", () => ({
  loadAuthorStagePreauthorisationView: vi.fn(), mayManageAuthorStagePreauthorisation: vi.fn(),
}));
vi.mock("@/components/admin/AcceptanceSweepCloseAuthorisationCard", () => ({ AcceptanceSweepCloseAuthorisationCard: () => null }));
vi.mock("@/components/admin/AuthorStagePreauthorisationCard", () => ({ AuthorStagePreauthorisationCard: () => null }));
vi.mock("@/components/admin/AdminTabNav", () => ({ AdminTabNav: () => null }));
vi.mock("@/components/admin/ForkSetupPanel", () => ({ ForkSetupPanel: () => null }));
vi.mock("@/components/admin/LegacyTokenOverrideBanner", () => ({ default: () => null }));
vi.mock("@/components/admin/TokenExpiryBanner", () => ({ default: () => null }));
vi.mock("@/components/admin/GovernedBacklogSettings", () => ({ GovernedBacklogSettings: () => null }));
vi.mock("@/components/admin/PlatformDevelopmentForm", () => ({ PlatformDevelopmentForm: () => null }));
vi.mock("@/components/admin/PrivatePathsEditor", () => ({ PrivatePathsEditor: () => null }));
vi.mock("@/components/admin/McpTokenManager", () => ({ McpTokenManager: () => null }));
vi.mock("@/lib/actions/oauth-clients", () => ({
  listOAuthClients: async () => ({ ok: true, data: [] }),
  listOAuthCredentialsAssistants: async () => ({ ok: true, data: [{ agentId: "AGT-EXT-CODEX", displayName: "Codex" }] }),
  createOAuthCredentialsClient: vi.fn(),
  revokeOAuthClient: vi.fn(),
  listAccountAgentAccessAction: vi.fn(async () => ({ ok: false, error: "No account matches admin@dpf.local." })),
  endAccountAgentAccessAction: vi.fn(),
}));

afterEach(cleanup);

it("keeps client setup messages available through the page's local admin provider", async () => {
  const { default: Page } = await import("./page");
  render(
    <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>
      {await Page()}
    </MessagesProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add a client" }));
  await screen.findByRole("option", { name: "Codex" });
  const assistant = screen.getByRole("combobox", { name: "Acts as assistant" });
  expect(screen.getByRole("option", { name: "Your account only" })).toBeTruthy();
  fireEvent.change(assistant, { target: { value: "AGT-EXT-CODEX" } });
  expect(screen.getByText("Current assistant permissions still apply.")).toBeTruthy();
  expect(screen.queryByText(/setup\.sourceCredentials\./)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // BI-DB506554: with no account named, the agent access panel stays closed on arrival.
  expect(screen.getByText("Agent access for one account", { selector: "summary" }).closest("details")?.open).toBe(false);
  expect(screen.queryByRole("form", { name: "Add a client" })).toBeNull();
});

// BI-DB506554: the handover plan links ?account=<email>#agent-access.
it("opens the agent access panel on the account a link names", async () => {
  const { default: Page } = await import("./page");
  render(
    <MessagesProvider locale="en-US" messages={{ setup: namespaceMessages("en-US", "setup") }}>
      {await Page({ searchParams: Promise.resolve({ account: "admin@dpf.local" }) })}
    </MessagesProvider>,
  );
  const panel = screen.getByText("Agent access for one account", { selector: "summary" }).closest("details");
  expect(panel?.open).toBe(true);
  expect(panel?.closest("#agent-access")).toBeTruthy();
  expect((screen.getByLabelText(/Account email/) as HTMLInputElement).value).toBe("admin@dpf.local");
  expect(await screen.findByText("No account matches admin@dpf.local.")).toBeTruthy();
});

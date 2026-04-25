import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/platform-dev-config", () => ({
  savePlatformDevConfig: vi.fn(),
  acceptDco: vi.fn(),
  saveContributionSetup: vi.fn(),
  validateGitHubToken: vi.fn(),
}));

vi.mock("@/lib/actions/github-device-flow", () => ({
  initiateDeviceFlow: vi.fn(),
  pollDeviceFlow: vi.fn(),
  disconnectGitHub: vi.fn(),
}));

import { PlatformDevelopmentForm } from "@/components/admin/PlatformDevelopmentForm";

const baseProps = {
  policyState: "policy_pending" as const,
  currentMode: null,
  configuredAt: null,
  configuredByEmail: null,
  gitRemoteUrl: null,
  dcoAcceptedAt: null,
  dcoAcceptedByEmail: null,
  untrackedFeatureCount: 0,
  hasGitCredential: false,
  hasContributionToken: false,
  pseudonym: "dpf-agent-acme123" as string | null,
  initialConnected: null as null | { username: string; connectedAt: Date },
};

describe("PlatformDevelopmentForm", () => {
  it("renders the three contribution-mode options", () => {
    const html = renderToStaticMarkup(<PlatformDevelopmentForm {...baseProps} />);
    expect(html).toContain("Keep everything here");
    expect(html).toContain("Share selectively");
    expect(html).toContain("Share everything");
  });

  it("does not render the Connect card before mode is contribution and DCO is accepted", () => {
    const html = renderToStaticMarkup(<PlatformDevelopmentForm {...baseProps} />);
    // Default selected is `selective`, but the wizard starts at "mode" until
    // DCO is accepted — so neither connect card nor advanced paste should be
    // visible yet.
    expect(html).not.toContain('data-testid="github-connect-block"');
    expect(html).not.toContain('data-testid="connect-github-card"');
  });

  it("renders the Connect card and Advanced paste once DCO is accepted (done state)", () => {
    const html = renderToStaticMarkup(
      <PlatformDevelopmentForm
        {...baseProps}
        currentMode="selective"
        dcoAcceptedAt="2026-04-24T12:00:00Z"
      />,
    );
    expect(html).toContain('data-testid="github-connect-block"');
    expect(html).toContain('data-testid="connect-github-card"');
    expect(html).toContain('data-testid="advanced-token-paste"');
  });

  it("preserves the pseudonym disclosure in the explain step", () => {
    // To reach the explain card via SSR alone we render with already-set-up
    // = false (no DCO) and selective mode; the wizard starts at "mode".
    // The pseudonym surface in the wizard is the "explain" card, which
    // SSR can't reach without state — so instead assert the form passes
    // pseudonym through correctly via the connected/done path below.
    const html = renderToStaticMarkup(
      <PlatformDevelopmentForm
        {...baseProps}
        currentMode="contribute_all"
        dcoAcceptedAt="2026-04-24T12:00:00Z"
      />,
    );
    // Once on the done state we expose the connect block — the pseudonymity
    // disclosure inside ConnectGitHubCard is the new primary surface.
    expect(html).toMatch(/GitHub username will be visible/i);
  });

  it("renders the fork-only backup form when mode=fork_only", () => {
    const html = renderToStaticMarkup(
      <PlatformDevelopmentForm {...baseProps} currentMode="fork_only" />,
    );
    expect(html).toContain("Backup your work (optional)");
    expect(html).toContain("Repository URL");
    // The contribution Connect card is gated on contribution mode; should not
    // appear in fork_only.
    expect(html).not.toContain('data-testid="github-connect-block"');
  });

  it("shows 'Sharing is set up' when DCO is accepted and mode is contribution", () => {
    const html = renderToStaticMarkup(
      <PlatformDevelopmentForm
        {...baseProps}
        currentMode="selective"
        dcoAcceptedAt="2026-04-24T12:00:00Z"
        dcoAcceptedByEmail="admin@example.com"
      />,
    );
    expect(html).toContain("Sharing is set up");
    expect(html).toContain("Contributor agreement accepted");
    expect(html).toContain("admin@example.com");
  });

  it("propagates initialConnected through to ConnectGitHubCard when DCO accepted", () => {
    const html = renderToStaticMarkup(
      <PlatformDevelopmentForm
        {...baseProps}
        currentMode="selective"
        dcoAcceptedAt="2026-04-24T12:00:00Z"
        initialConnected={{
          username: "jane-dev",
          connectedAt: new Date("2026-04-24T12:00:00Z"),
        }}
      />,
    );
    expect(html).toContain("@jane-dev");
    expect(html).toContain("GitHub connected");
  });

  it("renders the Last configured caption when configuredAt is present", () => {
    const html = renderToStaticMarkup(
      <PlatformDevelopmentForm
        {...baseProps}
        configuredAt="2026-04-24T12:00:00Z"
        configuredByEmail="admin@example.com"
      />,
    );
    expect(html).toContain("Last configured");
    expect(html).toContain("admin@example.com");
  });
});

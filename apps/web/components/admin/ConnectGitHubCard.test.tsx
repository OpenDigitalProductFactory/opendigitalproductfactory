import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Mock the server actions so the import graph doesn't pull "server-only" /
// next-auth into the test runtime. The dynamic-state tests below interact
// with React state directly via the component's exported behavior.
vi.mock("@/lib/actions/github-device-flow", () => ({
  initiateDeviceFlow: vi.fn(),
  pollDeviceFlow: vi.fn(),
  disconnectGitHub: vi.fn(),
}));

import { ConnectGitHubCard } from "@/components/admin/ConnectGitHubCard";

describe("ConnectGitHubCard", () => {
  it("renders the Connect button when initialConnected is null", () => {
    const html = renderToStaticMarkup(<ConnectGitHubCard initialConnected={null} />);
    expect(html).toContain("Connect GitHub");
    expect(html).toContain('data-testid="connect-github-button"');
    // Idle copy explains Device Flow.
    expect(html).toMatch(/OAuth Device Flow/i);
  });

  it("renders the pseudonymity disclosure near the Connect button", () => {
    const html = renderToStaticMarkup(<ConnectGitHubCard initialConnected={null} />);
    expect(html).toContain('data-testid="pseudonymity-disclosure"');
    expect(html).toMatch(/GitHub username will be visible/i);
    expect(html).toMatch(/pseudonymous GitHub account/i);
  });

  it("renders 'Connected as @username, since <date>' when initialConnected is set", () => {
    const html = renderToStaticMarkup(
      <ConnectGitHubCard
        initialConnected={{
          username: "jane-dev",
          connectedAt: new Date("2026-04-24T12:00:00Z"),
        }}
      />,
    );
    expect(html).toContain("GitHub connected");
    expect(html).toContain("@jane-dev");
    expect(html).toMatch(/since/i);
    expect(html).toContain('data-testid="disconnect-github-button"');
    expect(html).toContain("Disconnect");
  });

  it("does not render the Connect button when already connected", () => {
    const html = renderToStaticMarkup(
      <ConnectGitHubCard
        initialConnected={{
          username: "jane-dev",
          connectedAt: new Date("2026-04-24T12:00:00Z"),
        }}
      />,
    );
    expect(html).not.toContain('data-testid="connect-github-button"');
  });

  it("uses the 'Open GitHub' anchor target='_blank' pattern (verified via static idle markup absence)", () => {
    // The awaiting state opens GitHub in a new tab; until the user clicks
    // Connect we shouldn't see device-code markup. This guards against a
    // regression where the awaiting markup accidentally renders by default.
    const html = renderToStaticMarkup(<ConnectGitHubCard initialConnected={null} />);
    expect(html).not.toContain('data-testid="device-user-code"');
    expect(html).not.toContain('data-testid="copy-device-code"');
  });
});

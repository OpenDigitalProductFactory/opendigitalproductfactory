// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-dev-config", () => ({
  configureForkSetup: vi.fn(),
}));

import { ForkSetupPanel } from "@/components/admin/ForkSetupPanel";

async function renderClient(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  const html = container.innerHTML;

  await act(async () => {
    root.unmount();
  });

  container.remove();
  return html;
}

describe("ForkSetupPanel", () => {
  const baseProps = {
    enabled: true,
    contributionModel: null as string | null,
    contributorForkOwner: null as string | null,
    contributorForkRepo: null as string | null,
    hasContributionToken: true,
  };

  it("renders nothing when the feature flag is off", () => {
    const html = renderClient(
      <ForkSetupPanel {...baseProps} enabled={false} />,
    );
    return expect(html).resolves.toBe("");
  });

  it("renders nothing when there is no contribution token yet", () => {
    const html = renderClient(
      <ForkSetupPanel {...baseProps} hasContributionToken={false} />,
    );
    return expect(html).resolves.toBe("");
  });

  it("renders nothing once contributionModel is already configured", () => {
    const html = renderClient(
      <ForkSetupPanel {...baseProps} contributionModel="fork-pr" />,
    );
    return expect(html).resolves.toBe("");
  });

  it("renders the setup panel when flag is on, token exists, and model is null", async () => {
    const html = await renderClient(<ForkSetupPanel {...baseProps} />);
    expect(html).toContain("Configure fork-based contribution");
    expect(html).toContain("Your GitHub username");
    expect(html).toContain("public_repo scope");
  });

  it("shows the pseudonymity tradeoff copy", async () => {
    const html = await renderClient(<ForkSetupPanel {...baseProps} />);
    expect(html).toMatch(/GitHub username will be visible/i);
  });

  it("pre-fills username from a previously-configured fork owner", async () => {
    const html = await renderClient(
      <ForkSetupPanel {...baseProps} contributorForkOwner="jane-dev" contributorForkRepo="opendigitalproductfactory" />,
    );
    expect(html).toContain('value="jane-dev"');
  });

  it("shows the 'Fork verified' ready state when fork metadata is already stored", async () => {
    const html = await renderClient(
      <ForkSetupPanel
        {...baseProps}
        contributorForkOwner="jane-dev"
        contributorForkRepo="opendigitalproductfactory"
      />,
    );
    expect(html).toMatch(/Fork verified: jane-dev\/opendigitalproductfactory/);
  });
});

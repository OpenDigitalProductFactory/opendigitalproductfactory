import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/platform-dev-config", () => ({
  configureForkSetup: vi.fn(),
}));

import { ForkSetupPanel } from "@/components/admin/ForkSetupPanel";

describe("ForkSetupPanel", () => {
  const baseProps = {
    enabled: true,
    contributionModel: null as string | null,
    contributorForkOwner: null as string | null,
    contributorForkRepo: null as string | null,
    hasContributionToken: true,
  };

  it("renders nothing when the feature flag is off", () => {
    const html = renderToStaticMarkup(
      <ForkSetupPanel {...baseProps} enabled={false} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when there is no contribution token yet", () => {
    const html = renderToStaticMarkup(
      <ForkSetupPanel {...baseProps} hasContributionToken={false} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing once contributionModel is already configured", () => {
    const html = renderToStaticMarkup(
      <ForkSetupPanel {...baseProps} contributionModel="fork-pr" />,
    );
    expect(html).toBe("");
  });

  it("renders the setup panel when flag is on, token exists, and model is null", () => {
    const html = renderToStaticMarkup(<ForkSetupPanel {...baseProps} />);
    expect(html).toContain("Configure fork-based contribution");
    expect(html).toContain("Your GitHub username");
    expect(html).toContain("`public_repo` scope");
  });

  it("shows the pseudonymity tradeoff copy", () => {
    const html = renderToStaticMarkup(<ForkSetupPanel {...baseProps} />);
    expect(html).toMatch(/GitHub username will be visible/i);
  });

  it("pre-fills username from a previously-configured fork owner", () => {
    const html = renderToStaticMarkup(
      <ForkSetupPanel {...baseProps} contributorForkOwner="jane-dev" contributorForkRepo="opendigitalproductfactory" />,
    );
    expect(html).toContain('value="jane-dev"');
  });

  it("shows the 'Fork verified' ready state when fork metadata is already stored", () => {
    const html = renderToStaticMarkup(
      <ForkSetupPanel
        {...baseProps}
        contributorForkOwner="jane-dev"
        contributorForkRepo="opendigitalproductfactory"
      />,
    );
    expect(html).toMatch(/Fork verified: jane-dev\/opendigitalproductfactory/);
  });
});

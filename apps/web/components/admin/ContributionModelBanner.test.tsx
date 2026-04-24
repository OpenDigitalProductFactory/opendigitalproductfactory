import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ContributionModelBanner } from "@/components/admin/ContributionModelBanner";
import { CONTRIBUTION_COPY } from "@/lib/integrate/contribution-copy";

describe("ContributionModelBanner", () => {
  const baseProps = {
    enabled: true,
    contributionMode: "selective" as string | null,
    contributionModel: null as string | null,
  };

  it("renders nothing when the feature flag is off", () => {
    const html = renderToStaticMarkup(
      <ContributionModelBanner {...baseProps} enabled={false} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing for fork_only installs (no push, no model relevance)", () => {
    const html = renderToStaticMarkup(
      <ContributionModelBanner {...baseProps} contributionMode="fork_only" />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when contributionMode is null (onboarding not done yet)", () => {
    const html = renderToStaticMarkup(
      <ContributionModelBanner {...baseProps} contributionMode={null} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when contributionModel is already set", () => {
    const html = renderToStaticMarkup(
      <ContributionModelBanner {...baseProps} contributionModel="fork-pr" />,
    );
    expect(html).toBe("");
  });

  it("renders the banner for selective + null model when flag is on", () => {
    const html = renderToStaticMarkup(<ContributionModelBanner {...baseProps} />);
    expect(html).toContain("Contribution model needs configuration");
    expect(html).toContain(CONTRIBUTION_COPY.banner.needsConfiguration);
    expect(html).toContain(CONTRIBUTION_COPY.banner.openSetupLinkLabel);
  });

  it("renders the banner for contribute_all + null model when flag is on", () => {
    const html = renderToStaticMarkup(
      <ContributionModelBanner {...baseProps} contributionMode="contribute_all" />,
    );
    expect(html).toContain("Contribution model needs configuration");
  });

  it("CTA link points to the in-page setup anchor", () => {
    const html = renderToStaticMarkup(<ContributionModelBanner {...baseProps} />);
    expect(html).toContain('href="#contribution-setup"');
  });
});

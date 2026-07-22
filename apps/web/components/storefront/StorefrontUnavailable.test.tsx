// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { StorefrontUnavailable } from "./StorefrontUnavailable";

describe("StorefrontUnavailable", () => {
  it("recovers the customer back into their storefront, never the workspace/docs", () => {
    const html = renderToStaticMarkup(
      <StorefrontUnavailable orgSlug="copper-kettle" orgName="The Copper Kettle" message="Not set up." />,
    );
    expect(html).toContain("/s/copper-kettle");
    expect(html).toContain("/s/copper-kettle/inquire");
    expect(html).toContain("Back to The Copper Kettle");
    expect(html).not.toContain("/workspace");
    expect(html).not.toContain("/docs");
  });

  it("renders the supplied title and message", () => {
    const html = renderToStaticMarkup(
      <StorefrontUnavailable orgSlug="s" title="Donations aren't set up here" message="Send us a message instead." />,
    );
    expect(html).toContain("Donations aren&#x27;t set up here");
    expect(html).toContain("Send us a message instead.");
  });
});

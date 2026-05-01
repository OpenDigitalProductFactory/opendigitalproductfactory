import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PortfolioNodeAbout } from "./PortfolioNodeAbout";

describe("PortfolioNodeAbout", () => {
  it("returns null when about is null", () => {
    expect(renderToStaticMarkup(<PortfolioNodeAbout about={null} />)).toBe("");
  });

  it("renders the description text in a populated state", () => {
    const html = renderToStaticMarkup(
      <PortfolioNodeAbout about="Compute servers running production workloads." />,
    );
    expect(html).toContain("Compute servers running production workloads.");
    expect(html).toContain(">About<");
  });

  it("uses theme tokens (no raw white/black/gray classes)", () => {
    const html = renderToStaticMarkup(<PortfolioNodeAbout about="Hello." />);
    expect(html).not.toMatch(/text-white|text-black|text-gray-|bg-white|bg-black|bg-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});

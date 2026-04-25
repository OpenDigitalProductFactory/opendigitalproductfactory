import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/platform-dev-config", () => ({
  saveContributionSetup: vi.fn(),
}));

import { AdvancedTokenPaste } from "@/components/admin/AdvancedTokenPaste";

describe("AdvancedTokenPaste", () => {
  it("renders the disclosure as a <details> element (collapsed by default)", () => {
    const html = renderToStaticMarkup(<AdvancedTokenPaste mode="selective" />);
    // <details> without `open` attribute is collapsed by default in browsers.
    expect(html).toMatch(/^<details[^>]*>/);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain("Advanced: paste a token");
  });

  it("renders the fine-grained PAT section with help copy and an input", () => {
    const html = renderToStaticMarkup(<AdvancedTokenPaste mode="selective" />);
    expect(html).toContain('data-testid="fine-grained-pat-section"');
    expect(html).toMatch(/Fine-grained PAT \(advanced\)/);
    expect(html).toMatch(/fine-grained PAT at github\.com\/settings\/personal-access-tokens/i);
    expect(html).toMatch(/Contents: read and write/);
    expect(html).toContain('data-testid="fine-grained-pat-input"');
    expect(html).toContain('data-testid="fine-grained-pat-submit"');
  });

  it("renders the classic PAT section with the no-expiry warning", () => {
    const html = renderToStaticMarkup(<AdvancedTokenPaste mode="contribute_all" />);
    expect(html).toContain('data-testid="classic-pat-section"');
    expect(html).toMatch(/Classic PAT \(emergency\)/);
    expect(html).toMatch(/Classic PATs have no expiry/i);
    expect(html).toMatch(/Prefer Device Flow or fine-grained PATs/i);
    expect(html).toContain('data-testid="classic-pat-input"');
    expect(html).toContain('data-testid="classic-pat-submit"');
  });

  it("renders both sections regardless of mode prop", () => {
    const fork = renderToStaticMarkup(<AdvancedTokenPaste mode="selective" />);
    const all = renderToStaticMarkup(<AdvancedTokenPaste mode="contribute_all" />);
    expect(fork).toContain('data-testid="fine-grained-pat-section"');
    expect(fork).toContain('data-testid="classic-pat-section"');
    expect(all).toContain('data-testid="fine-grained-pat-section"');
    expect(all).toContain('data-testid="classic-pat-section"');
  });

  it("uses distinct placeholder formats for each token tier", () => {
    const html = renderToStaticMarkup(<AdvancedTokenPaste mode="selective" />);
    // Fine-grained PATs use the github_pat_ prefix; classic PATs use ghp_.
    expect(html).toMatch(/placeholder="github_pat_/);
    expect(html).toMatch(/placeholder="ghp_/);
  });
});

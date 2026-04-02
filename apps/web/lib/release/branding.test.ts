import { describe, expect, it } from "vitest";
import { normalizeLogoUrl, resolveBrandingLogoUrl, buildBrandingStyleTag } from "./branding";

describe("normalizeLogoUrl", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(normalizeLogoUrl(null)).toBe("");
    expect(normalizeLogoUrl(undefined)).toBe("");
    expect(normalizeLogoUrl("")).toBe("");
    expect(normalizeLogoUrl("   ")).toBe("");
  });

  it("passes through absolute HTTPS URLs", () => {
    expect(normalizeLogoUrl("https://example.com/logo.svg")).toBe("https://example.com/logo.svg");
  });

  it("passes through app-local paths starting with /", () => {
    expect(normalizeLogoUrl("/logos/company.svg")).toBe("/logos/company.svg");
  });

  it("passes through data URLs", () => {
    const dataUrl = "data:image/svg+xml;base64,PHN2Zz4=";
    expect(normalizeLogoUrl(dataUrl)).toBe(dataUrl);
  });

  it("trims whitespace", () => {
    expect(normalizeLogoUrl("  https://example.com/logo.svg  ")).toBe("https://example.com/logo.svg");
  });
});

describe("resolveBrandingLogoUrl", () => {
  it("returns empty string for null/undefined/empty", () => {
    expect(resolveBrandingLogoUrl(null, "Acme")).toBe("");
    expect(resolveBrandingLogoUrl(undefined, "Acme")).toBe("");
    expect(resolveBrandingLogoUrl("", "Acme")).toBe("");
  });

  it("passes through valid URLs unchanged", () => {
    expect(resolveBrandingLogoUrl("https://example.com/logo.svg", "Acme")).toBe("https://example.com/logo.svg");
    expect(resolveBrandingLogoUrl("/logos/foo.svg", "Acme")).toBe("/logos/foo.svg");
  });

  it("passes through data URLs", () => {
    const dataUrl = "data:image/png;base64,iVBOR";
    expect(resolveBrandingLogoUrl(dataUrl, "Acme")).toBe(dataUrl);
  });
});

describe("buildBrandingStyleTag", () => {
  it("returns empty string when tokens is null", () => {
    expect(buildBrandingStyleTag(null)).toBe("");
  });

  it("returns empty string when tokens is empty object", () => {
    expect(buildBrandingStyleTag({})).toBe("");
  });

  it("maps palette tokens to CSS variables", () => {
    const tokens = {
      palette: { bg: "#111111", accent: "#ff0000" },
    };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toContain("--dpf-bg: #111111");
    expect(css).toContain("--dpf-accent: #ff0000");
  });

  it("maps typography tokens to CSS variables", () => {
    const tokens = {
      typography: { fontFamily: "Roboto", headingFontFamily: "Montserrat" },
    };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toContain("--dpf-font-body: Roboto");
    expect(css).toContain("--dpf-font-heading: Montserrat");
  });

  it("only maps the 9 active CSS variables", () => {
    const tokens = {
      palette: { bg: "#111", surface1: "#222", surface2: "#333", accent: "#444", muted: "#555", border: "#666", text: "#e2e2f0" },
      typography: { fontFamily: "Inter", headingFontFamily: "Inter" },
      surfaces: { page: "#aaa" },
      states: { idle: "#bbb" },
    };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toContain("--dpf-bg:");
    expect(css).toContain("--dpf-surface-1:");
    expect(css).toContain("--dpf-surface-2:");
    expect(css).toContain("--dpf-text:");
    expect(css).toContain("--dpf-accent:");
    expect(css).toContain("--dpf-muted:");
    expect(css).toContain("--dpf-border:");
    expect(css).toContain("--dpf-font-body:");
    expect(css).toContain("--dpf-font-heading:");
    expect(css).not.toContain("surfaces");
    expect(css).not.toContain("states");
  });

  it("wraps in :root selector", () => {
    const tokens = { palette: { accent: "#ff0000" } };
    const css = buildBrandingStyleTag(tokens);
    expect(css).toMatch(/^:root\s*\{/);
    expect(css).toMatch(/\}$/);
  });
});

describe("buildBrandingStyleTag (dual tokens)", () => {
  const dualTokens = {
    dark: {
      palette: { bg: "#0f0f1a", surface1: "#1a1a2e", surface2: "#161625", accent: "#7c8cf8", muted: "#8888a0", border: "#2a2a40", text: "#e2e2f0" },
      typography: { fontFamily: "Inter", headingFontFamily: "Inter" },
    },
    light: {
      palette: { bg: "#fafafa", surface1: "#ffffff", surface2: "#f4f4f6", accent: "#2563eb", muted: "#6b7280", border: "#d4d4dc", text: "#1a1a2e" },
      typography: { fontFamily: "Inter", headingFontFamily: "Inter" },
    },
  };

  it("emits light tokens in :root", () => {
    const css = buildBrandingStyleTag(dualTokens);
    const rootMatch = css.match(/^:root\s*\{([^}]+)\}/);
    expect(rootMatch).toBeTruthy();
    expect(rootMatch![1]).toContain("--dpf-bg: #fafafa");
    expect(rootMatch![1]).toContain("--dpf-text: #1a1a2e");
  });

  it("emits dark tokens inside @media (prefers-color-scheme: dark)", () => {
    const css = buildBrandingStyleTag(dualTokens);
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain("--dpf-bg: #0f0f1a");
    expect(css).toContain("--dpf-text: #e2e2f0");
  });

  it("includes --dpf-text variable", () => {
    const css = buildBrandingStyleTag(dualTokens);
    expect(css).toContain("--dpf-text:");
  });

  it("falls back gracefully with flat (legacy) tokens", () => {
    const flatTokens = {
      palette: { bg: "#0f0f1a", accent: "#7c8cf8", text: "#e2e2f0" },
      typography: { fontFamily: "Inter" },
    };
    const css = buildBrandingStyleTag(flatTokens);
    expect(css).toContain(":root");
    expect(css).toContain("--dpf-bg: #0f0f1a");
  });
});

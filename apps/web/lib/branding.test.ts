import { describe, expect, it } from "vitest";
import { normalizeLogoUrl, resolveBrandingLogoUrl } from "./branding";

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

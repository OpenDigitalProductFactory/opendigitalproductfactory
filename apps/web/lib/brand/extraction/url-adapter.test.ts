import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchPublicWebsiteEvidence: vi.fn(),
  analyzePublicWebsiteBranding: vi.fn(),
}));

vi.mock("@/lib/public-web-tools", () => ({
  fetchPublicWebsiteEvidence: mocks.fetchPublicWebsiteEvidence,
  analyzePublicWebsiteBranding: mocks.analyzePublicWebsiteBranding,
}));

import { urlAdapter } from "./url-adapter";

describe("urlAdapter", () => {
  beforeEach(() => {
    mocks.fetchPublicWebsiteEvidence.mockReset();
    mocks.analyzePublicWebsiteBranding.mockReset();
  });

  it("extracts identity, primary color, and logo from a valid URL", async () => {
    mocks.fetchPublicWebsiteEvidence.mockResolvedValue({
      url: "https://example.com",
      finalUrl: "https://example.com",
      title: "Acme Corp",
      description: "We make widgets",
      textExcerpt: "Acme sells widgets.",
      themeColor: "#336699",
      logoCandidates: ["https://example.com/logo.png"],
      colorCandidates: ["#336699", "#cc3300"],
      contactEmailCandidates: [],
      contactPhoneCandidates: [],
    });
    mocks.analyzePublicWebsiteBranding.mockReturnValue({
      companyName: "Acme Corp",
      logoUrl: "https://example.com/logo.png",
      paletteAccent: "#336699",
      notes: [],
      suggestedArchetypeId: null,
      suggestedArchetypeName: null,
      archetypeConfidence: null,
      suggestedCountryCode: null,
      suggestedCurrency: null,
      suggestedDescription: "We make widgets",
      suggestedContactEmail: null,
      suggestedContactPhone: null,
    });

    const result = await urlAdapter("https://example.com");

    expect(result.identity?.name).toBe("Acme Corp");
    expect(result.identity?.description).toBe("We make widgets");
    expect(result.palette?.primary).toBe("#336699");
    expect(result.identity?.logo?.mark?.url).toBe("https://example.com/logo.png");
    expect(result.identity?.logo?.mark?.source).toBe("scraped");
    expect(result.confidence?.overall).toBeGreaterThan(0);
    expect(result.gaps ?? []).not.toContain("url-fetch-failed");
  });

  it("returns a partial with a gap when fetch throws", async () => {
    mocks.fetchPublicWebsiteEvidence.mockRejectedValue(new Error("HTTP 404"));

    const result = await urlAdapter("https://dead.example.com");

    expect(result.gaps).toContain("url-fetch-failed");
    expect(result.identity).toBeUndefined();
    expect(result.palette).toBeUndefined();
    expect(result.confidence?.overall).toBe(0);
  });

  it("returns a partial with low confidence when the page has no usable signals", async () => {
    mocks.fetchPublicWebsiteEvidence.mockResolvedValue({
      url: "https://sparse.example.com",
      finalUrl: "https://sparse.example.com",
      title: null,
      description: null,
      textExcerpt: null,
      themeColor: null,
      logoCandidates: [],
      colorCandidates: [],
      contactEmailCandidates: [],
      contactPhoneCandidates: [],
    });
    mocks.analyzePublicWebsiteBranding.mockReturnValue({
      companyName: null,
      logoUrl: null,
      paletteAccent: null,
      notes: [],
      suggestedArchetypeId: null,
      suggestedArchetypeName: null,
      archetypeConfidence: null,
      suggestedCountryCode: null,
      suggestedCurrency: null,
      suggestedDescription: null,
      suggestedContactEmail: null,
      suggestedContactPhone: null,
    });

    const result = await urlAdapter("https://sparse.example.com");

    expect(result.confidence?.overall ?? 0).toBeLessThan(0.3);
    expect(result.gaps?.length ?? 0).toBeGreaterThan(0);
  });
});

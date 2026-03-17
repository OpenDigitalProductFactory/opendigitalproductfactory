import { describe, expect, it } from "vitest";
import {
  analyzePublicWebsiteBranding,
  assertAllowedPublicUrl,
  normalizeBraveSearchResults,
  normalizePublicFetchUrl,
} from "./public-web-tools";

describe("public web tools", () => {
  it("blocks localhost and private network targets", () => {
    expect(() => assertAllowedPublicUrl("http://localhost:3000")).toThrow(/not allowed/i);
    expect(() => assertAllowedPublicUrl("http://127.0.0.1:3000")).toThrow(/not allowed/i);
    expect(() => assertAllowedPublicUrl("http://10.0.0.25")).toThrow(/not allowed/i);
    expect(() => assertAllowedPublicUrl("http://192.168.1.10")).toThrow(/not allowed/i);
  });

  it("normalizes public fetch targets to https urls", () => {
    expect(normalizePublicFetchUrl("example.com/brand")).toBe("https://example.com/brand");
    expect(normalizePublicFetchUrl(" https://jackjackspack.org ")).toBe("https://jackjackspack.org/");
  });

  it("normalizes brave search results into a stable shape", () => {
    const normalized = normalizeBraveSearchResults({
      web: {
        results: [
          {
            title: "Jack Jack's Pack",
            url: "https://jackjackspack.org",
            description: "Care packages and community support.",
          },
        ],
      },
    });

    expect(normalized).toEqual([
      {
        title: "Jack Jack's Pack",
        url: "https://jackjackspack.org",
        snippet: "Care packages and community support.",
      },
    ]);
  });

  it("derives a branding proposal from fetched public page evidence", () => {
    const proposal = analyzePublicWebsiteBranding({
      url: "https://jackjackspack.org",
      finalUrl: "https://jackjackspack.org/",
      title: "Jack Jack's Pack",
      description: "Compassion packs for children and families.",
      textExcerpt: "Jack Jack's Pack provides comfort packs for families in crisis.",
      themeColor: "#4f46e5",
      logoCandidates: [
        "https://jackjackspack.org/logo.svg",
      ],
      colorCandidates: ["#4f46e5"],
    });

    expect(proposal.companyName).toBe("Jack Jack's Pack");
    expect(proposal.logoUrl).toBe("https://jackjackspack.org/logo.svg");
    expect(proposal.paletteAccent).toBe("#4f46e5");
  });
});

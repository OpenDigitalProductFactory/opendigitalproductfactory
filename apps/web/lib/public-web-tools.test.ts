import { describe, expect, it } from "vitest";
import {
  analyzePublicWebsiteBranding,
  assertAllowedPublicUrl,
  normalizeBraveSearchResults,
  normalizePublicFetchUrl,
  type PublicWebsiteEvidence,
} from "./public-web-tools";

function makeEvidence(overrides: Partial<PublicWebsiteEvidence> = {}): PublicWebsiteEvidence {
  return {
    url: "https://example.com",
    finalUrl: "https://example.com/",
    title: null,
    description: null,
    textExcerpt: null,
    themeColor: null,
    logoCandidates: [],
    colorCandidates: [],
    ...overrides,
  };
}

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

describe("analyzePublicWebsiteBranding — archetype detection", () => {
  it("returns null suggestion fields for generic text with no industry signals", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      title: "Welcome to our website",
      description: "We are a company.",
      textExcerpt: "Please contact us for more information about our services.",
    }));
    expect(result.suggestedArchetypeId).toBeNull();
    expect(result.suggestedArchetypeName).toBeNull();
    expect(result.archetypeConfidence).toBeNull();
  });

  it("detects dental practice with high confidence from clear keyword matches", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      title: "Bright Smiles Dental Practice",
      description: "Your local dentist — cosmetic dentistry and oral health care.",
      textExcerpt: "Book a dental appointment. Our dentist offers teeth whitening.",
    }));
    expect(result.suggestedArchetypeId).toBe("dental-practice");
    expect(result.suggestedArchetypeName).toBe("Dental Practice");
    expect(result.archetypeConfidence).toBe("high");
  });

  it("detects hair salon from keyword match", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      title: "Cuts & Colours Hair Salon",
      description: "Book your haircut or blow dry today.",
      textExcerpt: "Our hairdresser specialises in colouring and styling.",
    }));
    expect(result.suggestedArchetypeId).toBe("hair-salon");
  });

  it("returns medium confidence when score is 1", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      title: "Pilates Studio",
      description: "Join our classes.",
      textExcerpt: "We offer pilates and fitness sessions.",
    }));
    expect(result.suggestedArchetypeId).toBe("yoga-pilates-studio");
    expect(result.archetypeConfidence).toBe("medium");
  });
});

describe("analyzePublicWebsiteBranding — country/currency detection", () => {
  it("detects GBP from .co.uk TLD", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://www.dentist.co.uk/",
    }));
    expect(result.suggestedCountryCode).toBe("GB");
    expect(result.suggestedCurrency).toBe("GBP");
  });

  it("detects EUR from .de TLD", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://example.de/",
    }));
    expect(result.suggestedCountryCode).toBe("DE");
    expect(result.suggestedCurrency).toBe("EUR");
  });

  it("detects AUD from .au TLD", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://example.com.au/",
    }));
    expect(result.suggestedCountryCode).toBe("AU");
    expect(result.suggestedCurrency).toBe("AUD");
  });

  it("detects GBP from +44 phone number in body text when TLD is .com", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://example.com/",
      textExcerpt: "Call us on +44 20 7946 0958 to book an appointment.",
    }));
    expect(result.suggestedCountryCode).toBe("GB");
    expect(result.suggestedCurrency).toBe("GBP");
  });

  it("detects GBP from UK national phone format in body text", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://example.com/",
      textExcerpt: "Phone: 01234 567890",
    }));
    expect(result.suggestedCountryCode).toBe("GB");
    expect(result.suggestedCurrency).toBe("GBP");
  });

  it("detects EUR from £ currency symbol in body text", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://example.com/",
      textExcerpt: "Prices from £50 per session.",
    }));
    expect(result.suggestedCurrency).toBe("GBP");
  });

  it("returns null country/currency for generic .com with no phone or currency signals", () => {
    const result = analyzePublicWebsiteBranding(makeEvidence({
      finalUrl: "https://example.com/",
      textExcerpt: "Welcome to our website.",
    }));
    expect(result.suggestedCountryCode).toBeNull();
    expect(result.suggestedCurrency).toBeNull();
  });
});

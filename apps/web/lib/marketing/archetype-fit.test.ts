import { describe, expect, it } from "vitest";

import {
  assessArchetypeFit,
  buildOwnOfferText,
  isImportedTestArtifact,
  platformLeakTermsFor,
  isPublishBlockedByFit,
  worstFitSeverity,
} from "./archetype-fit";

describe("assessArchetypeFit", () => {
  it("blocks software-platform / DPF artifacts for a restaurant", () => {
    const result = assessArchetypeFit({
      text: "Our Build Studio helps technical founders ship software with an AI workflow.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("block");
    expect(result.blocked).toBe(true);
    expect(isPublishBlockedByFit(result)).toBe(true);
    expect(isImportedTestArtifact(result)).toBe(true);
    expect(result.findings.some((f) => f.kind === "platform-leak" && /Build Studio/i.test(f.term))).toBe(
      true,
    );
  });

  it("passes clean food-hospitality copy for a restaurant", () => {
    const result = assessArchetypeFit({
      text: "Reserve a table for our seasonal tasting menu and fill quiet midweek covers. Read our reviews.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("ok");
    expect(result.blocked).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  it("warns when a restaurant draft uses another archetype's vocabulary", () => {
    const result = assessArchetypeFit({
      text: "Open an account today and check our APY — plus book your annual health screening.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("warn");
    expect(result.blocked).toBe(false);
    expect(result.findings.every((f) => f.kind === "off-archetype")).toBe(true);
    expect(result.findings.map((f) => f.looksLikeCategory)).toContain("banking-financial-services");
  });

  it("does not warn on the active archetype's own vocabulary", () => {
    // "reservation" and "menu" are food-hospitality signatures, so a restaurant
    // must not be warned about its own words.
    const result = assessArchetypeFit({
      text: "Confirm your reservation and view the new menu.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("ok");
  });

  it("still blocks platform leaks regardless of active category", () => {
    const result = assessArchetypeFit({
      text: "Our SaaS software platform is built on Prisma.",
      category: "trades-maintenance",
    });
    expect(result.blocked).toBe(true);
  });

  it("block outranks warn when both are present", () => {
    const result = assessArchetypeFit({
      text: "Build Studio for technical founders — also, book your annual screening.",
      category: "food-hospitality",
    });
    expect(result.severity).toBe("block");
  });

  it("treats empty content as ok", () => {
    expect(assessArchetypeFit({ text: "", category: "food-hospitality" }).severity).toBe("ok");
    expect(assessArchetypeFit({ text: null, category: null }).severity).toBe("ok");
  });

  it("computes the worst severity across assessments", () => {
    const ok = assessArchetypeFit({ text: "Reserve a table.", category: "food-hospitality" });
    const warn = assessArchetypeFit({ text: "Check our APY.", category: "food-hospitality" });
    const block = assessArchetypeFit({ text: "Build Studio.", category: "food-hospitality" });
    expect(worstFitSeverity([ok, warn])).toBe("warn");
    expect(worstFitSeverity([ok, warn, block])).toBe("block");
    expect(worstFitSeverity([ok])).toBe("ok");
  });
});

describe("a business may market what it sells (BI-E92B6BC9)", () => {
  const platformOffer = buildOwnOfferText({
    items: [
      { name: "Open Digital Product Factory", description: "AI-native platform for operating digital product delivery." },
      { name: "Governed Build Studio Enablement", description: null },
    ],
    tagline: "Digital Product Factory for small and midsize businesses",
    valueProposition: "A governed AI coworker and business operating platform.",
  });

  it("still blocks platform names for a restaurant that does not sell them", () => {
    const result = assessArchetypeFit({
      text: "Book a table — powered by the Digital Product Factory and Build Studio.",
      category: "food-hospitality",
      ownOffer: buildOwnOfferText({ items: [{ name: "Tasting menu" }], tagline: "Seasonal dining" }),
    });
    expect(result.blocked).toBe(true);
  });

  it("lets a business whose own offer names the platform market it", () => {
    const result = assessArchetypeFit({
      text: "Digital Product Factory gives an HVAC owner an AI coworker that drafts quote follow-ups; Build Studio enablement is available.",
      category: "software-platform",
      ownOffer: platformOffer,
    });
    expect(result.blocked).toBe(false);
    expect(result.findings.filter((f) => f.kind === "platform-leak")).toEqual([]);
  });

  it("treats software-industry vocabulary as the software-platform category's own language", () => {
    const result = assessArchetypeFit({
      text: "Our SaaS software platform helps technical founders keep the codebase tidy.",
      category: "software-platform",
      ownOffer: null,
    });
    expect(result.blocked).toBe(false);
  });

  it("still blocks platform plumbing a software-platform business does not sell", () => {
    const result = assessArchetypeFit({
      text: "We store it in Prisma behind an MCP server.",
      category: "software-platform",
      ownOffer: buildOwnOfferText({ items: [{ name: "Analytics dashboard" }] }),
    });
    expect(result.blocked).toBe(true);
    expect(result.findings.map((f) => f.term)).toEqual(expect.arrayContaining(["Prisma", "MCP server"]));
  });

  it("platform partners reselling the platform under another archetype are exempt by their offer", () => {
    const result = assessArchetypeFit({
      text: "We implement the Digital Product Factory for local businesses.",
      category: "professional-services",
      ownOffer: buildOwnOfferText({ items: [{ name: "Digital Product Factory onboarding" }] }),
    });
    expect(result.blocked).toBe(false);
  });

  it("tells the drafter exactly the terms the guard still blocks", () => {
    const restaurant = platformLeakTermsFor({ category: "food-hospitality", ownOffer: null });
    expect(restaurant).toEqual(expect.arrayContaining(["Build Studio", "SaaS", "Digital Product Factory"]));

    const vendor = platformLeakTermsFor({ category: "software-platform", ownOffer: platformOffer });
    expect(vendor).not.toContain("Digital Product Factory");
    expect(vendor).not.toContain("Build Studio");
    expect(vendor).not.toContain("SaaS");
    expect(vendor).not.toContain("AI coworker");
    expect(vendor).toContain("Prisma");
  });

  it("buildOwnOfferText is null when the business has said nothing", () => {
    expect(buildOwnOfferText({ items: [], tagline: "  ", description: null })).toBeNull();
  });
});

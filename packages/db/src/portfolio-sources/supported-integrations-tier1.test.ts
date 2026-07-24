import { describe, expect, it } from "vitest";
import { SUPPORTED_INTEGRATIONS } from "./supported-integrations-manifest";
import { isPortfolioSlug } from "./types";

// P3 (BI-96BFA984) — the Tier-1 shared connector catalog. Pure manifest checks
// (no Prisma client), so they run in the source-only worktree. Guards the
// no-duplication acceptance and that the previously-uncovered Tier-1 categories
// now have at least one catalog target.

describe("supported integrations — Tier-1 catalog", () => {
  it("has unique slugs and credentialProviders (no duplication)", () => {
    const slugs = SUPPORTED_INTEGRATIONS.map((i) => i.slug);
    const providers = SUPPORTED_INTEGRATIONS.map((i) => i.credentialProvider);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(providers).size).toBe(providers.length);
  });

  it("routes every integration to a valid portfolio slug", () => {
    for (const i of SUPPORTED_INTEGRATIONS) {
      expect(isPortfolioSlug(i.portfolioSlug), i.slug).toBe(true);
    }
  });

  it("now covers the Tier-1 categories the original 12 left open", () => {
    const slugs = new Set(SUPPORTED_INTEGRATIONS.map((i) => i.slug));
    // calendar/scheduling, transactional messaging, documents, inventory.
    for (const slug of ["calendly", "twilio", "sendgrid", "docusign", "zoho-inventory"]) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });

  it("keeps the pre-existing anchor integrations intact", () => {
    const slugs = new Set(SUPPORTED_INTEGRATIONS.map((i) => i.slug));
    for (const slug of ["quickbooks", "stripe", "hubspot", "slack", "ninjaone"]) {
      expect(slugs.has(slug), slug).toBe(true);
    }
  });
});

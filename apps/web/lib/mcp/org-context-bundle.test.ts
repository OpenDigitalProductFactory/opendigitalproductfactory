import { describe, it, expect, vi } from "vitest";
import {
  buildOrgContextBundle,
  formatOrgContextInstructions,
  type OrgContextClient,
} from "./org-context-bundle";

/**
 * Minimal structural client. Each model method is a vi.fn returning the supplied
 * row, so a test only overrides what it exercises.
 */
function mockClient(rows: {
  org?: { id: string; name: string | null } | null;
  businessContext?: {
    mission?: string | null;
    industry?: string | null;
  } | null;
  storefrontConfig?: {
    archetypeId?: string | null;
    archetype?: { name?: string | null; category?: string | null } | null;
  } | null;
  orgSettings?: {
    baseCurrency?: string | null;
    locale?: string | null;
    countryCode?: string | null;
  } | null;
}): OrgContextClient {
  return {
    organization: { findFirst: vi.fn(async () => rows.org ?? null) },
    businessContext: { findUnique: vi.fn(async () => rows.businessContext ?? null) },
    storefrontConfig: { findFirst: vi.fn(async () => rows.storefrontConfig ?? null) },
    orgSettings: { findFirst: vi.fn(async () => rows.orgSettings ?? null) },
  } as unknown as OrgContextClient;
}

const BASE = "BASE NOTE.";

describe("buildOrgContextBundle (BI-HDLEMP-02)", () => {
  it("composes mission, archetype, industry, locale, doctrine, and stances", async () => {
    const bundle = await buildOrgContextBundle(
      mockClient({
        org: { id: "ORG-1", name: "Acme Clinic" },
        businessContext: { mission: "Care for every patient", industry: null },
        storefrontConfig: {
          archetypeId: "medical-practice",
          archetype: { name: "Medical Practice", category: "healthcare-wellness" },
        },
        orgSettings: { baseCurrency: "MXN", locale: "es-MX", countryCode: "MX" },
      }),
    );
    expect(bundle).not.toBeNull();
    expect(bundle!.organizationName).toBe("Acme Clinic");
    expect(bundle!.mission).toBe("Care for every patient");
    expect(bundle!.archetypeId).toBe("medical-practice");
    expect(bundle!.archetypeName).toBe("Medical Practice");
    // Industry falls to the archetype category (what INDUSTRY_PROFILES is keyed on).
    expect(bundle!.industry).toBe("healthcare-wellness");
    expect(bundle!.locale).toEqual({ currency: "MXN", locale: "es-MX", countryCode: "MX" });
    // Healthcare/clinical doctrine (the medical-practice archetype override,
    // not the generic profile).
    expect(bundle!.businessProfile.howWeDecide).toMatch(/clinical|patient/i);
    // All five stance vectors are present.
    expect(Object.keys(bundle!.stanceVectors)).toHaveLength(5);
  });

  it("falls back industry to BusinessContext.industry when no archetype category", async () => {
    const bundle = await buildOrgContextBundle(
      mockClient({
        org: { id: "ORG-1", name: "Solo Co" },
        businessContext: { mission: null, industry: "beauty-personal-care" },
        storefrontConfig: null,
      }),
    );
    expect(bundle!.industry).toBe("beauty-personal-care");
    expect(bundle!.archetypeId).toBeNull();
  });

  it("returns null for an uninitialized deployment (no organization)", async () => {
    const bundle = await buildOrgContextBundle(mockClient({ org: null }));
    expect(bundle).toBeNull();
  });

  it("returns null and reports failure when the organization read throws (fail-open)", async () => {
    const onReadFailure = vi.fn();
    const client = {
      organization: {
        findFirst: vi.fn(async () => {
          throw new Error("db down");
        }),
      },
      businessContext: { findUnique: vi.fn() },
      storefrontConfig: { findFirst: vi.fn() },
      orgSettings: { findFirst: vi.fn() },
    } as unknown as OrgContextClient;
    const bundle = await buildOrgContextBundle(client, { onReadFailure });
    expect(bundle).toBeNull();
    expect(onReadFailure).toHaveBeenCalledOnce();
  });
});

describe("formatOrgContextInstructions (BI-HDLEMP-02)", () => {
  async function bundleFor() {
    return buildOrgContextBundle(
      mockClient({
        org: { id: "ORG-1", name: "Acme Clinic" },
        businessContext: { mission: "Care for every patient", industry: null },
        storefrontConfig: {
          archetypeId: "medical-practice",
          archetype: { name: "Medical Practice", category: "healthcare-wellness" },
        },
        orgSettings: { baseCurrency: "MXN", locale: "es-MX", countryCode: "MX" },
      }),
    );
  }

  it("returns exactly the base string when the bundle is null", () => {
    expect(formatOrgContextInstructions(BASE, null)).toBe(BASE);
  });

  it("renders mission, archetype, locale, doctrine, and the decision-routing directive", async () => {
    const out = formatOrgContextInstructions(BASE, await bundleFor());
    expect(out.startsWith(BASE)).toBe(true);
    expect(out).toContain("Acme Clinic");
    expect(out).toContain("Care for every patient");
    expect(out).toContain("Medical Practice");
    expect(out).toContain("es-MX");
    expect(out).toContain("MXN");
    expect(out).toContain("MX");
    // BI-HDLEMP-07: the directive names the working gates — business decisions to
    // evaluate_org_business_decision (reaches WWWD), platform to principle_decide.
    expect(out).toContain("evaluate_org_business_decision");
    expect(out).toContain("principle_decide");
    // And must NOT reference the decisionDomain param principle_decide ignores.
    expect(out).not.toContain("decisionDomain");
  });

  it("keeps the model-facing text provenance-free (no BI/Phase/paths)", async () => {
    const out = formatOrgContextInstructions(BASE, await bundleFor());
    expect(out).not.toMatch(/\bBI-[0-9A-Z]/);
    expect(out).not.toMatch(/\bPhase \d/);
    expect(out).not.toMatch(/apps\/web\//);
  });
});

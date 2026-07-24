import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// BI-6F9D487C — live usability study found the internal support control
// "DPF production-instance preset" / "Apply DPF preset" (and the adjacent
// "Improve template" / "View refinement diff" block) rendered inline on the
// owner-facing Storefront settings page, alongside ordinary public-profile
// fields like slug/tagline/description/contact/hero image. Those internal
// customer-zero actions were moved to the admin/support-only route
// `/admin/storefront/preset` (gated by the existing `can(..., "view_admin")`
// check in `app/(shell)/admin/layout.tsx`). This test locks the regression:
// the public settings page must never render that vocabulary again, for any
// normal owner/operator role — the page has no auth branch of its own, so
// "normal owner/operator" here means the page as rendered on the owner route,
// which carries none of the internal controls regardless of session.

const { mockConfigFindFirst } = vi.hoisted(() => ({
  mockConfigFindFirst: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findFirst: mockConfigFindFirst, update: vi.fn() },
    organization: { update: vi.fn() },
  },
}));

describe("StorefrontSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigFindFirst.mockResolvedValue({
      id: "sf-1",
      tagline: "Fresh, local, fast.",
      description: "A neighborhood restaurant.",
      contactEmail: "owner@example.com",
      contactPhone: "555-0100",
      heroImageUrl: "https://example.com/hero.png",
      organization: { slug: "example-restaurant" },
      archetype: { name: "Restaurant", isBuiltIn: true },
    });
  });

  it("never renders internal DPF preset / customer-zero controls or vocabulary", async () => {
    const { default: StorefrontSettingsPage } = await import("./page");
    const html = renderToStaticMarkup(await StorefrontSettingsPage());

    expect(html).not.toContain("DPF production-instance preset");
    expect(html).not.toContain("Apply DPF preset");
    expect(html).not.toContain("customer-zero");
    expect(html).not.toContain("Improve template");
    expect(html).not.toContain("View refinement diff");
  });

  it("renders only business-safe owner settings", async () => {
    const { default: StorefrontSettingsPage } = await import("./page");
    const html = renderToStaticMarkup(await StorefrontSettingsPage());

    expect(html).toContain("Storefront URL slug");
    expect(html).toContain("Tagline");
    expect(html).toContain("Description");
    expect(html).toContain("Contact email");
    expect(html).toContain("Contact phone");
    expect(html).toContain("Hero image URL");
    expect(html).toContain("Save Changes");
  });
});

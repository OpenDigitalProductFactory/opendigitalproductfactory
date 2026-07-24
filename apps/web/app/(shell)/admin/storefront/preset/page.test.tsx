import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// BI-6F9D487C — these internal/customer-zero controls used to render inline on
// the owner-facing `/storefront/settings` page. They now live here, under
// `/admin/storefront/preset`, which inherits access control from the existing
// shell admin layout (`app/(shell)/admin/layout.tsx`'s `can(..., "view_admin")`
// gate — the same admin/support role-gating pattern every other `/admin/*`
// route already relies on, reused rather than reinvented).

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/dpf-production-instance", () => ({
  applyDpfProductionInstancePreset: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: {
      findFirst: vi.fn().mockResolvedValue({ archetype: { name: "Restaurant" } }),
    },
  },
}));

describe("StorefrontPresetAdminPage", () => {
  it("renders the internal DPF preset and template-refinement controls for the admin-gated route", async () => {
    const { default: StorefrontPresetAdminPage } = await import("./page");
    const html = renderToStaticMarkup(await StorefrontPresetAdminPage());

    expect(html).toContain("DPF production-instance preset");
    expect(html).toContain("Apply DPF preset");
    expect(html).toContain("Improve template");
    expect(html).toContain("View refinement diff");
    expect(html).toContain("support and platform admins");
  });
});

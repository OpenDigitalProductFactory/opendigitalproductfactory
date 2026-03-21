import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BrandingPageClient } from "@/components/admin/BrandingPageClient";

export default async function AdminBrandingPage() {
  const [activeBranding, organization] = await Promise.all([
    prisma.brandingConfig.findUnique({
      where: { scope: "organization" },
      select: { tokens: true },
    }),
    prisma.organization.findFirst({
      select: { name: true, logoUrl: true },
    }),
  ]);

  let currentAccent = "#7c8cf8";
  let currentFont = "Inter, system-ui, sans-serif";

  if (activeBranding?.tokens && typeof activeBranding.tokens === "object") {
    const tokens = activeBranding.tokens as Record<string, unknown>;
    const palette = typeof tokens.palette === "object" && tokens.palette !== null ? tokens.palette as Record<string, unknown> : {};
    const typography = typeof tokens.typography === "object" && tokens.typography !== null ? tokens.typography as Record<string, unknown> : {};
    if (typeof palette.accent === "string") currentAccent = palette.accent;
    if (typeof typography.fontFamily === "string") currentFont = typography.fontFamily;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Brand Configuration</p>
      </div>
      <AdminTabNav />
      <BrandingPageClient
        hasExistingBrand={!!(activeBranding || organization?.name)}
        currentName={organization?.name ?? ""}
        currentLogoUrl={organization?.logoUrl ?? ""}
        currentAccent={currentAccent}
        currentFont={currentFont}
      />
    </div>
  );
}

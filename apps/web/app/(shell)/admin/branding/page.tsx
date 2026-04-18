import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { BrandingPageClient } from "@/components/admin/BrandingPageClient";
import { BrandExtractionSection } from "@/components/storefront-admin/BrandExtractionSection";
import { isBrandDesignSystem, type BrandDesignSystem } from "@/lib/brand/types";

export default async function AdminBrandingPage() {
  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [activeBranding, organization, thread, activeTaskRun] = await Promise.all([
    prisma.brandingConfig.findUnique({
      where: { scope: "organization" },
      select: { tokens: true },
    }),
    prisma.organization.findFirst({
      select: { id: true, name: true, slug: true, logoUrl: true, designSystem: true },
    }),
    userId
      ? prisma.agentThread.findUnique({
          where: { userId_contextKey: { userId, contextKey: "coworker" } },
          select: { id: true },
        })
      : null,
    userId
      ? prisma.taskRun.findFirst({
          where: { userId, title: "Extract brand design system", status: "active" },
          select: { taskRunId: true },
        })
      : null,
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

  const initialSystem: BrandDesignSystem | null =
    organization?.designSystem && isBrandDesignSystem(organization.designSystem)
      ? organization.designSystem
      : null;
  const isPlatformOrg = organization?.slug === "platform";

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Brand Configuration</p>
      </div>
      <AdminTabNav />
      {organization && (
        <BrandExtractionSection
          organizationId={organization.id}
          isPlatformOrg={isPlatformOrg}
          initialSystem={initialSystem}
          initialThreadId={thread?.id ?? null}
          hasActiveExtraction={!!activeTaskRun}
        />
      )}
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

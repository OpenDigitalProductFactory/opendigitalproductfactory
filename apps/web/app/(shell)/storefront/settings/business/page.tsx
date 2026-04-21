import { prisma } from "@dpf/db";
import { BusinessContextForm } from "@/components/admin/BusinessContextForm";
import { getSetupContext } from "@/lib/actions/setup-progress";

export default async function StorefrontBusinessSettingsPage() {
  const [org, setupContext, storefrontConfig] = await Promise.all([
    prisma.organization.findFirst({
      select: { id: true, email: true, phone: true },
    }),
    getSetupContext(),
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { name: true, category: true } } },
    }),
  ]);

  const businessContext = org
    ? await prisma.businessContext.findUnique({
        where: { organizationId: org.id },
      })
    : null;

  const suggestions = !businessContext && setupContext ? {
    description: setupContext.suggestedDescription ?? "",
    contactEmail: setupContext.suggestedContactEmail ?? "",
    contactPhone: setupContext.suggestedContactPhone ?? "",
    geographicScope: setupContext.suggestedGeographicScope ?? null,
  } : null;

  const initial = {
    description: businessContext?.description ?? suggestions?.description ?? "",
    targetMarket: businessContext?.targetMarket ?? "",
    industry: businessContext?.industry ?? "",
    companySize: businessContext?.companySize ?? null,
    geographicScope: businessContext?.geographicScope ?? suggestions?.geographicScope ?? null,
    revenueModel: businessContext?.revenueModel ?? "",
    contactEmail: org?.email ?? suggestions?.contactEmail ?? "",
    contactPhone: org?.phone ?? suggestions?.contactPhone ?? "",
  };

  const autoFilledFields = suggestions
    ? Object.entries(suggestions)
        .filter(([, value]) => value != null && value !== "")
        .map(([key]) => key)
    : [];

  const archetypeSummary = storefrontConfig?.archetype
    ? { name: storefrontConfig.archetype.name, category: storefrontConfig.archetype.category }
    : null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--dpf-text)]">Your Business</h2>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {businessContext ? "Keep your business context current for the portal and AI coworkers." : "Tell the platform what your business does and who it serves."}
        </p>
      </div>

      <BusinessContextForm
        initial={initial}
        archetypeSummary={archetypeSummary}
        isEdit={!!businessContext}
        autoFilledFields={autoFilledFields}
      />
    </div>
  );
}

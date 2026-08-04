import { prisma } from "@dpf/db";
import { BusinessContextForm } from "@/components/admin/BusinessContextForm";
import { getSetupContext } from "@/lib/actions/setup-progress";
import { suggestMission } from "@/lib/onboarding/mission-suggestion";
import { parseOrgAddress } from "@/lib/shared/org-address";
import { deriveRiskPostureDefault } from "@/lib/govern/risk-posture";

export default async function StorefrontBusinessSettingsPage() {
  const [org, setupContext, storefrontConfig] = await Promise.all([
    prisma.organization.findFirst({
      select: { id: true, name: true, email: true, phone: true, address: true },
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
    mission: businessContext?.mission ?? "",
    targetMarket: businessContext?.targetMarket ?? "",
    sourceSystem: businessContext?.sourceSystem ?? "",
    companySize: businessContext?.companySize ?? null,
    geographicScope: businessContext?.geographicScope ?? suggestions?.geographicScope ?? null,
    revenueModel: businessContext?.revenueModel ?? "",
    contactEmail: org?.email ?? suggestions?.contactEmail ?? "",
    contactPhone: org?.phone ?? suggestions?.contactPhone ?? "",
    operatesIn: businessContext?.operatesIn ?? [],
    sellsTo: businessContext?.sellsTo ?? [],
    employsIn: businessContext?.employsIn ?? [],
    dataResidency: businessContext?.dataResidency ?? [],
    handlesCardPayments: businessContext?.handlesCardPayments ?? false,
    dataHandling: businessContext?.dataHandling ?? [],
    listingStatus: businessContext?.listingStatus ?? null,
    address: parseOrgAddress(org?.address),
    // Pre-set the risk posture from the stored value, else the industry default.
    // Inert in P0 — captured/seeded only; consumers are wired in P1.
    riskPosture:
      businessContext?.riskPosture ??
      deriveRiskPostureDefault({
        archetypeCategory: storefrontConfig?.archetype?.category ?? null,
        industry: setupContext?.suggestedIndustry ?? null,
        handlesCardPayments: businessContext?.handlesCardPayments ?? false,
      }).posture,
  };

  const missionSuggestion = suggestMission({
    industry: storefrontConfig?.archetype?.category ?? setupContext?.suggestedIndustry ?? null,
    archetypeName: storefrontConfig?.archetype?.name ?? setupContext?.suggestedArchetypeName ?? null,
    description: initial.description || null,
    orgName: org?.name ?? null,
  });

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
        missionSuggestion={missionSuggestion}
      />
    </div>
  );
}

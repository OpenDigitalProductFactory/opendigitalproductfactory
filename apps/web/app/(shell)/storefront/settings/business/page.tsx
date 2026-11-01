import { prisma } from "@dpf/db";
import Link from "next/link";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { BusinessContextForm } from "@/components/admin/BusinessContextForm";
import { DirectionPanel } from "@/components/admin/DirectionPanel";
import { DirectionSummary } from "@/components/admin/DirectionSummary";
import { directionGaps, loadOrganizationDirection, type DirectionReadClient } from "@/lib/organization-direction/direction";
import { getSetupContext } from "@/lib/actions/setup-progress";
import { suggestMission } from "@/lib/onboarding/mission-suggestion";
import { parseOrgAddress } from "@/lib/shared/org-address";
import { deriveRiskPostureDefault } from "@/lib/govern/risk-posture";

export default async function StorefrontBusinessSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ section?: string }>;
}) {
  // ?section=direction is the "direction" setup step and the Needs-you link:
  // the Direction panel on its own, so the owner sees one question at a time.
  const directionOnly = (await searchParams)?.section === "direction";
  const [org, setupContext, storefrontConfig] = await Promise.all([
    prisma.organization.findFirst({
      select: { id: true, name: true, email: true, phone: true, address: true },
    }),
    getSetupContext(),
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { name: true, category: true } } },
    }),
  ]);

  const [businessContext, direction] = org
    ? await Promise.all([
        prisma.businessContext.findUnique({ where: { organizationId: org.id } }),
        loadOrganizationDirection(prisma as unknown as DirectionReadClient, org.id),
      ])
    : [null, null];

  const suggestions = !businessContext && setupContext ? {
    description: setupContext.suggestedDescription ?? "",
    contactEmail: setupContext.suggestedContactEmail ?? "",
    contactPhone: setupContext.suggestedContactPhone ?? "",
    geographicScope: setupContext.suggestedGeographicScope ?? null,
  } : null;

  const initial = {
    description: businessContext?.description ?? suggestions?.description ?? "",
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
  const entityNoun = archetypeSummary?.category === "nonprofit-community" ? "Organization" : "Business";
  const entityNounLower = entityNoun.toLowerCase();

  const { language } = await getLocaleContext();
  const t = await getT("storefront");
  const withMessages = (node: React.ReactNode) => (
    <MessagesProvider locale={language} messages={{ storefront: namespaceMessages(language, "storefront") }}>
      {node}
    </MessagesProvider>
  );
  const directionPanel = (
    <DirectionPanel
      initial={{
        mission: direction?.mission ?? "",
        vision: direction?.vision ?? "",
        outcomes: direction?.outcomes ?? [],
      }}
      source={setupContext ? "setup" : "settings"}
      entityNoun={entityNounLower === "organization" ? "organization" : "business"}
      missionSuggestion={missionSuggestion}
    />
  );

  if (directionOnly) {
    return (
      <div>
        {withMessages(directionPanel)}
        <p className="text-sm text-[var(--dpf-muted)]">
          <Link href="/storefront/settings/business" className="text-[var(--dpf-accent)] underline">
            {t("direction.editRest", { noun: entityNounLower })}
          </Link>
        </p>
      </div>
    );
  }

  const outcomeCount = direction?.outcomes.length ?? 0;
  return (
    <div>
      {withMessages(
        <DirectionSummary
          missing={directionGaps({ mission: direction?.mission, vision: direction?.vision, outcomeCount })}
          outcomeCount={outcomeCount}
        />,
      )}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-[var(--dpf-text)]">Your {entityNoun}</h2>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {businessContext
            ? `Keep your ${entityNounLower} context current for the portal and AI coworkers.`
            : `Tell the platform what your ${entityNounLower} does and who it serves.`}
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

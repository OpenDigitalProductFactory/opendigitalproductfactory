import Link from "next/link";
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { StorefrontDashboard } from "@/components/storefront-admin/StorefrontDashboard";
import { ServiceReadinessCockpit } from "@/components/restaurant-cockpit/ServiceReadinessCockpit";
import { loadServiceReadiness } from "@/lib/restaurant-cockpit/service-readiness-loader";
import { NAV_MODE_COOKIE, resolveNavModeFromCookie, isSimpleNavMode } from "@/lib/navigation/nav-mode";
import { StorefrontSetupPanel } from "@/components/storefront-admin/StorefrontSetupPanel";
import { ServiceLinesPanel } from "@/components/storefront-admin/ServiceLinesPanel";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveVocabularyKey } from "@/lib/storefront/resolve-vocabulary";
import {
  loadCompositionViewData,
  loadRemovedServiceLines,
} from "@/lib/storefront/service-line-actions";
import { deriveStorefrontCompositionView } from "@/lib/storefront/composition-view";
import {
  deriveStorefrontSetupModel,
  resolveSetupCapabilities,
  type GeneratedContentGroupInput,
} from "@/lib/storefront/setup-model";

function getSetupSteps(portalLabel: string, stakeholderLabel: string) {
  return [
    {
      num: 1,
      title: "Choose your portal template",
      desc: `Pick an archetype that matches your business. This pre-loads relevant sections and items for your ${portalLabel.toLowerCase()}.`,
    },
    {
      num: 2,
      title: "Preview and configure",
      desc: "Review the template sections and set your URL slug, tagline, and hero image.",
    },
    {
      num: 3,
      title: "Customise sections and items",
      desc: "Edit the pre-loaded content to match your offering. Add your own sections, products, or services.",
    },
    {
      num: 4,
      title: "Configure settings",
      desc: "Set contact details, branding, and payment or booking options.",
    },
    {
      num: 5,
      title: "Publish",
      desc: `When you're ready, publish your ${portalLabel.toLowerCase()} so ${stakeholderLabel.toLowerCase()} can find it.`,
    },
  ];
}

export default async function StorefrontPage() {
  const config = await prisma.storefrontConfig.findFirst({
    select: {
      id: true,
      isPublished: true,
      tagline: true,
      heroImageUrl: true,
      contactEmail: true,
      contactPhone: true,
      organization: { select: { slug: true, name: true } },
      archetype: {
        select: { archetypeId: true, category: true, ctaType: true, customVocabulary: true },
      },
    },
  });

  if (config) {
    const [
      inquiryCount,
      bookingCount,
      orderCount,
      donationCount,
      activeItemCount,
      visibleSectionCount,
      resourceCount,
      businessProfile,
      compositionData,
      removedLines,
      allArchetypes,
    ] = await Promise.all([
      prisma.storefrontInquiry.count({ where: { storefrontId: config.id } }),
      prisma.storefrontBooking.count({ where: { storefrontId: config.id } }),
      prisma.storefrontOrder.count({ where: { storefrontId: config.id } }),
      prisma.storefrontDonation.count({ where: { storefrontId: config.id } }),
      // Count only live artifacts so add/remove of a service line is honestly
      // reflected on the dashboard — removing a line hides its items/sections and
      // the counts drop back (BI-7D7EE150).
      prisma.storefrontItem.count({ where: { storefrontId: config.id, isActive: true } }),
      prisma.storefrontSection.count({ where: { storefrontId: config.id, isVisible: true } }),
      prisma.serviceProvider.count({ where: { storefrontId: config.id } }),
      prisma.businessProfile.findFirst({
        where: { isActive: true },
        select: { hoursConfirmedAt: true },
      }),
      loadCompositionViewData(config.id),
      loadRemovedServiceLines(config.id),
      prisma.storefrontArchetype.findMany({
        select: {
          archetypeId: true,
          name: true,
          category: true,
          itemTemplates: true,
          sectionTemplates: true,
        },
        orderBy: { name: "asc" },
      }),
    ]);

    const primaryCategory = config.archetype?.category ?? null;
    const vocabulary = getVocabulary(
      primaryCategory,
      config.archetype?.customVocabulary as Record<string, string> | null,
    );

    // Restaurant owner service-readiness cockpit — the first daily answer
    // ("are we ready for the next service period?"). Scoped to food-hospitality
    // for this first slice; the model itself is archetype-neutral (BI-075F731F).
    const simpleMode = isSimpleNavMode(
      resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value),
    );
    const readiness =
      primaryCategory === "food-hospitality"
        ? await loadServiceReadiness({
            storefrontId: config.id,
            category: primaryCategory,
            customVocabulary: config.archetype?.customVocabulary as Record<string, string> | null,
          })
        : null;
    const capabilities = resolveSetupCapabilities(
      primaryCategory,
      compositionData?.primary.activationProfile?.modules ?? [],
    );

    // Generated-content groups, keyed by the composition that produced them.
    const primaryGroup: GeneratedContentGroupInput = {
      compositionId: compositionData?.primary.compositionId ?? "primary",
      name: compositionData?.primary.name ?? config.organization.name,
      category: primaryCategory ?? "",
      role: "primary",
      itemsGenerated: activeItemCount,
      sectionsGenerated: visibleSectionCount,
    };
    const secondaryGroups: GeneratedContentGroupInput[] = (compositionData?.secondaries ?? []).map(
      (s) => {
        const counts = compositionData?.seededCountsByCompositionId[s.compositionId] ?? { items: 0, sections: 0 };
        return {
          compositionId: s.compositionId,
          name: s.name,
          category: s.category,
          role: "secondary" as const,
          itemsGenerated: counts.items,
          sectionsGenerated: counts.sections,
          crossCategory: s.category !== primaryCategory,
        };
      },
    );
    const retainedGroups: GeneratedContentGroupInput[] = removedLines.map((r) => ({
      compositionId: r.compositionId,
      name: r.name,
      category: r.category,
      role: "secondary" as const,
      itemsGenerated: r.retainedItems,
      sectionsGenerated: r.retainedSections,
      crossCategory: r.category !== primaryCategory,
      retained: true,
    }));

    const model = deriveStorefrontSetupModel({
      vocabulary,
      capabilities,
      config: {
        isPublished: config.isPublished,
        hasTagline: Boolean(config.tagline),
        hasHeroImage: Boolean(config.heroImageUrl),
        hasContact: Boolean(config.contactEmail || config.contactPhone),
      },
      content: { activeItemCount, visibleSectionCount },
      resources: { count: resourceCount },
      availability: { operatingHoursConfigured: Boolean(businessProfile?.hoursConfirmedAt) },
      serviceLines: {
        primary: primaryGroup,
        secondaries: secondaryGroups,
        retainedSecondaries: retainedGroups,
      },
    });

    const activeLines = model.inventory.filter((g) => g.role === "secondary" && g.state === "active");
    const retainedLines = model.inventory.filter((g) => g.state === "retained");

    // Active service lines (add/remove) are owned by ServiceLinesPanel, kept
    // as-is so BI-7D7EE150's confirm/preview/undo flow is not duplicated here.
    const compositionView = compositionData
      ? deriveStorefrontCompositionView(compositionData)
      : null;
    const activeSlugSet = new Set([
      compositionData?.primary.archetypeSlug,
      ...(compositionData?.secondaries.map((s) => s.archetypeSlug) ?? []),
    ]);
    const availableArchetypes = allArchetypes
      .filter((a) => !activeSlugSet.has(a.archetypeId))
      .map((a) => ({
        archetypeSlug: a.archetypeId,
        name: a.name,
        category: a.category,
        // Preview counts so the add-confirmation can name exactly what the
        // mutation will do (BI-7D7EE150).
        itemCount: Array.isArray(a.itemTemplates) ? a.itemTemplates.length : 0,
        sectionCount: Array.isArray(a.sectionTemplates) ? a.sectionTemplates.length : 0,
      }));

    return (
      <>
        {readiness && <ServiceReadinessCockpit summary={readiness} simple={simpleMode} />}
        <StorefrontDashboard
          config={{
            id: config.id,
            isPublished: config.isPublished,
            tagline: config.tagline,
            orgSlug: config.organization.slug,
            orgName: config.organization.name,
            archetypeId: config.archetype?.archetypeId ?? "",
            ctaType: config.archetype?.ctaType ?? "inquiry",
            sectionCount: visibleSectionCount,
            itemCount: activeItemCount,
          }}
          counts={{ inquiries: inquiryCount, bookings: bookingCount, orders: orderCount, donations: donationCount }}
        />
        {/* Task-first setup status + generated-content inventory + recovery of
            removed lines (BI-C39DC90C). Add/remove of active lines stays in
            ServiceLinesPanel below. */}
        <StorefrontSetupPanel
          storefrontId={config.id}
          steps={model.steps}
          summary={{ completeCount: model.summary.completeCount, totalCount: model.summary.totalCount }}
          activeLines={activeLines}
          retainedLines={retainedLines}
        />
        {compositionView && (
          <ServiceLinesPanel
            storefrontId={config.id}
            view={compositionView}
            availableArchetypes={availableArchetypes}
          />
        )}
      </>
    );
  }

  const bc = await prisma.businessContext.findFirst({
    select: { industry: true },
  });
  // No archetype yet (the early return above covered the config-exists case),
  // so fall back to industry for pre-bootstrap landing copy.
  const vocabulary = getVocabulary(
    resolveVocabularyKey({ archetypeCategory: null, industry: bc?.industry }),
  );
  const setupSteps = getSetupSteps(vocabulary.portalLabel, vocabulary.stakeholderLabel);

  return (
    <div style={{ maxWidth: 640 }}>
      <div
        style={{
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 10,
          padding: "28px 32px",
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: "var(--dpf-text)" }}>
          Set up your {vocabulary.portalLabel}
        </div>
        <p style={{ fontSize: 14, color: "var(--dpf-muted)", lineHeight: 1.6, marginBottom: 24 }}>
          Your {vocabulary.portalLabel.toLowerCase()} lets {vocabulary.stakeholderLabel.toLowerCase()} browse your
          offerings, interact with your business, and access services online. Follow these steps to get up and
          running.
        </p>

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 16 }}>
          {setupSteps.map((step) => (
            <li key={step.num} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "var(--dpf-accent)",
                  color: "white",
                  fontWeight: 700,
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                {step.num}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3, color: "var(--dpf-text)" }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 13, color: "var(--dpf-muted)", lineHeight: 1.5 }}>{step.desc}</div>
              </div>
            </li>
          ))}
        </ol>

        <div style={{ marginTop: 28 }}>
          <Link
            href="/storefront/setup"
            style={{
              display: "inline-block",
              padding: "10px 24px",
              background: "var(--dpf-accent)",
              color: "white",
              borderRadius: 7,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Get started →
          </Link>
        </div>
      </div>
    </div>
  );
}

import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";
import { StorefrontAdminTabNav } from "@/components/storefront-admin/StorefrontAdminTabNav";

export default async function StorefrontAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (
    !session?.user ||
    !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_storefront")
  ) {
    notFound();
  }

  // Load archetype for vocabulary
  const config = await prisma.storefrontConfig.findFirst({
    include: {
      archetype: { select: { archetypeId: true, category: true, customVocabulary: true } },
      sections: { select: { type: true } },
    },
  });

  const vocabulary = getVocabulary(
    config?.archetype?.category,
    config?.archetype?.customVocabulary as Record<string, string> | null,
  );
  const resourceVocab = resolveResourceVocabulary({
    archetypeId: config?.archetype?.archetypeId,
    teamLabel: vocabulary.teamLabel,
  });
  const showAnimals = Boolean(
    config?.sections.some((s) => s.type === "animals-available"),
  );
  // Units tab appears whenever the storefront sells a rental class (a rental
  // archetype's stockable fleet).
  const showUnits = config
    ? (await prisma.storefrontItem.count({
        where: { storefrontId: config.id, ctaType: "rental" },
      })) > 0
    : false;
  // Dispatch board is the field-service surface — only trades-maintenance
  // storefronts assign confirmed bookings to a crew.
  const showDispatch = config?.archetype?.category === "trades-maintenance";
  // Intake is a front-desk care workflow, not a generic storefront concept.
  const showIntake = config?.archetype?.category === "healthcare-wellness";

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        {/* The rail calls this internal management surface "Storefront"; the
            archetype's name for the public site (e.g. "Supporter Hub") is what
            customers see, so it is named here rather than borrowed as the
            heading (EP-2FB6C0CC label truth; BI-1F0B4184). */}
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Storefront</h1>
        <p className="text-sm text-[var(--dpf-muted)]">Manage your public {vocabulary.portalLabel}.</p>
      </div>
      <StorefrontAdminTabNav
        vocabulary={vocabulary}
        showAnimals={showAnimals}
        showUnits={showUnits}
        showDispatch={showDispatch}
        showIntake={showIntake}
        showTables={resourceVocab.hasCapacityResources}
        tablesLabel={resourceVocab.resourceLabel}
      />
      {children}
    </div>
  );
}

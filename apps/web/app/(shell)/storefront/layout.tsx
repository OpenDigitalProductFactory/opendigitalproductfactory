import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
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
      archetype: { select: { category: true, customVocabulary: true } },
      sections: { select: { type: true } },
    },
  });

  const vocabulary = getVocabulary(
    config?.archetype?.category,
    config?.archetype?.customVocabulary as Record<string, string> | null,
  );
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
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{vocabulary.portalLabel}</h1>
      </div>
      <StorefrontAdminTabNav
        vocabulary={vocabulary}
        showAnimals={showAnimals}
        showUnits={showUnits}
        showDispatch={showDispatch}
        showIntake={showIntake}
      />
      {children}
    </div>
  );
}

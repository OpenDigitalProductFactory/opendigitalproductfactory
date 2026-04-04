import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { SetupWizard } from "@/components/storefront-admin/SetupWizard";
import { getSetupContext } from "@/lib/actions/setup-progress";

export default async function StorefrontSetupPage() {
  const existing = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (existing) redirect("/admin/storefront");

  const [archetypes, setupContext] = await Promise.all([
    prisma.storefrontArchetype.findMany({
      where: { isActive: true },
      select: {
        archetypeId: true,
        name: true,
        category: true,
        ctaType: true,
        tags: true,
        itemTemplates: true,
        sectionTemplates: true,
        isBuiltIn: true,
      },
      orderBy: { category: "asc" },
    }),
    getSetupContext(),
  ]);

  return (
    <SetupWizard
      archetypes={archetypes}
      suggestedArchetypeId={setupContext?.suggestedArchetypeId ?? null}
      suggestedArchetypeName={setupContext?.suggestedArchetypeName ?? null}
      archetypeConfidence={setupContext?.archetypeConfidence ?? null}
      suggestedCompanyName={setupContext?.suggestedCompanyName ?? null}
      suggestedCurrency={setupContext?.suggestedCurrency ?? null}
    />
  );
}

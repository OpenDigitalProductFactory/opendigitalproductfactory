import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { SetupWizard } from "@/components/storefront-admin/SetupWizard";
import { getSetupContext } from "@/lib/actions/setup-progress";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveVocabularyKey } from "@/lib/storefront/resolve-vocabulary";

export default async function StorefrontSetupPage() {
  const existing = await prisma.storefrontConfig.findFirst({ select: { id: true } });
  if (existing) redirect("/storefront");

  const [archetypes, setupContext, org, bc] = await Promise.all([
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
    prisma.organization.findFirst({ select: { name: true } }),
    prisma.businessContext.findFirst({ select: { industry: true } }),
  ]);

  // Pre-bootstrap — no archetype yet. Fall back to industry if any.
  const vocab = getVocabulary(
    resolveVocabularyKey({ archetypeCategory: null, industry: bc?.industry }),
  );

  return (
    <SetupWizard
      archetypes={archetypes}
      orgNameFromDb={org?.name ?? null}
      suggestedArchetypeId={setupContext?.suggestedArchetypeId ?? null}
      suggestedArchetypeName={setupContext?.suggestedArchetypeName ?? null}
      archetypeConfidence={setupContext?.archetypeConfidence ?? null}
      suggestedCompanyName={setupContext?.suggestedCompanyName ?? null}
      suggestedCurrency={setupContext?.suggestedCurrency ?? null}
      portalLabel={vocab.portalLabel}
      stakeholderLabel={vocab.stakeholderLabel}
    />
  );
}

import { StorefrontAdminTabNav } from "@/components/storefront-admin/StorefrontAdminTabNav";
import { prisma } from "@dpf/db";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";

export default async function StorefrontAdminLayout({ children }: { children: React.ReactNode }) {
  const config = await prisma.storefrontConfig.findFirst({
    include: { archetype: { select: { category: true, customVocabulary: true } } },
  });

  const vocabulary = getVocabulary(
    config?.archetype?.category,
    config?.archetype?.customVocabulary as Record<string, string> | null,
  );

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{vocabulary.portalLabel}</h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 4 }}>
          Manage your {vocabulary.portalLabel.toLowerCase()}
        </p>
      </div>
      {config && <StorefrontAdminTabNav vocabulary={vocabulary} />}
      {children}
    </div>
  );
}

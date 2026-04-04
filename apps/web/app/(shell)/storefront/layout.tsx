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
      </div>
      <StorefrontAdminTabNav vocabulary={vocabulary} />
      {children}
    </div>
  );
}

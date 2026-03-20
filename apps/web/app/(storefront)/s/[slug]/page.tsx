import { notFound } from "next/navigation";
import { getPublicStorefront } from "@/lib/storefront-data";
import { SectionRenderer } from "@/components/storefront/SectionRenderer";

export default async function StorefrontHomePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const storefront = await getPublicStorefront(slug);
  if (!storefront) notFound();

  return (
    <div>
      {storefront.sections.map((section) => (
        <SectionRenderer
          key={section.id}
          section={section}
          storefront={storefront}
          orgSlug={slug}
        />
      ))}
    </div>
  );
}

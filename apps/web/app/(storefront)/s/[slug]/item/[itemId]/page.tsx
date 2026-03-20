import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { CtaButton } from "@/components/storefront/CtaButton";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const [storefront, item] = await Promise.all([
    getPublicStorefront(slug),
    getPublicItem(slug, itemId),
  ]);

  if (!storefront || !item) notFound();

  return (
    <div style={{ maxWidth: 600, paddingTop: 40 }}>
      {item.imageUrl && (
        <img src={item.imageUrl} alt={item.name}
          style={{ width: "100%", borderRadius: 8, marginBottom: 24 }} />
      )}
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{item.name}</h1>
      {item.description && (
        <p style={{ color: "#374151", lineHeight: 1.75, marginTop: 12 }}>{item.description}</p>
      )}
      <div style={{ marginTop: 24 }}>
        <CtaButton ctaType={item.ctaType} ctaLabel={item.ctaLabel} orgSlug={slug} itemId={item.itemId} />
      </div>
    </div>
  );
}

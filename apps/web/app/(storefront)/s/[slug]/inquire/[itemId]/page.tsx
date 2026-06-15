import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem, resolveInquiryFormSchema } from "@/lib/storefront-data";
import { InquiryForm } from "@/components/storefront/InquiryForm";

export default async function ItemInquirePage({
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

  const formSchema = await resolveInquiryFormSchema(storefront.archetypeId);

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        {item.ctaType === "rental"
          ? `Reserve ${item.name}`
          : item.ctaType === "booking"
          ? `Book ${item.name}`
          : item.ctaType === "donation"
          ? `Donate — ${item.name}`
          : `Enquire about ${item.name}`}
      </h1>
      <p style={{ color: "var(--dpf-muted)", marginBottom: 24, fontSize: 14 }}>{item.description}</p>
      <InquiryForm orgSlug={slug} itemId={itemId} formSchema={formSchema} />
    </div>
  );
}

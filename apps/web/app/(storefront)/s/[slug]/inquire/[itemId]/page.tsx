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

  // A donation appeal may legitimately ask for an amount; nothing else may
  // (BI-7F851119) — an adoption enquiry is not a donation.
  const formSchema = await resolveInquiryFormSchema(storefront.archetypeId, {
    itemCtaType: item.ctaType,
  });

  const CTA_HEADINGS: Record<string, string> = {
    rental: "Reserve",
    inquiry: "Enquire about",
  };
  const headingVerb = item.ctaLabel ?? CTA_HEADINGS[item.ctaType] ?? "Enquire about";

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>{headingVerb} {item.name}</h1>
      <p style={{ color: "var(--dpf-muted)", marginBottom: 24, fontSize: 14 }}>{item.description}</p>
      <InquiryForm orgSlug={slug} itemId={itemId} formSchema={formSchema} />
    </div>
  );
}

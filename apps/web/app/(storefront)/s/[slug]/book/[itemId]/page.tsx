import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem, resolveInquiryFormSchema } from "@/lib/storefront-data";
import { SlotBookingFlow } from "@/components/storefront/SlotBookingFlow";
import { resolveResourceVocabulary } from "@/lib/storefront/resource-vocabulary";

export default async function BookItemPage({
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

  // For a capacity archetype (Restaurant FLOOR), availability reads in table
  // terms; other archetypes keep generic booking copy (BI-7C95A586).
  const resourceVocab = resolveResourceVocabulary({ archetypeId: storefront.archetypeId, teamLabel: "" });
  const resourceNoun = resourceVocab.hasCapacityResources ? resourceVocab.resourceSingular : undefined;

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Book: {item.name}</h1>
      <SlotBookingFlow
        orgSlug={slug}
        itemId={item.itemId}
        itemInternalId={item.id}
        itemName={item.name}
        timezone={storefront.timezone}
        bookingConfig={item.bookingConfig as Record<string, unknown> | null}
        formSchema={formSchema}
        resourceNoun={resourceNoun}
      />
    </div>
  );
}

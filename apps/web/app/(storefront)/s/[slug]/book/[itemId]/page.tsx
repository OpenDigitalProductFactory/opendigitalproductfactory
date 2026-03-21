import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { SlotBookingFlow } from "@/components/storefront/SlotBookingFlow";

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
      />
    </div>
  );
}

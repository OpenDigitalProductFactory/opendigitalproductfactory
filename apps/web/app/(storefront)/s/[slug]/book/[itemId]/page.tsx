import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { BookingForm } from "@/components/storefront/BookingForm";

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

  const bookingConfig = item.bookingConfig as { durationMinutes?: number } | null;
  const durationMinutes = bookingConfig?.durationMinutes ?? 60;

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Book: {item.name}</h1>
      <p style={{ color: "var(--dpf-muted)", marginBottom: 24, fontSize: 14 }}>{durationMinutes} minute appointment</p>
      <BookingForm orgSlug={slug} itemId={item.itemId} itemName={item.name} durationMinutes={durationMinutes} />
    </div>
  );
}

import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { OrderForm } from "@/components/storefront/OrderForm";

export default async function OrderItemPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;
  const [storefront, item] = await Promise.all([
    getPublicStorefront(slug),
    getPublicItem(slug, itemId),
  ]);

  // A purchasable item must exist and carry a real price. Without a price there
  // is nothing to charge, so we 404 rather than render a checkout for £0.
  if (!storefront || !item || item.priceAmount === null) notFound();

  return (
    <div style={{ paddingTop: 40, maxWidth: 520 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Order: {item.name}</h1>
      {item.description && (
        <p style={{ color: "var(--dpf-muted)", marginBottom: 24, fontSize: 14 }}>{item.description}</p>
      )}
      <OrderForm
        orgSlug={slug}
        itemId={item.itemId}
        itemName={item.name}
        unitPrice={Number(item.priceAmount)}
        currency={item.priceCurrency}
      />
    </div>
  );
}

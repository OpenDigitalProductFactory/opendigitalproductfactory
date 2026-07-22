import { notFound } from "next/navigation";
import { getPublicStorefront, getPublicItem } from "@/lib/storefront-data";
import { OrderForm } from "@/components/storefront/OrderForm";
import { StorefrontUnavailable } from "@/components/storefront/StorefrontUnavailable";

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

  if (!storefront) notFound();

  // A purchasable item must exist and carry a real price — there is nothing to
  // charge for a £0 "order". Rather than dead-end a customer on the internal 404,
  // recover them into the storefront with a clear, business-safe message.
  if (!item || item.priceAmount === null) {
    return (
      <StorefrontUnavailable
        orgSlug={slug}
        orgName={storefront.orgName}
        title="Online ordering isn't available"
        message={`This item can't be ordered online right now at ${storefront.orgName}. Browse what's available, or send us a message and we'll help.`}
      />
    );
  }

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

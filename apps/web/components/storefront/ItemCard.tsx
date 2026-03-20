import type { PublicItem } from "@/lib/storefront-types";
import { CtaButton } from "./CtaButton";

const PRICE_TYPE_LABELS: Record<string, string> = {
  fixed: "",
  from: "From ",
  "per-hour": "/hr",
  "per-session": "/session",
  free: "Free",
  donation: "Donation",
  quote: "POA",
};

function formatPrice(item: PublicItem): string | null {
  if (!item.priceAmount && item.priceType === "free") return "Free";
  if (!item.priceAmount && item.priceType === "quote") return "POA";
  if (!item.priceAmount && item.priceType === "donation") return "Donation";
  if (!item.priceAmount) return null;
  const prefix = PRICE_TYPE_LABELS[item.priceType ?? ""] ?? "";
  const suffix = item.priceType === "per-hour" ? "/hr"
    : item.priceType === "per-session" ? "/session" : "";
  return `${prefix}${item.priceCurrency === "GBP" ? "£" : item.priceCurrency}${item.priceAmount}${suffix}`;
}

export function ItemCard({ item, orgSlug }: { item: PublicItem; orgSlug: string }) {
  const priceDisplay = formatPrice(item);

  return (
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: 8,
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      {item.imageUrl && (
        <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 4 }} />
      )}
      <div style={{ fontWeight: 600, fontSize: 16, color: "#111827" }}>{item.name}</div>
      {item.description && (
        <div style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.5 }}>{item.description}</div>
      )}
      {priceDisplay && (
        <div style={{ fontSize: 15, fontWeight: 700, color: "#111827" }}>{priceDisplay}</div>
      )}
      <div style={{ marginTop: "auto", paddingTop: 8 }}>
        <CtaButton ctaType={item.ctaType} ctaLabel={item.ctaLabel} orgSlug={orgSlug} itemId={item.itemId} />
      </div>
    </div>
  );
}

import type { PublicItem } from "@/lib/storefront-types";
import { CtaButton } from "./CtaButton";

// prefix: text before currency symbol; suffix: unit after amount
const PRICE_PREFIX: Record<string, string> = { from: "From " };
const PRICE_SUFFIX: Record<string, string> = {
  "per-hour": "/hr",
  "per-session": "/session",
};

function formatPrice(item: PublicItem): string | null {
  if (!item.priceAmount && item.priceType === "free") return "Free";
  if (!item.priceAmount && item.priceType === "quote") return "POA";
  if (!item.priceAmount && item.priceType === "donation") return "Donation";
  if (!item.priceAmount) return null;
  const prefix = PRICE_PREFIX[item.priceType ?? ""] ?? "";
  const suffix = PRICE_SUFFIX[item.priceType ?? ""] ?? "";
  const currency = item.priceCurrency === "GBP" ? "£" : item.priceCurrency;
  return `${prefix}${currency}${item.priceAmount}${suffix}`;
}

export function ItemCard({ item, orgSlug }: { item: PublicItem; orgSlug: string }) {
  const priceDisplay = formatPrice(item);

  return (
    <div style={{
      border: "1px solid var(--dpf-border)",
      borderRadius: 8,
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      {item.imageUrl && (
        <img src={item.imageUrl} alt={item.name} style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 4 }} />
      )}
      <div style={{ fontWeight: 600, fontSize: 16, color: "var(--dpf-text)" }}>{item.name}</div>
      {item.description && (
        <div style={{ fontSize: 13, color: "var(--dpf-muted)", lineHeight: 1.5 }}>{item.description}</div>
      )}
      {priceDisplay && (
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dpf-text)" }}>{priceDisplay}</div>
      )}
      <div style={{ marginTop: "auto", paddingTop: 8 }}>
        <CtaButton ctaType={item.ctaType} ctaLabel={item.ctaLabel} orgSlug={orgSlug} itemId={item.itemId} />
      </div>
    </div>
  );
}

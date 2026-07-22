import type { PublicItem } from "@/lib/storefront-types";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import { CtaButton } from "./CtaButton";
import { MediaImage } from "./MediaImage";

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
  if (!item.priceAmount && item.priceType === "from") return "From...";
  if (!item.priceAmount && item.priceType === "per-hour") return "Per hour";
  if (!item.priceAmount && item.priceType === "per-session") return "Per session";
  if (!item.priceAmount) return null;
  const prefix = PRICE_PREFIX[item.priceType ?? ""] ?? "";
  const suffix = PRICE_SUFFIX[item.priceType ?? ""] ?? "";
  const currency = getCurrencySymbol(item.priceCurrency);
  return `${prefix}${currency}${item.priceAmount}${suffix}`;
}

export function ItemCard({ item, orgSlug }: { item: PublicItem; orgSlug: string }) {
  const priceDisplay = formatPrice(item);
  // Show an image (or a generated placeholder) for catalogue-style items where a
  // photo is expected; for booking/inquiry/donation items only when one exists,
  // so we don't stamp a placeholder onto every "Make a donation" tile.
  const showImage =
    Boolean(item.imageUrl) || item.ctaType === "purchase" || item.ctaType === "rental";

  return (
    <div style={{
      border: "1px solid var(--dpf-border)",
      borderRadius: 8,
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 8,
    }}>
      {showImage && <MediaImage src={item.imageUrl} alt={item.name} height={160} />}
      <div style={{ fontWeight: 600, fontSize: 16, color: "var(--dpf-text)" }}>{item.name}</div>
      {item.description && (
        <div style={{ fontSize: 13, color: "var(--dpf-muted)", lineHeight: 1.5 }}>{item.description}</div>
      )}
      {priceDisplay && (
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--dpf-text)" }}>{priceDisplay}</div>
      )}
      <div style={{ marginTop: "auto", paddingTop: 8 }}>
        <CtaButton ctaType={item.ctaType} ctaLabel={item.ctaLabel} orgSlug={orgSlug} itemId={item.itemId} priceAmount={item.priceAmount} itemName={item.name} />
      </div>
    </div>
  );
}

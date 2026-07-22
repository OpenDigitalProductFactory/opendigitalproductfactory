import Link from "next/link";
import { DEFAULT_CTA_LABELS } from "@/lib/storefront/cta-labels";

export function CtaButton({
  ctaType,
  ctaLabel,
  orgSlug,
  itemId,
  priceAmount,
  itemName,
}: {
  ctaType: string;
  ctaLabel: string | null;
  orgSlug: string;
  itemId: string;
  /** Decimal amount as a string (Prisma Decimal serializes to string), or null. */
  priceAmount?: string | null;
  /** Item name — used to give repeated CTAs an item-specific accessible name. */
  itemName?: string;
}) {
  // A "purchase" item with no price has nothing to charge — the order route
  // (/s/[slug]/order/[itemId]) 404s when priceAmount is null. Rather than render
  // a Buy button that dead-ends, fall back to the inquiry flow so the customer
  // gets a working "Enquire" CTA (AUDIT-R3/R4). Operators can set a price later
  // to restore the Buy flow.
  const isPricelessPurchase =
    ctaType === "purchase" && (priceAmount === null || priceAmount === undefined);
  const effectiveCtaType = isPricelessPurchase ? "inquiry" : ctaType;

  // Drop a stale purchase-oriented custom label when downgrading so we don't
  // show "Buy" on a button that now routes to the inquiry form.
  const label =
    (isPricelessPurchase ? null : ctaLabel) ?? DEFAULT_CTA_LABELS[effectiveCtaType] ?? "Get in Touch";

  const href =
    effectiveCtaType === "booking" ? `/s/${orgSlug}/book/${itemId}`
    : effectiveCtaType === "purchase" ? `/s/${orgSlug}/order/${itemId}`
    : effectiveCtaType === "donation" ? `/s/${orgSlug}/donate`
    : `/s/${orgSlug}/inquire/${itemId}`;

  // A storefront home lists the same "Book Now" label on every card; give each
  // link an item-specific accessible name (e.g. "Book Now: Table for 2") so
  // screen-reader users can tell the repeated actions apart.
  const accessibleName = itemName ? `${label}: ${itemName}` : undefined;

  return (
    <Link
      href={href}
      {...(accessibleName ? { "aria-label": accessibleName } : {})}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 44,
        padding: "10px 20px",
        background: "var(--dpf-accent, #4f46e5)",
        color: "var(--dpf-text)",
        borderRadius: 6,
        fontSize: 15,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}

/**
 * Default customer-facing CTA button labels, keyed by `ctaType`.
 *
 * Single source of truth shared by the public storefront CTA ({@link CtaButton})
 * and the admin item editor's "Button label" placeholder (`ItemFormDialog`), so
 * the placeholder an operator sees always reflects what the storefront will
 * actually render when no custom label is set.
 *
 * Before this was shared, the admin form advertised its own nicer defaults
 * (inquiry -> "Get a quote") while the storefront rendered different ones
 * (inquiry -> "Enquire"). An operator who applied an archetype saw "Get a quote"
 * in the editor placeholder and reasonably expected it on the card, but the card
 * showed "Enquire" — reported as R9-CAT-001 (a phantom "stored label ignored"
 * bug; the label was never stored, the placeholder just lied). Keep these two
 * surfaces honest by reading the same map.
 *
 * An item's own `ctaLabel` always wins; this map is only the fallback.
 */
export const DEFAULT_CTA_LABELS: Record<string, string> = {
  booking: "Book Now",
  purchase: "Buy",
  inquiry: "Enquire",
  donation: "Donate",
  rental: "Reserve",
};

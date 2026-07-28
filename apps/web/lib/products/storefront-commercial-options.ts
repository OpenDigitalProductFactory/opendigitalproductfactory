export const STOREFRONT_CTA_OPTIONS = [
  { value: "booking", label: "Booking" },
  { value: "purchase", label: "Purchase" },
  { value: "rental", label: "Rental" },
  { value: "inquiry", label: "Inquiry" },
  { value: "donation", label: "Donation" },
] as const;

export type StorefrontCtaType =
  (typeof STOREFRONT_CTA_OPTIONS)[number]["value"];

type CommercialOption = Readonly<{ value: string; label: string }>;

export const STOREFRONT_PRICE_TYPE_OPTIONS: Record<
  StorefrontCtaType,
  readonly CommercialOption[]
> = {
  booking: [
    { value: "per-hour", label: "Per hour" },
    { value: "per-session", label: "Per session" },
    { value: "fixed", label: "Fixed price" },
    { value: "free", label: "Free" },
  ],
  purchase: [
    { value: "fixed", label: "Fixed price" },
    { value: "from", label: "From (minimum)" },
  ],
  rental: [
    { value: "per-session", label: "Per rental period" },
    { value: "per-hour", label: "Per hour" },
    { value: "fixed", label: "Fixed price" },
    { value: "from", label: "From (minimum)" },
    { value: "free", label: "Free" },
  ],
  inquiry: [
    { value: "quote", label: "Request a quote" },
    { value: "from", label: "From (starting at)" },
    { value: "per-hour", label: "Per hour" },
    { value: "fixed", label: "Fixed price" },
  ],
  donation: [{ value: "donation", label: "Any amount" }],
};

export const STOREFRONT_CTA_FULFILLMENT_ROUTES: Partial<
  Record<StorefrontCtaType, string>
> = {
  booking: "booking",
  purchase: "direct-purchase",
  rental: "reservation",
};

export function storefrontPriceOptions(ctaType: string) {
  return STOREFRONT_PRICE_TYPE_OPTIONS[ctaType as StorefrontCtaType] ?? [];
}

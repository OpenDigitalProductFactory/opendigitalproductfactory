// What a public enquiry form is allowed to ask (BI-7F851119).
//
// `StorefrontArchetype.formSchema` is the *contact* form schema, and it is the
// only inbound channel a storefront has. Five nonprofit archetypes were seeded
// with a donation form in that slot, which put a required "Donation amount" in
// front of every reason a stranger writes in — an adoption enquiry, a found-pet
// report, a surrender request, an offer to volunteer. A donation prompt in front
// of a found-pet report is the worst failure available to a rescue.
//
// Donations already have their own route and their own form
// (`/s/[slug]/donate` -> `DonationForm`), so donation fields belong on an
// enquiry only when the enquiry is about a donation item.
//
// Dependency-free (no prisma, no React) so the rule is unit-testable on its own,
// matching the `slot-booking-fields.ts` precedent.

/** Fields that only mean something when money is being given. Matched
 *  case-, separator- and whitespace-insensitively, so `donation-amount`,
 *  `Donation Amount` and `donationAmount` all resolve to the same field. */
export const DONATION_ONLY_FIELD_NAMES: ReadonlySet<string> = new Set([
  "donationamount",
  "customamount",
  "campaignid",
  "isanonymous",
]);

function canonicalFieldName(name: string): string {
  return name.toLowerCase().replace(/[-_\s]/g, "");
}

/** True when a field asks about a donation rather than about the enquiry. Pure. */
export function isDonationOnlyField(name: string): boolean {
  return DONATION_ONLY_FIELD_NAMES.has(canonicalFieldName(name));
}

/** The fields a public enquiry form should render. Donation fields survive only
 *  when the enquiry is about a donation item; on the site-wide contact form and
 *  on an enquiry about anything else they are dropped, so no inbound channel can
 *  require a payment before it will accept a message. Pure. */
export function inquiryFieldsForItem<T extends { name: string }>(
  fields: readonly T[],
  { itemCtaType }: { itemCtaType?: string | null } = {},
): T[] {
  if (itemCtaType === "donation") return [...fields];
  return fields.filter((field) => !isDonationOnlyField(field.name));
}

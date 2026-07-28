// The critical business journeys this platform watches.
// Spec: docs/superpowers/specs/2026-07-28-critical-business-journey-watchdog-design.md
//
// Every `outcome` string is written for the business owner, not the engineer.
// The owner reads "New customers can't send you an enquiry", never "inquiry
// probe step 2 failed" — the mechanism lives in the evidence, behind the
// technical-details boundary.
//
// Adding a journey: give it an owner-language outcome, an honest
// `appliesWhen` so installs without the capability are `not-applicable` rather
// than red, and order its steps cheapest-first.

import {
  bookingDataPathProbe,
  contractProbe,
  inquiryDataPathProbe,
  reachabilityProbe,
} from "./probes";
import type { InstallJourneyContext, JourneyDefinition } from "./types";

const storefrontPath = (ctx: InstallJourneyContext, suffix = ""): string | null =>
  ctx.organizationSlug ? `/s/${ctx.organizationSlug}${suffix}` : null;

export const BUSINESS_JOURNEYS: readonly JourneyDefinition[] = [
  {
    journeyId: "storefront-enquiry",
    outcome: "New customers can send you an enquiry",
    businessImpact:
      "If this is down, people who want to hire you fill in the form and nothing reaches you. You never find out you lost the work.",
    revenueBearing: true,
    appliesWhen: (ctx) => ctx.storefrontPublished && ctx.hasInquirySurface,
    notApplicableReason:
      "This install has no published enquiry surface, so there is nothing for a customer to send.",
    steps: [
      {
        stepId: "enquiry-page-loads",
        label: "The enquiry page opens",
        depth: "reachability",
        run: reachabilityProbe((ctx) => storefrontPath(ctx, "/inquire")),
      },
      {
        stepId: "enquiry-setup-complete",
        label: "The enquiry setup is complete",
        depth: "contract",
        run: contractProbe(
          (ctx) => ({
            ok: ctx.storefrontPublished && ctx.hasInquirySurface,
            expected: "a published storefront with at least one active enquiry item",
            actual: `published=${ctx.storefrontPublished} enquiryItems=${ctx.hasInquirySurface}`,
          }),
          "The storefront is published and has somewhere to enquire from.",
          "The enquiry setup is incomplete, so the form has nothing to attach an enquiry to.",
        ),
      },
      {
        stepId: "enquiry-record-creatable",
        label: "An enquiry can actually be recorded",
        depth: "data-path",
        run: inquiryDataPathProbe,
      },
    ],
  },
  {
    journeyId: "storefront-booking",
    outcome: "Customers can book a time with you",
    businessImpact:
      "If this is down, customers cannot reserve a slot — and if double-booking protection has lapsed, two customers can be promised the same time.",
    revenueBearing: true,
    appliesWhen: (ctx) => ctx.storefrontPublished && ctx.bookableItemId !== null,
    notApplicableReason: "This install has no bookable service, so there is no time to book.",
    steps: [
      {
        stepId: "booking-page-loads",
        label: "The booking page opens",
        depth: "reachability",
        run: reachabilityProbe((ctx) =>
          ctx.bookableItemId ? storefrontPath(ctx, `/book/${ctx.bookableItemId}`) : null,
        ),
      },
      {
        stepId: "booking-setup-complete",
        label: "The booking setup is complete",
        depth: "contract",
        run: contractProbe(
          (ctx) => ({
            ok: ctx.storefrontPublished && ctx.bookableItemId !== null,
            expected: "a published storefront with at least one active bookable item",
            actual: `published=${ctx.storefrontPublished} bookableItem=${ctx.bookableItemId ?? "none"}`,
          }),
          "The storefront is published and has a bookable service.",
          "There is no active bookable service for a customer to choose.",
        ),
      },
      {
        stepId: "booking-record-creatable",
        label: "A booking can be recorded and double-booking is prevented",
        depth: "data-path",
        run: bookingDataPathProbe,
      },
    ],
  },
  {
    journeyId: "storefront-front-door",
    outcome: "Customers can find your business online",
    businessImpact:
      "If this is down, every link you have ever shared — search results, your card, your van — leads nowhere.",
    revenueBearing: true,
    appliesWhen: (ctx) => ctx.storefrontPublished,
    notApplicableReason: "This install has no published storefront yet.",
    steps: [
      {
        stepId: "front-door-loads",
        label: "Your public page opens",
        depth: "reachability",
        run: reachabilityProbe((ctx) => storefrontPath(ctx)),
      },
      {
        stepId: "front-door-published",
        label: "Your page is published",
        depth: "contract",
        run: contractProbe(
          (ctx) => ({
            ok: ctx.storefrontPublished && ctx.archetypeIds.length > 0,
            expected: "a published storefront with a configured line of business",
            actual: `published=${ctx.storefrontPublished} lines=${ctx.archetypeIds.length}`,
          }),
          "Your page is published and has a configured line of business.",
          "Your page is not fully set up, so visitors may see an empty or broken page.",
        ),
      },
    ],
  },
  {
    journeyId: "customer-sign-in",
    outcome: "Existing customers can sign in to their account",
    businessImpact:
      "If this is down, returning customers cannot see their bookings, invoices, or history — and they call you instead.",
    revenueBearing: false,
    appliesWhen: (ctx) => ctx.storefrontPublished,
    notApplicableReason:
      "This install has no published customer-facing surface, so there is no customer account to sign in to.",
    steps: [
      {
        stepId: "sign-in-page-loads",
        label: "The sign-in page opens",
        depth: "reachability",
        run: reachabilityProbe(() => "/customer-login"),
      },
    ],
  },
  {
    journeyId: "storefront-checkout",
    outcome: "Customers can pay you online",
    businessImpact: "If this is down, customers who are ready to buy cannot complete the purchase.",
    revenueBearing: true,
    appliesWhen: (ctx) => ctx.storefrontPublished && ctx.hasPaymentConfiguration,
    notApplicableReason:
      "This install does not sell anything priced online, so there is nothing to pay for.",
    steps: [
      {
        stepId: "checkout-page-loads",
        label: "The checkout page opens",
        depth: "reachability",
        run: reachabilityProbe((ctx) => storefrontPath(ctx, "/checkout")),
      },
      {
        stepId: "checkout-setup-complete",
        label: "There is something priced to buy",
        depth: "contract",
        run: contractProbe(
          (ctx) => ({
            ok: ctx.hasPaymentConfiguration,
            expected: "at least one active item with a price",
            actual: "no active priced item was found",
          }),
          "There is at least one priced item a customer can buy.",
          "Nothing is priced for sale, so checkout has nothing to charge for.",
        ),
      },
    ],
  },
];

/** Journeys that apply to THIS install. The rest are reported `not-applicable`. */
export function applicableJourneys(
  ctx: InstallJourneyContext,
  journeys: readonly JourneyDefinition[] = BUSINESS_JOURNEYS,
): JourneyDefinition[] {
  return journeys.filter((j) => j.appliesWhen(ctx));
}

export function journeyById(journeyId: string): JourneyDefinition | undefined {
  return BUSINESS_JOURNEYS.find((j) => j.journeyId === journeyId);
}

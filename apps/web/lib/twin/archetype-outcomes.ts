import type { TwinOutcome } from "@/components/twin";
import { formatMoney } from "@/lib/org-locale/org-locale";

/** Gifts recorded in one currency. Several of these means the org genuinely
 *  holds more than one, and each is shown rather than none. */
export interface DonationTotal {
  currency: string;
  amount: number;
  count: number;
}

export interface ArchetypeOutcomeInput {
  archetypeId: string;
  currency: string;
  locale: string;
  paidRevenue: number;
  deliveredJobs: number;
  /** One entry per currency the gifts were recorded in. `null` means the
   *  donation source could not be read at all; `[]` means no gifts yet. */
  donationTotals?: DonationTotal[] | null;
  animalsPlaced?: number | null;
  fostersActive?: number | null;
}

export interface ArchetypeOutcomeProjection {
  heading: string;
  outcomes: TwinOutcome[];
}

function countValue(count: number | null | undefined, noun: string): string {
  if (count == null) return "Unavailable";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function giftCount(count: number): string {
  return `${count} gift${count === 1 ? "" : "s"} · 90 days`;
}

/**
 * The tile withheld a total it already held: two gifts in one currency read
 * "Unavailable · Multiple donation currencies are not combined" (BI-685ADDCD).
 * One currency totals, whichever currency it is. Several are shown side by
 * side rather than replaced by nothing — an operator who really does hold two
 * currencies still gets both numbers, just never added together.
 */
function donationsOutcome(input: ArchetypeOutcomeInput): TwinOutcome {
  const totals = input.donationTotals;
  const money = (total: DonationTotal) =>
    formatMoney(total.amount, total.currency, input.locale);

  if (totals == null) {
    return {
      key: "donations-received",
      label: "Donations received",
      value: "Unavailable",
      intent: "success",
      hint: "Donation source unavailable",
    };
  }

  if (totals.length > 1) {
    return {
      key: "donations-received",
      label: "Donations received",
      value: totals.map(money).join(" · "),
      intent: "success",
      hint: `${giftCount(totals.reduce((sum, total) => sum + total.count, 0))} · kept apart by currency`,
    };
  }

  // No gifts yet reads as the workspace's own zero, the way it always has.
  const only = totals[0];
  return {
    key: "donations-received",
    label: "Donations received",
    value: only ? money(only) : formatMoney(0, input.currency, input.locale),
    intent: "success",
    hint: giftCount(only?.count ?? 0),
  };
}

/**
 * Project canonical aggregates into the archetype's outcome language. This is
 * intentionally a small presentation boundary, not a general metric framework:
 * each value must already have a real source, and missing sources stay visible.
 */
export function buildArchetypeOutcomes(
  input: ArchetypeOutcomeInput,
): ArchetypeOutcomeProjection {
  if (input.archetypeId === "pet-rescue" || input.archetypeId === "animal-shelter") {
    return {
      heading: "Mission impact",
      outcomes: [
        donationsOutcome(input),
        {
          key: "animals-placed",
          label: "Animals placed",
          value: countValue(input.animalsPlaced, "animal"),
          intent: "success",
          hint: input.animalsPlaced == null ? "Adoption source unavailable" : "Adopted · 90 days",
        },
        {
          key: "fosters-active",
          label: "Fosters active",
          value: countValue(input.fostersActive, "foster"),
          intent: "info",
          hint:
            input.fostersActive == null
              ? "No foster record source yet"
              : "Active foster homes",
        },
      ],
    };
  }

  return {
    heading: "Delivered",
    outcomes: [
      {
        key: "revenue",
        label: "Revenue in",
        value: formatMoney(input.paidRevenue, input.currency, input.locale),
        intent: "success",
        hint: "Paid · 90 days",
      },
      {
        key: "delivered",
        label: "Delivered",
        value: `${input.deliveredJobs} job${input.deliveredJobs === 1 ? "" : "s"}`,
        intent: "info",
        hint: "Settled & paid",
      },
    ],
  };
}

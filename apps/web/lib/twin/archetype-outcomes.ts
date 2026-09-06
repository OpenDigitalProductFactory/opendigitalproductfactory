import type { TwinOutcome } from "@/components/twin";
import { formatMoney } from "@/lib/org-locale/org-locale";

/** Gifts recorded in one currency. Several of these means the org genuinely
 *  holds more than one, and each is shown rather than none. */
export interface DonationTotal {
  currency: string;
  amount: number;
  count: number;
}

/** The population physically in the shelter right now, split by the status
 *  staff act on. Adopted animals are an outcome, not a population, so they are
 *  not counted here. */
export interface AnimalsInCare {
  total: number;
  onHold: number;
  available: number;
  pending: number;
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
  /** `null` means the animal source could not be read; a zero total means an
   *  empty shelter, which is a real and different answer. */
  animalsInCare?: AnimalsInCare | null;
  /** Housing the shelter has recorded. `null` means none has been recorded at
   *  all, which is a different answer from having none free. */
  kennelCapacity?: { total: number; free: number; occupied: number; outOfService: number } | null;
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
 * The subject of the business leads. A rescue cockpit counted its workforce,
 * its coworkers and its programs and never said how many animals were in the
 * building (BI-E54F7F87) — so this is the first tile, before any money.
 */
function animalsInCareOutcome(inCare: AnimalsInCare | null | undefined): TwinOutcome {
  if (inCare == null) {
    return {
      key: "animals-in-care",
      label: "Animals in care",
      value: "Unavailable",
      intent: "info",
      hint: "Animal source unavailable",
    };
  }

  // Name only the statuses actually present: "5 on hold · 1 available" reads,
  // and a row of zeroes does not.
  const split = [
    { count: inCare.onHold, label: "on hold" },
    { count: inCare.available, label: "available" },
    { count: inCare.pending, label: "pending" },
  ]
    .filter((part) => part.count > 0)
    .map((part) => `${part.count} ${part.label}`);

  return {
    key: "animals-in-care",
    label: "Animals in care",
    value: `${inCare.total} animal${inCare.total === 1 ? "" : "s"}`,
    intent: "info",
    hint: split.length > 0 ? split.join(" · ") : "None in care",
  };
}

/**
 * The 16:00 question the operating day could not answer: how many kennels are
 * free. A shelter that has recorded no housing has not answered "none free" —
 * it has not been asked yet — so the two states never render the same.
 */
function kennelsOutcome(
  capacity: ArchetypeOutcomeInput["kennelCapacity"],
): TwinOutcome {
  if (capacity == null) {
    return {
      key: "kennels-free",
      label: "Kennels",
      value: "Not recorded",
      intent: "info",
      hint: "No housing recorded yet",
    };
  }

  const detail = [`${capacity.occupied} occupied`];
  if (capacity.outOfService > 0) detail.push(`${capacity.outOfService} out of service`);

  return {
    key: "kennels-free",
    label: "Kennels",
    value: `${capacity.free} free`,
    intent: capacity.free === 0 ? "warning" : "success",
    hint: `${detail.join(" · ")} of ${capacity.total}`,
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
        animalsInCareOutcome(input.animalsInCare),
        kennelsOutcome(input.kennelCapacity),
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

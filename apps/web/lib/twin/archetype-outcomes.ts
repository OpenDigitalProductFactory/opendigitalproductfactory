import type { TwinOutcome } from "@/components/twin";
import { formatMoney } from "@/lib/org-locale/org-locale";

export interface ArchetypeOutcomeInput {
  archetypeId: string;
  currency: string;
  locale: string;
  paidRevenue: number;
  deliveredJobs: number;
  donations?: { amount: number; count: number } | null;
  donationsUnavailableHint?: string;
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
        {
          key: "donations-received",
          label: "Donations received",
          value:
            input.donations == null
              ? "Unavailable"
              : formatMoney(input.donations.amount, input.currency, input.locale),
          intent: "success",
          hint:
            input.donations == null
              ? input.donationsUnavailableHint ?? "Donation source unavailable"
              : `${input.donations.count} gift${input.donations.count === 1 ? "" : "s"} · 90 days`,
        },
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

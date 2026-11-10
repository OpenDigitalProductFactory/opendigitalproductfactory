import { loadCanonicalAnimalPopulation, countCanonicalAdoptions, type AnimalOperatingFactsClient } from "@/lib/animal-welfare/operating-facts";
import { summarizeCanonicalAnimalPopulation } from "@dpf/storefront-templates/operations";
import { can, type UserContext } from "@/lib/permissions";
import { moneyToNumber } from "./operations-format";
import {
  buildArchetypeOutcomes,
  type AnimalsInCare,
  type DonationTotal,
} from "./archetype-outcomes";
import { summarizeKennelCapacity } from "@/lib/ward/ward-occupancy";
import { loadWardBoard, type WardStoreClient } from "@/lib/ward/ward-store";

type FindMany = (args: unknown) => Promise<unknown>;
type Money = number | string | { toString(): string } | null;

export interface ArchetypeOutcomeFactsClient extends AnimalOperatingFactsClient {
  storefrontDonation?: { findMany: FindMany };
}

interface OutcomeFactsRuntime {
  read<T>(source: string, operation: Promise<T>, fallback: T): Promise<T>;
  unavailable(source: string): void;
}

interface DonationRow {
  amount: Money;
  currency: string;
}

export interface ArchetypeOutcomeFacts {
  /** `null` when no housing is recorded — never rendered as "0 free". */
  kennelCapacity: ReturnType<typeof summarizeKennelCapacity>;
  kennelSourceUnavailable: boolean;
  donationRows: DonationRow[] | null;
  animalsInCare: AnimalsInCare | null;
  adoptionOutcomes: number | null;
}

function isRescue(archetypeId: string): boolean {
  return archetypeId === "pet-rescue" || archetypeId === "animal-shelter";
}

/** Load only the leaf-archetype facts that have canonical records. */
export async function loadArchetypeOutcomeFacts(input: {
  archetypeId: string;
  storefrontId: string;
  /** Absent on a caller that cannot resolve it; capacity then reads as
   *  unrecorded rather than as a confident zero. */
  organizationId?: string | null;
  viewer?: UserContext;
  since: Date;
  db: ArchetypeOutcomeFactsClient;
  runtime: OutcomeFactsRuntime;
}): Promise<ArchetypeOutcomeFacts> {
  if (!isRescue(input.archetypeId)) {
    return { kennelCapacity: null, kennelSourceUnavailable: false, donationRows: null, animalsInCare: null, adoptionOutcomes: null };
  }

  const [donationRows, population, adoptionOutcomes] = await Promise.all([
    input.db.storefrontDonation?.findMany
      ? input.runtime.read(
          "donations",
          input.db.storefrontDonation.findMany({
            where: {
              storefrontId: input.storefrontId,
              createdAt: { gte: input.since },
            },
            select: { amount: true, currency: true },
          }) as Promise<DonationRow[]>,
          null,
        )
      : (input.runtime.unavailable("donations"), Promise.resolve(null)),
    input.organizationId && input.viewer && can(input.viewer, "view_animal_welfare")
      ? input.runtime.read("animals-in-care", loadCanonicalAnimalPopulation(input.db, input.organizationId), null)
      : (input.runtime.unavailable("animals-in-care"), Promise.resolve(null)),
    input.organizationId && input.viewer && can(input.viewer, "view_animal_welfare")
      ? input.runtime.read("adoptions", countCanonicalAdoptions(input.db, input.organizationId, input.since), null)
      : (input.runtime.unavailable("adoptions"), Promise.resolve(null)),
  ]);

  // Housing is org-scoped, not storefront-scoped: a kennel is not a listing.
  const housing = input.organizationId && input.viewer && can(input.viewer, "view_animal_welfare")
    ? await input.runtime.read(
        "kennels",
        loadWardBoard({
          organizationId: input.organizationId,
          db: input.db as unknown as WardStoreClient,
        }).then((board) => ({ board })),
        null,
      )
    : (input.runtime.unavailable("kennels"), null);

  return {
    kennelCapacity: summarizeKennelCapacity(housing?.board ?? null),
    kennelSourceUnavailable: housing == null,
    donationRows,
    animalsInCare: summarizeCanonicalAnimalPopulation(population),
    adoptionOutcomes,
  };
}

/**
 * Total the gifts per currency. Currencies are never added together — a
 * headline that silently combined them would be a plausible wrong number, and
 * that is the failure this refusal exists to prevent.
 *
 * What it must not do is refuse when there is nothing to refuse. This counted
 * ROWS, not currencies: `matching.length !== rows.length` is true whenever the
 * gifts are in a currency other than the workspace's, so a rescue whose two
 * gifts were both stamped GBP on a USD install read "Multiple donation
 * currencies are not combined" and showed no number at all (BI-685ADDCD). One
 * currency is one currency wherever it came from, and it totals.
 *
 * A row with no currency recorded belongs to the workspace's own — the column
 * carries a default and the donate page only ever offered one symbol.
 */
export function summarizeDonations(
  rows: DonationRow[] | null,
  currency: string,
): { totals: DonationTotal[] | null } {
  if (rows == null) return { totals: null };

  const byCurrency = new Map<string, DonationTotal>();
  for (const row of rows) {
    const code = row.currency?.trim() ? row.currency.trim() : currency;
    const running = byCurrency.get(code) ?? { currency: code, amount: 0, count: 0 };
    running.amount += moneyToNumber(row.amount);
    running.count += 1;
    byCurrency.set(code, running);
  }

  // Largest first, so a genuine mix leads with the currency carrying the money.
  return { totals: [...byCurrency.values()].sort((a, b) => b.amount - a.amount) };
}

/** Join source facts to the pure presentation projection at one boundary. */
export function buildOutcomeProjectionFromFacts(input: {
  archetypeId: string;
  currency: string;
  locale: string;
  paidRevenue: number;
  deliveredJobs: number | null;
  facts: ArchetypeOutcomeFacts;
}) {
  const donations = summarizeDonations(input.facts.donationRows, input.currency);
  return buildArchetypeOutcomes({
    archetypeId: input.archetypeId,
    currency: input.currency,
    locale: input.locale,
    paidRevenue: input.paidRevenue,
    deliveredJobs: input.deliveredJobs,
    donationTotals: donations.totals,
    animalsInCare: input.facts.animalsInCare,
    kennelCapacity: input.facts.kennelCapacity,
    kennelSourceUnavailable: input.facts.kennelSourceUnavailable,
    adoptionOutcomes: input.facts.adoptionOutcomes,
    // There is no governed foster entity yet. Preserve that fact in the UI.
    fostersActive: null,
  });
}

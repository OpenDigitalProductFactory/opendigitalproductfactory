import { moneyToNumber } from "./operations-format";
import {
  buildArchetypeOutcomes,
  type AnimalsInCare,
  type DonationTotal,
} from "./archetype-outcomes";
import { summarizeKennelCapacity } from "@/lib/ward/ward-occupancy";
import { loadWardBoard, type WardStoreClient } from "@/lib/ward/ward-store";

type FindMany = (args: unknown) => Promise<unknown>;
type Count = (args: unknown) => Promise<number>;
type GroupBy = (args: unknown) => Promise<AnimalStatusGroup[]>;
type Money = number | string | { toString(): string } | null;

export interface ArchetypeOutcomeFactsClient {
  storefrontDonation?: { findMany: FindMany };
  adoptableAnimal?: { count: Count; groupBy?: GroupBy };
}

/** One `status` bucket from a grouped count of the storefront's animals. */
export interface AnimalStatusGroup {
  status: string | null;
  _count: { _all: number };
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
  donationRows: DonationRow[] | null;
  animalStatusRows: AnimalStatusGroup[] | null;
  animalsPlaced: number | null;
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
  since: Date;
  db: ArchetypeOutcomeFactsClient;
  runtime: OutcomeFactsRuntime;
}): Promise<ArchetypeOutcomeFacts> {
  if (!isRescue(input.archetypeId)) {
    return { kennelCapacity: null, donationRows: null, animalStatusRows: null, animalsPlaced: null };
  }

  const [donationRows, animalStatusRows, animalsPlaced] = await Promise.all([
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
    input.db.adoptableAnimal?.groupBy
      ? input.runtime.read(
          "animals-in-care",
          input.db.adoptableAnimal.groupBy({
            by: ["status"],
            where: { storefrontId: input.storefrontId },
            _count: { _all: true },
          }),
          null,
        )
      : (input.runtime.unavailable("animals-in-care"), Promise.resolve(null)),
    input.db.adoptableAnimal?.count
      ? input.runtime.read(
          "adoptions",
          input.db.adoptableAnimal.count({
            where: {
              storefrontId: input.storefrontId,
              status: "adopted",
              adoptedAt: { gte: input.since },
            },
          }),
          null,
        )
      : (input.runtime.unavailable("adoptions"), Promise.resolve(null)),
  ]);

  // Housing is org-scoped, not storefront-scoped: a kennel is not a listing.
  const board = input.organizationId
    ? await input.runtime.read(
        "kennels",
        loadWardBoard({
          organizationId: input.organizationId,
          db: input.db as unknown as WardStoreClient,
        }),
        null,
      )
    : null;

  return {
    kennelCapacity: summarizeKennelCapacity(board),
    donationRows,
    animalStatusRows,
    animalsPlaced,
  };
}

/**
 * An animal that has been adopted has left the building; counting it as
 * population would overstate what the shelter is holding. Anything else counts
 * toward the total — an unrecognised status must never make an animal vanish
 * from the headline, even when its bucket has no name in the split.
 */
export function summarizeAnimalsInCare(
  rows: AnimalStatusGroup[] | null,
): AnimalsInCare | null {
  if (rows == null) return null;

  const summary: AnimalsInCare = { total: 0, onHold: 0, available: 0, pending: 0 };
  for (const row of rows) {
    const status = (row.status ?? "").toLowerCase();
    if (status === "adopted") continue;
    const count = row._count?._all ?? 0;
    summary.total += count;
    if (status === "hold") summary.onHold += count;
    else if (status === "available") summary.available += count;
    else if (status === "pending") summary.pending += count;
  }
  return summary;
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
  deliveredJobs: number;
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
    animalsInCare: summarizeAnimalsInCare(input.facts.animalStatusRows),
    kennelCapacity: input.facts.kennelCapacity,
    animalsPlaced: input.facts.animalsPlaced,
    // There is no governed foster entity yet. Preserve that fact in the UI.
    fostersActive: null,
  });
}

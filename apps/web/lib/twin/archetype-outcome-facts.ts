import { moneyToNumber } from "./operations-format";
import { buildArchetypeOutcomes } from "./archetype-outcomes";

type FindMany = (args: unknown) => Promise<unknown>;
type Count = (args: unknown) => Promise<number>;
type Money = number | string | { toString(): string } | null;

export interface ArchetypeOutcomeFactsClient {
  storefrontDonation?: { findMany: FindMany };
  adoptableAnimal?: { count: Count };
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
  donationRows: DonationRow[] | null;
  animalsPlaced: number | null;
}

function isRescue(archetypeId: string): boolean {
  return archetypeId === "pet-rescue" || archetypeId === "animal-shelter";
}

/** Load only the leaf-archetype facts that have canonical records. */
export async function loadArchetypeOutcomeFacts(input: {
  archetypeId: string;
  storefrontId: string;
  since: Date;
  db: ArchetypeOutcomeFactsClient;
  runtime: OutcomeFactsRuntime;
}): Promise<ArchetypeOutcomeFacts> {
  if (!isRescue(input.archetypeId)) {
    return { donationRows: null, animalsPlaced: null };
  }

  const [donationRows, animalsPlaced] = await Promise.all([
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

  return { donationRows, animalsPlaced };
}

/** Never combine currencies into a misleading headline total. */
export function summarizeDonations(
  rows: DonationRow[] | null,
  currency: string,
): {
  aggregate: { amount: number; count: number } | null;
  unavailableHint?: string;
} {
  if (rows == null) return { aggregate: null };
  const matching = rows.filter((row) => row.currency === currency);
  if (matching.length !== rows.length) {
    return {
      aggregate: null,
      unavailableHint: "Multiple donation currencies are not combined",
    };
  }
  return {
    aggregate: {
      amount: matching.reduce((sum, row) => sum + moneyToNumber(row.amount), 0),
      count: matching.length,
    },
  };
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
    donations: donations.aggregate,
    donationsUnavailableHint: donations.unavailableHint,
    animalsPlaced: input.facts.animalsPlaced,
    // There is no governed foster entity yet. Preserve that fact in the UI.
    fostersActive: null,
  });
}

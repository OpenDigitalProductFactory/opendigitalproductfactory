import { moneyToNumber } from "./operations-format";
import { buildArchetypeOutcomes, type DonationTotal } from "./archetype-outcomes";

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
    animalsPlaced: input.facts.animalsPlaced,
    // There is no governed foster entity yet. Preserve that fact in the UI.
    fostersActive: null,
  });
}

import type { Prisma } from "@dpf/db";

interface MarketingStrategyStore<TStrategy> {
  upsert(args: Prisma.MarketingStrategyUpsertArgs): Promise<TStrategy>;
  findUnique(args: {
    where: { organizationId: string };
  }): Promise<TStrategy | null>;
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

/**
 * Bootstrap one strategy per organization even when separate route requests
 * arrive together. Prisma can emulate an upsert as read-then-create, so the
 * losing request reuses the row committed by the winner.
 */
export async function upsertMarketingStrategyTolerant<TStrategy>(
  store: MarketingStrategyStore<TStrategy>,
  args: Prisma.MarketingStrategyUpsertArgs & {
    where: { organizationId: string };
  },
): Promise<TStrategy> {
  try {
    return await store.upsert(args);
  } catch (error: unknown) {
    if (!isUniqueConstraintViolation(error)) throw error;

    const winningStrategy = await store.findUnique({
      where: { organizationId: args.where.organizationId },
    });
    if (!winningStrategy) throw error;

    return winningStrategy;
  }
}

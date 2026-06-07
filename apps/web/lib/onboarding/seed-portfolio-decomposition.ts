// Onboarding Portfolio-decomposition seeding (BI-2D452667).
//
// Persists each org's Digital Product Portfolio decomposition — the per-role
// scope (foundational | manufactureAndDeliver | forEmployees |
// productsAndServicesSold) — onto BusinessContext.portfolioDecomposition.
//
// Until now the decomposition was computed from the shared archetype template's
// activationProfile at runtime (readActivationProfile) and discarded, so a
// company could not refine its own portfolio shape independent of the template
// (spec §3). This seeds it ONCE at setup completion from the archetype
// (seed-is-bootstrap), after which the persisted value is the source of truth
// and the operator can refine it. The read helper prefers the persisted value
// and falls back to the archetype-derived computation when absent.
//
// Idempotent and non-destructive: if BusinessContext already carries a
// decomposition (operator refinement, or a prior seed run), it is NOT
// overwritten. Safe to re-run on re-completion or replay.

import { prisma } from "@dpf/db";
import type { PortfolioDecomposition } from "@dpf/storefront-templates";
import { readActivationProfile } from "@/lib/storefront/archetype-activation";

/** Structural client — satisfied by the real PrismaClient and by test fakes. */
export type SeedPortfolioDecompositionClient = {
  businessContext: {
    findUnique: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
  };
  storefrontConfig: {
    findFirst: (args: unknown) => Promise<unknown>;
  };
};

export type SeedPortfolioDecompositionInput = {
  organizationId: string;
  /** Defaults to the shared prisma client. */
  db?: SeedPortfolioDecompositionClient;
};

export type SeedPortfolioDecompositionResult = {
  /** True only if a decomposition was written to BusinessContext this run. */
  seeded: boolean;
  /** True if BusinessContext already had a decomposition (left untouched). */
  alreadyPresent: boolean;
  /** The resulting decomposition (persisted or just-seeded), or null if none. */
  decomposition: PortfolioDecomposition | null;
};

type BusinessContextRow = {
  id: string;
  portfolioDecomposition: unknown;
} | null;

type StorefrontConfigRow = {
  archetype: { activationProfile: unknown } | null;
} | null;

/** Minimal structural guard — a decomposition is a non-empty object map. */
function asDecomposition(value: unknown): PortfolioDecomposition | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value as Record<string, unknown>).length === 0) return null;
  return value as PortfolioDecomposition;
}

/** Derive the decomposition from the org's archetype activationProfile. */
async function deriveFromArchetype(
  db: SeedPortfolioDecompositionClient,
  organizationId: string,
): Promise<PortfolioDecomposition | null> {
  const sf = (await db.storefrontConfig.findFirst({
    where: { organizationId },
    select: { archetype: { select: { activationProfile: true } } },
  })) as StorefrontConfigRow;

  return readActivationProfile(sf?.archetype?.activationProfile ?? null)?.portfolios ?? null;
}

/**
 * Seed BusinessContext.portfolioDecomposition once from the archetype at setup
 * completion. Non-destructive: never overwrites an existing decomposition.
 */
export async function seedPortfolioDecomposition(
  input: SeedPortfolioDecompositionInput,
): Promise<SeedPortfolioDecompositionResult> {
  const db = input.db ?? (prisma as unknown as SeedPortfolioDecompositionClient);
  const organizationId = input.organizationId;

  const bc = (await db.businessContext.findUnique({
    where: { organizationId },
    select: { id: true, portfolioDecomposition: true },
  })) as BusinessContextRow;

  // No business-context row yet → nothing to attach the decomposition to.
  if (!bc) {
    return { seeded: false, alreadyPresent: false, decomposition: null };
  }

  // Already set (operator refinement or prior seed) → preserve it.
  const existing = asDecomposition(bc.portfolioDecomposition);
  if (existing) {
    return { seeded: false, alreadyPresent: true, decomposition: existing };
  }

  const derived = await deriveFromArchetype(db, organizationId);
  if (!derived) {
    return { seeded: false, alreadyPresent: false, decomposition: null };
  }

  await db.businessContext.update({
    where: { organizationId },
    data: { portfolioDecomposition: derived },
  });

  return { seeded: true, alreadyPresent: false, decomposition: derived };
}

/**
 * Resolve the org's portfolio decomposition for downstream wiring (Facet A/B
 * seeding, capability-map dispatch). Prefers the persisted, refinable
 * BusinessContext value; falls back to the archetype-derived computation when
 * it has not been seeded yet.
 */
export async function resolvePortfolioDecomposition(input: {
  organizationId: string;
  db?: SeedPortfolioDecompositionClient;
}): Promise<PortfolioDecomposition | null> {
  const db = input.db ?? (prisma as unknown as SeedPortfolioDecompositionClient);

  const bc = (await db.businessContext.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true, portfolioDecomposition: true },
  })) as BusinessContextRow;

  const persisted = bc ? asDecomposition(bc.portfolioDecomposition) : null;
  if (persisted) return persisted;

  return deriveFromArchetype(db, input.organizationId);
}

// packages/db/src/canonical-portfolios.ts
//
// The four IT4IT-canonical portfolios that every Organization has.
// Created per-org at org creation time (see setup-entities.createOrganization),
// not globally at seed time — each org owns its own tree of portfolio content.

import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "./client";

export type CanonicalPortfolio = {
  id: string;
  name: string;
  description?: string;
};

const REGISTRY_PATH = join(__dirname, "..", "data", "portfolio_registry.json");

const PORTFOLIO_BUDGETS: Record<string, number> = {
  foundational: 2500,
  manufacturing_and_delivery: 1800,
  for_employees: 1200,
  products_and_services_sold: 3500,
};

let _cachedPortfolios: CanonicalPortfolio[] | null = null;

function loadCanonicalPortfolios(): CanonicalPortfolio[] {
  if (_cachedPortfolios) return _cachedPortfolios;
  const raw = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")) as {
    portfolios: CanonicalPortfolio[];
  };
  _cachedPortfolios = raw.portfolios;
  return _cachedPortfolios;
}

// Lazy accessor. The registry file read used to happen at module top
// level, which crashed Next.js's production build-data collection
// because `__dirname` resolves to a synthetic path in the standalone
// output where the file isn't present. Deferring the read avoids that.
export function getCanonicalPortfolios(): CanonicalPortfolio[] {
  return loadCanonicalPortfolios();
}

export async function createCanonicalPortfoliosForOrg(
  organizationId: string,
): Promise<void> {
  for (const p of loadCanonicalPortfolios()) {
    await prisma.portfolio.upsert({
      where: {
        organizationId_slug: { organizationId, slug: p.id },
      },
      update: {
        name: p.name,
        description: p.description ?? null,
        budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null,
      },
      create: {
        organizationId,
        slug: p.id,
        name: p.name,
        description: p.description ?? null,
        budgetKUsd: PORTFOLIO_BUDGETS[p.id] ?? null,
      },
    });
  }
}

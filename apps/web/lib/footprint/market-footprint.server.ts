import "server-only";

import { prisma } from "@dpf/db";
import { EXCLUDE_TOMBSTONED } from "@dpf/db/customer-lifecycle";

import { buildMarketFootprint, type MarketFootprint } from "./market-footprint";

/** Read `countryCode` entries from MarketingStrategy.serviceTerritories, when present. */
function territoryCountries(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry && typeof entry === "object" && typeof (entry as { countryCode?: unknown }).countryCode === "string"
      ? [(entry as { countryCode: string }).countryCode]
      : [],
  );
}

const SITE_COUNTRY_SELECT = {
  primaryAddress: {
    select: { city: { select: { region: { select: { country: { select: { iso2: true } } } } } } },
  },
} as const;

type SiteWithCountry = {
  primaryAddress: { city: { region: { country: { iso2: string } } } } | null;
};

function siteCountry(site: SiteWithCountry): string | null {
  return site.primaryAddress?.city.region.country.iso2 ?? null;
}

/**
 * Load the market footprint from existing records only: business context,
 * marketing territories, customer site addresses, and installed nodes at
 * customer sites that carry an active fulfilment. No schema of its own.
 */
export async function loadMarketFootprint(): Promise<MarketFootprint> {
  const [context, strategies, accounts, deploymentSites] = await Promise.all([
    prisma.businessContext.findFirst({ select: { sellsTo: true, operatesIn: true } }),
    prisma.marketingStrategy.findMany({ select: { serviceTerritories: true } }),
    prisma.customerAccount.findMany({
      where: { ...EXCLUDE_TOMBSTONED, mergedIntoId: null },
      select: {
        id: true,
        customerSites: {
          where: { mergedIntoId: null, status: { not: "superseded" } },
          select: SITE_COUNTRY_SELECT,
        },
      },
    }),
    prisma.customerSite.findMany({
      where: {
        mergedIntoId: null,
        edgeNodes: { some: { productFulfillmentInstances: { some: { status: "active" } } } },
      },
      select: { id: true, ...SITE_COUNTRY_SELECT },
    }),
  ]);

  return buildMarketFootprint({
    targetMarkets: [
      context?.sellsTo ?? [],
      context?.operatesIn ?? [],
      ...strategies.map((strategy) => territoryCountries(strategy.serviceTerritories)),
    ],
    accounts: accounts.map((account) => ({
      accountId: account.id,
      siteCountries: account.customerSites.map(siteCountry),
    })),
    deploymentSites: deploymentSites.map((site) => ({ siteId: site.id, country: siteCountry(site) })),
  });
}

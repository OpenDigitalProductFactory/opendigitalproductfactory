// /customer/footprint — where the business sells, has customers and is
// deployed, by country (BI-4EC1D572).
// Design: docs/superpowers/specs/2026-09-26-market-footprint-world-view-design.md

import Link from "next/link";
import { notFound } from "next/navigation";

import { FootprintView } from "@/components/customer/footprint/FootprintView";
import { Surface } from "@/components/ui/Surface";
import { StatCard } from "@/components/ui/report-kit";
import { auth } from "@/lib/auth";
import { loadMarketFootprint } from "@/lib/footprint/market-footprint.server";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveVocabularyKey } from "@/lib/storefront/resolve-vocabulary";

export default async function MarketFootprintPage() {
  const session = await auth();
  if (!session?.user) notFound();
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_customer")) {
    notFound();
  }

  const [footprint, config, context] = await Promise.all([
    loadMarketFootprint(),
    prisma.storefrontConfig.findFirst({ select: { archetype: { select: { category: true } } } }),
    prisma.businessContext.findFirst({ select: { industry: true } }),
  ]);
  const people = getVocabulary(
    resolveVocabularyKey({ archetypeCategory: config?.archetype?.category ?? null, industry: context?.industry }),
  ).stakeholderLabel;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Market footprint</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Where you sell, where your {people.toLowerCase()} are, and where you are deployed, by country.
        </p>
      </header>

      {footprint.hasAnyData ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Target markets" value={footprint.targetMarketCount} />
            <StatCard label={`${people} placed`} value={footprint.placedCustomers} />
            <StatCard
              label="Not placed"
              value={footprint.unplacedCustomers}
              hint={footprint.unplacedCustomers > 0 ? "No site or no country on the address" : undefined}
              intent={footprint.unplacedCustomers > 0 ? "warning" : undefined}
            />
            <StatCard label="Deployments" value={footprint.deploymentCount} />
          </div>
          <FootprintView footprint={footprint} peopleLabel={people} />
        </>
      ) : (
        <Surface as="section" className="text-sm text-[var(--dpf-text)]">
          <h2 className="font-semibold">Nothing to show on the map yet</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
            <li>Add the countries you sell to or operate in to your business context.</li>
            <li>
              Give each of your {people.toLowerCase()} a site with an address — <Link href="/customer" className="underline">open the Customer area</Link>.
            </li>
          </ul>
        </Surface>
      )}
    </div>
  );
}

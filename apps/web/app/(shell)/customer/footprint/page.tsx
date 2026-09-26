// /customer/footprint — where the business sells, has customers and is
// deployed, by country (BI-4EC1D572).
// Design: docs/superpowers/specs/2026-09-26-market-footprint-world-view-design.md

import Link from "next/link";
import { notFound } from "next/navigation";

import { FootprintView } from "@/components/customer/footprint/FootprintView";
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
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Target markets" value={footprint.targetMarketCount} />
            <Stat label={`${people} placed`} value={footprint.placedCustomers} />
            <Stat label="Not placed" value={footprint.unplacedCustomers} />
            <Stat label="Deployments" value={footprint.deploymentCount} />
          </dl>
          <FootprintView footprint={footprint} peopleLabel={people} />
        </>
      ) : (
        <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-text)]">
          <h2 className="font-semibold">Nothing to show on the map yet</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
            <li>Add the countries you sell to or operate in to your business context.</li>
            <li>
              Give each of your {people.toLowerCase()} a site with an address — <Link href="/customer" className="underline">open the Customer area</Link>.
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
      <dt className="text-xs uppercase tracking-wide text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

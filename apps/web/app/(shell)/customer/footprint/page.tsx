// /customer/footprint — where the business sells, has customers and is
// deployed, by country (BI-4EC1D572).
// Design: docs/superpowers/specs/2026-09-26-market-footprint-world-view-design.md

import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";

import { FootprintView } from "@/components/customer/footprint/FootprintView";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { Surface } from "@/components/ui/Surface";
import { StatCard } from "@/components/ui/report-kit";
import { auth } from "@/lib/auth";
import { loadMarketFootprint } from "@/lib/footprint/market-footprint.server";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { can } from "@/lib/permissions";
import { getVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { resolveVocabularyKey } from "@/lib/storefront/resolve-vocabulary";

export default async function MarketFootprintPage() {
  const session = await auth();
  if (!session?.user) notFound();
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_customer")) {
    notFound();
  }

  const [footprint, config, context, locale, t] = await Promise.all([
    loadMarketFootprint(),
    prisma.storefrontConfig.findFirst({ select: { archetype: { select: { category: true } } } }),
    prisma.businessContext.findFirst({ select: { industry: true } }),
    getLocaleContext(),
    getT("footprint"),
  ]);
  const people = getVocabulary(
    resolveVocabularyKey({ archetypeCategory: config?.archetype?.category ?? null, industry: context?.industry }),
  ).stakeholderLabel;
  const peopleLower = people.toLowerCase();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("page.heading")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">{t("page.intro", { people: peopleLower })}</p>
      </header>

      {footprint.hasAnyData ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t("page.statTargets")} value={footprint.targetMarketCount} />
            <StatCard label={t("page.statPlaced", { people })} value={footprint.placedCustomers} />
            <StatCard
              label={t("page.statNotPlaced")}
              value={footprint.unplacedCustomers}
              hint={footprint.unplacedCustomers > 0 ? t("page.statNotPlacedHint") : undefined}
              intent={footprint.unplacedCustomers > 0 ? "warning" : undefined}
            />
            <StatCard label={t("page.statDeployments")} value={footprint.deploymentCount} />
          </div>
          <MessagesProvider locale={locale.language} messages={{ footprint: namespaceMessages(locale.language, "footprint") }}>
            <FootprintView footprint={footprint} peopleLabel={people} />
          </MessagesProvider>
        </>
      ) : (
        <Surface as="section" className="text-sm text-[var(--dpf-text)]">
          <h2 className="font-semibold">{t("page.emptyHeading")}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-[var(--dpf-muted)]">
            <li>{t("page.emptyTargets")}</li>
            <li>
              {t("page.emptySites", { people: peopleLower })}{" "}
              <Link href="/customer" className="underline">{t("page.emptySitesLink")}</Link>
            </li>
          </ul>
        </Surface>
      )}
    </div>
  );
}

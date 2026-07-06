// apps/web/app/(shell)/finance/settings/rate-card/page.tsx
// Rate-card admin (EP-LABOR-ECONOMICS Phase 4). Archetype-gated: only labour
// financial profiles (billableTimeEnabled) bill time, so other business types
// see an honest explanation instead of an empty admin surface.
import Link from "next/link";
import { prisma } from "@dpf/db";
import { getFinancialProfile } from "@dpf/finance-templates";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { RateCardManager } from "@/components/finance/RateCardManager";

export default async function RateCardPage() {
  const [orgSettings, org] = await Promise.all([
    prisma.orgSettings.findFirst({ select: { appliedProfileSlug: true, baseCurrency: true } }),
    prisma.organization.findFirst({ select: { id: true } }),
  ]);
  const billableTimeEnabled =
    (orgSettings?.appliedProfileSlug
      ? getFinancialProfile(orgSettings.appliedProfileSlug)?.billableTimeEnabled
      : false) ?? false;

  const rates =
    billableTimeEnabled && org
      ? await prisma.billableRate.findMany({
          where: { organizationId: org.id },
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
          select: { id: true, name: true, billRate: true, isActive: true },
        })
      : [];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/settings" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Settings
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Labour rates</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Labour Rates</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          The services you bill your team&apos;s time as.
        </p>
      </div>

      <FinanceTabNav />

      {billableTimeEnabled ? (
        <RateCardManager
          rates={rates.map((r) => ({
            id: r.id,
            name: r.name,
            billRate: Number(r.billRate),
            isActive: r.isActive,
          }))}
          currency={orgSettings?.baseCurrency ?? "GBP"}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
          <p className="text-sm text-[var(--dpf-text)]">
            Billable time isn&apos;t used for your business type.
          </p>
          <p className="text-xs text-[var(--dpf-muted)] mt-1">
            Labour rates apply to businesses that bill customers for their team&apos;s hours (trades,
            professional services, and similar). Your invoicing works from products and orders instead.{" "}
            <Link href="/finance/settings" className="text-[var(--dpf-accent)] hover:underline">
              Back to settings
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

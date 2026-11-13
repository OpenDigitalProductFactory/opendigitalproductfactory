// apps/web/app/(shell)/finance/settings/statutory-rates/page.tsx
// Statutory payroll figures: what is confirmed, what is waiting on a person, and
// what is still missing (BI-8E1FD1BD).
//
// Before this page a coworker could propose a cited figure and nothing could
// ever confirm it — resolveStatutoryRule only returns ratified rules, agents are
// refused ratification by design, and no person had anywhere to do it. So no
// figure, however well sourced, could reach a payroll. This is that place.

import { prisma } from "@dpf/db";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { missingRatifiedRules, type StatutoryRuleKind } from "@/lib/finance/statutory-rules";
import { StatutoryRatesPanel, type StatutoryRuleView, type JurisdictionOption } from "./StatutoryRatesPanel";

/**
 * The figures a US employer needs before federal payroll can compute at all.
 * Shown as a checklist so an install with none of them says so out loud — an
 * empty table and a complete one must never look the same.
 */
const US_FEDERAL_REQUIRED: { taxType: string; ruleKind: StatutoryRuleKind; side: string | null; label: string }[] = [
  { taxType: "social_security", ruleKind: "rate", side: "employee_withheld", label: "Social Security — employee rate" },
  { taxType: "social_security", ruleKind: "rate", side: "employer_contribution", label: "Social Security — employer rate" },
  { taxType: "social_security", ruleKind: "wage_base", side: null, label: "Social Security — wage base" },
  { taxType: "medicare", ruleKind: "rate", side: "employee_withheld", label: "Medicare — employee rate" },
  { taxType: "medicare", ruleKind: "rate", side: "employer_contribution", label: "Medicare — employer rate" },
];

const PAYROLL_TAX_TYPES = ["fica", "futa", "payroll_withholding", "suta"];

export default async function StatutoryRatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const mayManage = can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_finance",
  );
  if (!mayManage) {
    return (
      <div>
        <FinanceTabNav />
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Statutory rates</h1>
        <p className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm text-[var(--dpf-muted)]">
          Confirming statutory figures needs finance management permission.
        </p>
      </div>
    );
  }

  const [rules, jurisdictions] = await Promise.all([
    prisma.payrollTaxRule.findMany({
      where: { lifecycle: "active" },
      orderBy: [{ status: "asc" }, { taxType: "asc" }, { effectiveFrom: "desc" }],
      take: 500,
      select: {
        payrollTaxRuleId: true,
        jurisdictionRefId: true,
        taxType: true,
        ruleKind: true,
        side: true,
        taxYear: true,
        value: true,
        currency: true,
        status: true,
        effectiveFrom: true,
        effectiveTo: true,
        sourceUrl: true,
        sourceExcerpt: true,
        retrievedAt: true,
        proposedByAgentId: true,
        rejectedReason: true,
      },
    }),
    prisma.taxJurisdictionReference.findMany({
      where: { taxTypes: { hasSome: PAYROLL_TAX_TYPES } },
      orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }],
      select: { jurisdictionRefId: true, authorityName: true, countryCode: true, stateProvinceCode: true },
    }),
  ]);

  const now = new Date();
  const federalRatified = rules
    .filter((r) => r.jurisdictionRefId === "TAX-JUR-US-FEDERAL")
    .map((r) => ({
      id: r.payrollTaxRuleId,
      taxType: r.taxType,
      ruleKind: r.ruleKind as StatutoryRuleKind,
      side: r.side,
      taxYear: r.taxYear,
      value: Number(r.value.toString()),
      status: r.status,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      sourceUrl: r.sourceUrl,
    }));
  const missing = missingRatifiedRules(federalRatified, now, US_FEDERAL_REQUIRED);
  const missingLabels = US_FEDERAL_REQUIRED
    .filter((req) => missing.some((m) =>
      m.taxType === req.taxType && m.ruleKind === req.ruleKind && (m.side ?? null) === req.side))
    .map((req) => req.label);

  const views: StatutoryRuleView[] = rules.map((r) => ({
    payrollTaxRuleId: r.payrollTaxRuleId,
    jurisdictionRefId: r.jurisdictionRefId,
    taxType: r.taxType,
    ruleKind: r.ruleKind,
    side: r.side,
    taxYear: r.taxYear,
    value: r.value.toString(),
    currency: r.currency,
    status: r.status,
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo?.toISOString() ?? null,
    sourceUrl: r.sourceUrl,
    sourceExcerpt: r.sourceExcerpt,
    retrievedAt: r.retrievedAt?.toISOString() ?? null,
    proposedBy: r.proposedByAgentId ? "coworker" : "person",
    rejectedReason: r.rejectedReason,
  }));

  const jurisdictionOptions: JurisdictionOption[] = jurisdictions.map((j) => ({
    jurisdictionRefId: j.jurisdictionRefId,
    label: j.stateProvinceCode ? `${j.authorityName} (${j.countryCode}-${j.stateProvinceCode})` : j.authorityName,
  }));

  return (
    <div>
      <FinanceTabNav />
      <h1 className="text-xl font-bold text-[var(--dpf-text)]">Statutory rates</h1>
      <p className="mt-1 text-sm text-[var(--dpf-muted)]">
        Payroll uses a tax figure only after a person confirms it against the authority&apos;s own publication.
      </p>

      <section
        aria-labelledby="statutory-missing"
        className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      >
        <h2 id="statutory-missing" className="text-sm font-semibold text-[var(--dpf-text)]">
          US federal payroll — {missingLabels.length === 0 ? "ready" : `${missingLabels.length} figure${missingLabels.length === 1 ? "" : "s"} missing`}
        </h2>
        {missingLabels.length === 0 ? (
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">Every required federal figure is confirmed for today.</p>
        ) : (
          <ul className="mt-2 list-disc pl-5 text-sm text-[var(--dpf-text)]">
            {missingLabels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        )}
      </section>

      <StatutoryRatesPanel rules={views} jurisdictions={jurisdictionOptions} />
    </div>
  );
}

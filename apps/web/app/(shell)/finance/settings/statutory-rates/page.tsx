// apps/web/app/(shell)/finance/settings/statutory-rates/page.tsx
// Statutory payroll figures: what is confirmed, what is waiting on a person, and
// what is still missing (BI-8E1FD1BD).
//
// Before this page a coworker could propose a cited figure and nothing could
// ever confirm it — resolveStatutoryRule only returns ratified rules, agents are
// refused ratification by design, and no person had anywhere to do it. So no
// figure, however well sourced, could reach a payroll. This is that place.
//
// Values and dates are formatted HERE, with the viewer's locale, and handed to
// the client as finished strings, so no locale logic runs in the browser.

import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";
import { redirect } from "next/navigation";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { Surface } from "@/components/ui/Surface";
import { auth } from "@/lib/auth";
import { formatInstant } from "@/lib/datetime";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { can } from "@/lib/permissions";
import { missingRatifiedRules, type StatutoryRuleKind } from "@/lib/finance/statutory-rules";
import { StatutoryRatesPanel, type JurisdictionOption, type StatutoryRuleView } from "./StatutoryRatesPanel";

/**
 * The figures a US employer needs before federal payroll can compute at all.
 * Shown as a checklist so an install with none of them says so out loud — an
 * empty table and a complete one must never look the same.
 */
const US_FEDERAL_REQUIRED = [
  { taxType: "social_security", ruleKind: "rate", side: "employee_withheld", labelKey: "required.socialSecurityEmployee" },
  { taxType: "social_security", ruleKind: "rate", side: "employer_contribution", labelKey: "required.socialSecurityEmployer" },
  { taxType: "social_security", ruleKind: "wage_base", side: null, labelKey: "required.socialSecurityWageBase" },
  { taxType: "medicare", ruleKind: "rate", side: "employee_withheld", labelKey: "required.medicareEmployee" },
  { taxType: "medicare", ruleKind: "rate", side: "employer_contribution", labelKey: "required.medicareEmployer" },
] as const satisfies readonly { taxType: string; ruleKind: StatutoryRuleKind; side: string | null; labelKey: string }[];

const PAYROLL_TAX_TYPES = ["fica", "futa", "payroll_withholding", "suta"];
const FEDERAL = "TAX-JUR-US-FEDERAL";

/**
 * Effective dates are stored at UTC midnight. Formatting them in the viewer's
 * zone would show 1 January as 31 December of the PREVIOUS year to anyone west
 * of Greenwich — the wrong tax year, on a tax figure. So they format in UTC.
 */
function calendarDay(value: Date | null): string | null {
  return value ? formatInstant(value, { mode: "date", timeZone: "UTC", withZone: false }) : null;
}

export default async function StatutoryRatesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [t, locale] = await Promise.all([getT("statutoryRates"), getLocaleContext()]);

  const mayManage = can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_finance",
  );
  if (!mayManage) {
    return (
      <div>
        <FinanceTabNav />
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("title")}</h1>
        <Surface padding="md" className="mt-4 text-sm text-[var(--dpf-muted)]">{t("noPermission")}</Surface>
      </div>
    );
  }

  const [rules, jurisdictions] = await Promise.all([
    prisma.payrollTaxRule.findMany({
      where: { lifecycle: "active" },
      orderBy: [{ status: "asc" }, { taxType: "asc" }, { effectiveFrom: "desc" }],
      take: 500,
      select: {
        payrollTaxRuleId: true, jurisdictionRefId: true, taxType: true, ruleKind: true, side: true,
        taxYear: true, value: true, currency: true, status: true, effectiveFrom: true, effectiveTo: true,
        sourceUrl: true, sourceExcerpt: true, retrievedAt: true, proposedByAgentId: true, rejectedReason: true,
      },
    }),
    prisma.taxJurisdictionReference.findMany({
      where: { taxTypes: { hasSome: PAYROLL_TAX_TYPES } },
      orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }],
      select: { jurisdictionRefId: true, authorityName: true, countryCode: true, stateProvinceCode: true },
    }),
  ]);

  const jurisdictionOptions: JurisdictionOption[] = jurisdictions.map((j) => ({
    jurisdictionRefId: j.jurisdictionRefId,
    label: j.stateProvinceCode ? `${j.authorityName} (${j.countryCode}-${j.stateProvinceCode})` : j.authorityName,
  }));
  const jurisdictionLabel = new Map(jurisdictionOptions.map((j) => [j.jurisdictionRefId, j.label]));

  const now = new Date();
  const federal = rules
    .filter((r) => r.jurisdictionRefId === FEDERAL)
    .map((r) => ({
      id: r.payrollTaxRuleId, taxType: r.taxType, ruleKind: r.ruleKind as StatutoryRuleKind, side: r.side,
      taxYear: r.taxYear, value: Number(r.value.toString()), status: r.status,
      effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo, sourceUrl: r.sourceUrl,
    }));
  const missing = missingRatifiedRules(federal, now, US_FEDERAL_REQUIRED);
  const missingLabels = US_FEDERAL_REQUIRED
    .filter((req) => missing.some((m) =>
      m.taxType === req.taxType && m.ruleKind === req.ruleKind && (m.side ?? null) === req.side))
    .map((req) => t(req.labelKey));

  // A rate is stored as a fraction (0.062). Intl's percent style multiplies by
  // 100 itself, so the stored value goes in unchanged and reads as 6.2%.
  const percent = new Intl.NumberFormat(locale.language, { style: "percent", maximumFractionDigits: 4 });
  const ruleValueLabel = (ruleKind: string, value: number, currency: string | null) =>
    ruleKind === "rate" ? percent.format(value) : formatMoney(value, currency ?? "USD", locale.language);

  const views: StatutoryRuleView[] = rules.map((r) => {
    const value = Number(r.value.toString());
    const from = calendarDay(r.effectiveFrom) ?? "";
    const to = calendarDay(r.effectiveTo);
    const jurisdiction = jurisdictionLabel.get(r.jurisdictionRefId) ?? r.jurisdictionRefId;
    const sideKey = r.side === "employee_withheld" || r.side === "employer_contribution" ? r.side : null;
    return {
      payrollTaxRuleId: r.payrollTaxRuleId,
      status: r.status,
      heading: [
        t(`taxType.${r.taxType}` as Parameters<typeof t>[0]),
        t(`ruleKind.${r.ruleKind}` as Parameters<typeof t>[0]),
        ...(sideKey ? [t(`side.${sideKey}`)] : []),
      ].join(" · "),
      valueLabel: ruleValueLabel(r.ruleKind, value, r.currency),
      meta: to
        ? t("card.metaUntil", { jurisdiction, year: String(r.taxYear), from, to })
        : t("card.meta", { jurisdiction, year: String(r.taxYear), from }),
      provenance: r.proposedByAgentId ? t("card.byCoworker") : t("card.byPerson"),
      sourceUrl: r.sourceUrl,
      readOn: r.retrievedAt ? t("card.read", { date: calendarDay(r.retrievedAt) ?? "" }) : null,
      sourceExcerpt: r.sourceExcerpt,
      rejectedReason: r.rejectedReason,
    };
  });

  const waiting = views.filter((v) => v.status === "proposed").length;
  const lead = missingLabels.length === 0 ? t("lead.ready") : t("lead.missing", { count: missingLabels.length });

  return (
    <div>
      <FinanceTabNav />

      {/* Lead band: one short plain sentence about what payroll still lacks, and
          one next step. An empty table and a complete one must never look alike,
          so the count leads rather than sitting below a list. */}
      <header className="mb-6 space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          {waiting > 0 ? `${lead} ${t("lead.waiting", { count: waiting })}` : lead}
        </p>
        <a
          href={waiting > 0 ? "#statutory-waiting" : "#statutory-entry"}
          data-dpf-primary-action
          data-owner-first-next-action="confirm-figures"
          className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          {waiting > 0 ? t("lead.checkFigures") : t("lead.addFigure")}
        </a>
      </header>

      {missingLabels.length > 0 ? (
        <Surface as="section" padding="md" aria-labelledby="statutory-missing">
          <h2 id="statutory-missing" className="text-sm font-semibold text-[var(--dpf-text)]">{t("missingHeading")}</h2>
          <ul className="mt-2 list-disc ps-5 text-sm text-[var(--dpf-text)]">
            {missingLabels.map((label) => <li key={label}>{label}</li>)}
          </ul>
        </Surface>
      ) : null}

      <MessagesProvider
        locale={locale.language}
        messages={{ statutoryRates: namespaceMessages(locale.language, "statutoryRates") }}
      >
        <StatutoryRatesPanel rules={views} jurisdictions={jurisdictionOptions} />
      </MessagesProvider>
    </div>
  );
}

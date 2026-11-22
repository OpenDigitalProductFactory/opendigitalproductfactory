// apps/web/app/(shell)/finance/payroll/page.tsx — run US payroll (BI-099EAE30).
//
// Until this page existed nothing in the portal created a PayRun, so payroll
// was unreachable however complete its engine was. The page leads with what
// still blocks a run, named; then who is paid and whether their W-4 is on
// file; then the pay runs with every payslip line. Recording a W-4 and
// computing a run sit behind collapsed disclosures.
//
// Money and dates are formatted here, in the viewer's locale, and handed to
// the client as finished strings. Calendar dates are stored at UTC midnight
// and formatted in UTC so a western viewer never sees the previous day.

import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";
import { redirect } from "next/navigation";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { Surface } from "@/components/ui/Surface";
import { auth } from "@/lib/auth";
import { formatInstant } from "@/lib/datetime";
import { loadUsPayRun } from "@/lib/hr/us-pay-run.server";
import type { PayComponent } from "@/lib/hr/payroll";
import { taxesToRemit } from "@/lib/hr/pay-run-books";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { formatMoney } from "@/lib/org-locale/org-locale";
import { can } from "@/lib/permissions";
import { PayrollPanel, type PayRunView, type StaffView } from "./PayrollPanel";

function lines(value: unknown): PayComponent[] {
  return Array.isArray(value) ? (value as PayComponent[]) : [];
}

export default async function PayrollPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [t, locale] = await Promise.all([getT("payroll"), getLocaleContext()]);
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

  const today = new Date();
  const todayDay = today.toISOString().slice(0, 10);
  const { assessment, employees } = await loadUsPayRun(new Date(`${todayDay}T00:00:00.000Z`));

  const runs = await prisma.payRun.findMany({
    orderBy: { periodStart: "desc" },
    take: 12,
    select: {
      id: true, periodStart: true, periodEnd: true, payDate: true, status: true,
      payslips: {
        select: {
          id: true, grossPay: true, netPay: true, totalEmployerCost: true,
          earnings: true, employeeDeductions: true, employerCosts: true,
          employeeProfile: { select: { displayName: true } },
        },
      },
    },
  });

  const money = (n: unknown) => formatMoney(Number(n), "USD", locale.language);
  const day = (d: Date | null) => (d ? formatInstant(d, { mode: "date", timeZone: "UTC", withZone: false }) : "");

  const runViews: PayRunView[] = runs.map((run) => ({
    payRunId: run.id,
    periodLabel: `${day(run.periodStart)} – ${day(run.periodEnd)}`,
    payDateLabel: day(run.payDate),
    status: run.status,
    // BI-3B8FA6D8: what this run leaves to remit, by tax, formatted here.
    taxesToRemit: taxesToRemit(run.payslips.map((slip) => ({
      netPay: Number(slip.netPay),
      earnings: lines(slip.earnings),
      employeeDeductions: lines(slip.employeeDeductions),
      employerCosts: lines(slip.employerCosts),
    }))).map((t) => ({ label: t.label, amount: money(t.amount) })),
    netTotal: money(run.payslips.reduce((sum, slip) => sum + Number(slip.netPay), 0)),
    payslips: run.payslips.map((slip) => ({
      payslipId: slip.id,
      name: slip.employeeProfile.displayName,
      gross: money(slip.grossPay),
      net: money(slip.netPay),
      employerCost: money(slip.totalEmployerCost),
      earnings: lines(slip.earnings).map((l) => ({ label: l.label, amount: money(l.amount) })),
      deductions: lines(slip.employeeDeductions).map((l) => ({ label: l.label, amount: money(l.amount) })),
      employerTaxes: lines(slip.employerCosts).map((l) => ({ label: l.label, amount: money(l.amount) })),
    })),
  }));

  const staff: StaffView[] = employees.map((e) => ({
    employeeProfileId: e.employeeProfileId,
    name: e.displayName,
    hasPay: e.hasPay,
    workState: e.w4?.workStateCode ?? null,
  }));

  const blockers = assessment.blockers;
  const figureBlocked = blockers.some((b) => !b.includes(" has no W-4") && !b.startsWith("Nobody"));

  return (
    <div>
      <FinanceTabNav />

      <header className="mb-6 space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("title")}</h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          {blockers.length > 0 ? t("lead.blocked", { count: blockers.length }) : t("lead.ready")}
        </p>
        <a
          href={blockers.length > 0 ? "#payroll-blockers" : "#payroll-run"}
          data-dpf-primary-action
          data-owner-first-next-action="run-payroll"
          className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          {blockers.length > 0 ? t("lead.fixFirst") : t("lead.runNow")}
        </a>
      </header>

      {blockers.length > 0 ? (
        <Surface as="section" padding="md" aria-labelledby="payroll-blockers" className="mb-6">
          <h2 id="payroll-blockers" className="text-sm font-semibold text-[var(--dpf-text)]">{t("blockers.heading")}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-[var(--dpf-text)]">
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
          {figureBlocked ? (
            <a href="/finance/settings/statutory-rates" className="mt-3 inline-flex text-sm text-[var(--dpf-accent)] underline-offset-2 hover:underline">
              {t("blockers.figuresLink")}
            </a>
          ) : null}
        </Surface>
      ) : null}

      <MessagesProvider locale={locale.language} messages={{ payroll: namespaceMessages(locale.language, "payroll") }}>
        <PayrollPanel staff={staff} runs={runViews} today={todayDay} />
      </MessagesProvider>
    </div>
  );
}

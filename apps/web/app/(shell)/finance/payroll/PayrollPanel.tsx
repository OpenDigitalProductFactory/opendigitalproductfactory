"use client";

// Who is paid, recording a W-4, computing a pay run, and reviewing runs
// (BI-099EAE30). Every amount and date arrives formatted by the page; this
// component carries copy and controls only.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";
import type { ActionResult } from "@/lib/shared/action-result";
import { approvePayRunAction, computePayRunAction, recordPayRunPaidAction, recordW4Action } from "@/lib/actions/payroll";

export interface StaffView {
  employeeProfileId: string;
  name: string;
  hasPay: boolean;
  workState: string | null;
}

interface LineView { label: string; amount: string }

export interface PayRunView {
  payRunId: string;
  periodLabel: string;
  payDateLabel: string;
  status: string;
  /** BI-3B8FA6D8: totals by tax, formatted by the page. */
  taxesToRemit: LineView[];
  netTotal: string;
  payslips: Array<{
    payslipId: string;
    name: string;
    gross: string;
    net: string;
    employerCost: string;
    earnings: LineView[];
    deductions: LineView[];
    employerTaxes: LineView[];
  }>;
}

const FIELD = "rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1.5 text-sm text-[var(--dpf-text)]";
const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)]";
const CHECK = "flex items-center gap-2 text-xs font-medium text-[var(--dpf-muted)]";

type Notice = { kind: "ok" | "error"; text: string } | null;

function Lines({ heading, rows }: { heading: string; rows: LineView[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-[var(--dpf-muted)]">{heading}</p>
      <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-4 text-sm text-[var(--dpf-text)]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt>{r.label}</dt>
            <dd className="text-end tabular-nums">{r.amount}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// BI-3B8FA6D8: approve a draft (posts its journal), then record it paid once the
// owner has sent the net pay from their bank. Neither control moves money.
function RunActions({ run, today, onDone }: { run: PayRunView; today: string; onDone: (n: Notice) => void }) {
  const t = useT("payroll");
  const [pending, start] = useTransition();
  const [paid, setPaid] = useState({ bankReference: "", paidOn: today });
  const say = (res: ActionResult<unknown>, done: string) =>
    onDone(res.ok ? { kind: "ok", text: done } : { kind: "error", text: res.error });

  return (
    <div className="space-y-3">
      <Lines heading={t("books.netTotal")} rows={[{ label: t("books.netTotal"), amount: run.netTotal }]} />
      <Lines heading={t("books.taxesToRemit")} rows={run.taxesToRemit} />
      {run.status === "draft" ? (
        <Button type="button" size="sm" disabled={pending}
          onClick={() => start(async () => say(await approvePayRunAction(run.payRunId), t("books.approved")))}>
          {t("books.approve")}
        </Button>
      ) : null}
      {run.status === "approved" ? (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); start(async () => say(await recordPayRunPaidAction({ payRunId: run.payRunId, ...paid }), t("books.paid"))); }}>
          <p className="text-xs text-[var(--dpf-muted)]">{t("books.payHelp")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>{t("books.paidOn")}
              <input type="date" required value={paid.paidOn} onChange={(e) => setPaid({ ...paid, paidOn: e.target.value })} className={FIELD} />
            </label>
            <label className={LABEL}>{t("books.bankReference")}
              <input required value={paid.bankReference} onChange={(e) => setPaid({ ...paid, bankReference: e.target.value })} className={FIELD} />
            </label>
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>{t("books.recordPaid")}</Button>
        </form>
      ) : null}
    </div>
  );
}

export function PayrollPanel({ staff, runs, today }: { staff: StaffView[]; runs: PayRunView[]; today: string }) {
  const t = useT("payroll");
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);
  const paid = staff.filter((s) => s.hasPay);

  const [w4, setW4] = useState({
    employeeProfileId: paid[0]?.employeeProfileId ?? "",
    effectiveFrom: today,
    filingStatus: "single",
    step2Checked: false,
    step3Credits: "0",
    step4aOtherIncome: "0",
    step4bDeductions: "0",
    step4cExtraWithholding: "0",
    exempt: false,
    workStateCode: "",
  });
  const [run, setRun] = useState({ periodStart: `${today.slice(0, 7)}-01`, periodEnd: today, payDate: today, frequency: "monthly" });

  const report = (res: ActionResult<unknown>, done: string) =>
    setNotice(res.ok ? { kind: "ok", text: done } : { kind: "error", text: res.error });

  const saveW4 = () => start(async () => {
    const res = await recordW4Action({
      ...w4,
      step3Credits: Number(w4.step3Credits),
      step4aOtherIncome: Number(w4.step4aOtherIncome),
      step4bDeductions: Number(w4.step4bDeductions),
      step4cExtraWithholding: Number(w4.step4cExtraWithholding),
    });
    report(res, t("w4.done"));
  });

  const compute = () => start(async () => {
    report(await computePayRunAction(run), t("run.done"));
  });

  return (
    <div className="space-y-6">
      <Surface as="section" padding="md" aria-labelledby="payroll-staff">
        <h2 id="payroll-staff" className="text-sm font-semibold text-[var(--dpf-text)]">{t("staff.heading")}</h2>
        <ul className="mt-2 space-y-1 text-sm text-[var(--dpf-text)]">
          {staff.map((s) => (
            <li key={s.employeeProfileId} className="flex flex-wrap justify-between gap-2">
              <span>{s.name}</span>
              <span className="text-[var(--dpf-muted)]">
                {!s.hasPay ? t("staff.noPay") : s.workState ? t("staff.w4OnFile", { state: s.workState }) : t("staff.noW4")}
              </span>
            </li>
          ))}
        </ul>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">{t("w4.summary")}</summary>
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); saveW4(); }}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className={LABEL}>{t("w4.employee")}
                <select value={w4.employeeProfileId} onChange={(e) => setW4({ ...w4, employeeProfileId: e.target.value })} className={FIELD}>
                  {paid.map((s) => <option key={s.employeeProfileId} value={s.employeeProfileId}>{s.name}</option>)}
                </select>
              </label>
              <label className={LABEL}>{t("w4.effectiveFrom")}
                <input type="date" required value={w4.effectiveFrom} onChange={(e) => setW4({ ...w4, effectiveFrom: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("w4.filingStatus")}
                <select value={w4.filingStatus} onChange={(e) => setW4({ ...w4, filingStatus: e.target.value })} className={FIELD}>
                  <option value="single">{t("w4.single")}</option>
                  <option value="married_jointly">{t("w4.marriedJointly")}</option>
                  <option value="head_of_household">{t("w4.headOfHousehold")}</option>
                </select>
              </label>
              <label className={LABEL}>{t("w4.step3")}
                <input inputMode="decimal" value={w4.step3Credits} onChange={(e) => setW4({ ...w4, step3Credits: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("w4.step4a")}
                <input inputMode="decimal" value={w4.step4aOtherIncome} onChange={(e) => setW4({ ...w4, step4aOtherIncome: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("w4.step4b")}
                <input inputMode="decimal" value={w4.step4bDeductions} onChange={(e) => setW4({ ...w4, step4bDeductions: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("w4.step4c")}
                <input inputMode="decimal" value={w4.step4cExtraWithholding} onChange={(e) => setW4({ ...w4, step4cExtraWithholding: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("w4.workState")}
                <input required maxLength={2} value={w4.workStateCode} onChange={(e) => setW4({ ...w4, workStateCode: e.target.value.toUpperCase() })} className={FIELD} />
              </label>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className={CHECK}>
                <input type="checkbox" checked={w4.step2Checked} onChange={(e) => setW4({ ...w4, step2Checked: e.target.checked })} />
                {t("w4.step2")}
              </label>
              <label className={CHECK}>
                <input type="checkbox" checked={w4.exempt} onChange={(e) => setW4({ ...w4, exempt: e.target.checked })} />
                {t("w4.exempt")}
              </label>
            </div>
            <Button type="submit" size="sm" variant="secondary" disabled={pending || paid.length === 0}>{t("w4.submit")}</Button>
          </form>
        </details>
      </Surface>

      <Surface as="section" padding="md">
        <details id="payroll-run">
          <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">{t("run.summary")}</summary>
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); compute(); }}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className={LABEL}>{t("run.periodStart")}
                <input type="date" required value={run.periodStart} onChange={(e) => setRun({ ...run, periodStart: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("run.periodEnd")}
                <input type="date" required value={run.periodEnd} onChange={(e) => setRun({ ...run, periodEnd: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("run.payDate")}
                <input type="date" required value={run.payDate} onChange={(e) => setRun({ ...run, payDate: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("run.frequency")}
                <select value={run.frequency} onChange={(e) => setRun({ ...run, frequency: e.target.value })} className={FIELD}>
                  <option value="weekly">{t("run.weekly")}</option>
                  <option value="biweekly">{t("run.biweekly")}</option>
                  <option value="semimonthly">{t("run.semimonthly")}</option>
                  <option value="monthly">{t("run.monthly")}</option>
                </select>
              </label>
            </div>
            <Button type="submit" size="sm" disabled={pending}>{t("run.submit")}</Button>
          </form>
        </details>
      </Surface>

      {notice ? (
        <p role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error" ? "text-sm text-[var(--dpf-danger)]" : "text-sm text-[var(--dpf-text)]"}>
          {notice.text}
        </p>
      ) : null}

      <section aria-labelledby="payroll-runs">
        <h2 id="payroll-runs" className="text-sm font-semibold text-[var(--dpf-text)]">{t("runs.heading")}</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--dpf-muted)]">{t("runs.none")}</p>
        ) : (
          <ul className="mt-2 space-y-3">
            {runs.map((r) => (
              <Surface as="li" padding="md" key={r.payRunId}>
                <details>
                  <summary className="cursor-pointer text-sm text-[var(--dpf-text)]">
                    {t("runs.summary", { period: r.periodLabel, payDate: r.payDateLabel, status: r.status })}
                  </summary>
                  <div className="mt-3 space-y-4">
                    <RunActions run={r} today={today} onDone={setNotice} />
                    {r.payslips.map((p) => (
                      <div key={p.payslipId} className="space-y-2 border-t border-[var(--dpf-border)] pt-3">
                        <p className="text-sm font-semibold text-[var(--dpf-text)]">{p.name}</p>
                        <Lines heading={t("runs.gross")} rows={p.earnings} />
                        <Lines heading={t("runs.deductions")} rows={p.deductions} />
                        <Lines heading={t("runs.employerTaxes")} rows={p.employerTaxes} />
                        <Lines heading={t("runs.net")} rows={[{ label: t("runs.net"), amount: p.net }]} />
                        <Lines heading={t("runs.employerCost")} rows={[{ label: t("runs.employerCost"), amount: p.employerCost }]} />
                      </div>
                    ))}
                  </div>
                </details>
              </Surface>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

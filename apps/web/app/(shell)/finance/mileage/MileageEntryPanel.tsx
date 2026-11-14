"use client";

// The three inputs mileage reimbursement was missing (BI-3DD6EFEB): a drive
// typed in without the phone app, a claim for a period, and the company's
// per-mile rate. All three sit behind one collapsed disclosure so the page's
// first job, sorting captured drives, stays the only thing visible on arrival.
//
// The current rate and its dates arrive formatted by the page.

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";
import {
  claimMyMileageAction,
  recordManualDriveAction,
  recordMileageRateAction,
} from "@/lib/actions/mileage";

export interface CurrentRateView {
  /** "$0.70" — formatted for the viewer. */
  rateLabel: string;
  fromLabel: string;
  sourceUrl: string | null;
}

const FIELD = "rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-2 py-1.5 text-sm text-[var(--dpf-text)]";
const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--dpf-muted)]";
const HEADING = "text-sm font-semibold text-[var(--dpf-text)]";

type Notice = { kind: "ok" | "error"; text: string } | null;

export function MileageEntryPanel({
  today,
  monthStart,
  canManageFinance,
  currentRate,
}: {
  today: string;
  monthStart: string;
  canManageFinance: boolean;
  currentRate: CurrentRateView | null;
}) {
  const t = useT("mileage");
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<Notice>(null);

  const [drive, setDrive] = useState({ date: today, fromLabel: "", toLabel: "", miles: "", purpose: "" });
  const [claim, setClaim] = useState({ periodStart: monthStart, periodEnd: today });
  const [rate, setRate] = useState({ amountPerMile: "", effectiveFrom: today, sourceUrl: "" });

  const report = (res: { ok: true } | { ok: false; error: string }, done: string) =>
    setNotice(res.ok ? { kind: "ok", text: done } : { kind: "error", text: res.error });

  const addDrive = () => start(async () => {
    const res = await recordManualDriveAction({ ...drive, miles: Number(drive.miles) });
    if (res.ok) setDrive((d) => ({ ...d, fromLabel: "", toLabel: "", miles: "", purpose: "" }));
    report(res, t("drive.done"));
  });

  const claimDrives = () => start(async () => {
    const res = await claimMyMileageAction(claim);
    // The claim id is what the person needs to find it; the drives table and the
    // expense claims page show the money, formatted on the server.
    report(res, res.ok ? t("claim.done", { claimId: res.data.claimId }) : "");
  });

  const saveRate = () => start(async () => {
    const res = await recordMileageRateAction({ ...rate, amountPerMile: Number(rate.amountPerMile) });
    if (res.ok) setRate((r) => ({ ...r, amountPerMile: "", sourceUrl: "" }));
    report(res, t("rate.done"));
  });

  return (
    <Surface as="section" padding="md" className="mb-6">
      <details id="mileage-entry">
        <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">{t("summary")}</summary>

        <div className="mt-4 space-y-6">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addDrive(); }}>
            <h2 className={HEADING}>{t("drive.heading")}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className={LABEL}>{t("drive.date")}
                <input type="date" required max={today} value={drive.date}
                  onChange={(e) => setDrive({ ...drive, date: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("drive.from")}
                <input required value={drive.fromLabel}
                  onChange={(e) => setDrive({ ...drive, fromLabel: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("drive.to")}
                <input required value={drive.toLabel}
                  onChange={(e) => setDrive({ ...drive, toLabel: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("drive.miles")}
                <input required inputMode="decimal" value={drive.miles}
                  onChange={(e) => setDrive({ ...drive, miles: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>{t("drive.purpose")}
                <input required value={drive.purpose}
                  onChange={(e) => setDrive({ ...drive, purpose: e.target.value })} className={FIELD} />
              </label>
            </div>
            <Button type="submit" size="sm" disabled={pending}>{t("drive.submit")}</Button>
          </form>

          {canManageFinance ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); claimDrives(); }}>
              <h2 className={HEADING}>{t("claim.heading")}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={LABEL}>{t("claim.start")}
                  <input type="date" required value={claim.periodStart}
                    onChange={(e) => setClaim({ ...claim, periodStart: e.target.value })} className={FIELD} />
                </label>
                <label className={LABEL}>{t("claim.end")}
                  <input type="date" required value={claim.periodEnd}
                    onChange={(e) => setClaim({ ...claim, periodEnd: e.target.value })} className={FIELD} />
                </label>
              </div>
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>{t("claim.submit")}</Button>
            </form>
          ) : null}

          {canManageFinance ? (
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveRate(); }}>
              <h2 className={HEADING}>{t("rate.heading")}</h2>
              <p className="text-sm text-[var(--dpf-muted)]">
                {currentRate ? t("rate.current", { rate: currentRate.rateLabel, from: currentRate.fromLabel }) : t("rate.none")}
                {currentRate?.sourceUrl ? (
                  <>
                    {" "}
                    <a href={currentRate.sourceUrl} target="_blank" rel="noreferrer"
                      className="text-[var(--dpf-accent)] underline-offset-2 hover:underline">{t("rate.sourceLink")}</a>
                  </>
                ) : null}
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className={LABEL}>{t("rate.amount")}
                  <input required inputMode="decimal" value={rate.amountPerMile}
                    onChange={(e) => setRate({ ...rate, amountPerMile: e.target.value })} className={FIELD} />
                </label>
                <label className={LABEL}>{t("rate.effectiveFrom")}
                  <input type="date" required value={rate.effectiveFrom}
                    onChange={(e) => setRate({ ...rate, effectiveFrom: e.target.value })} className={FIELD} />
                </label>
                <label className={LABEL}>{t("rate.sourceUrl")}
                  <input type="url" required value={rate.sourceUrl}
                    onChange={(e) => setRate({ ...rate, sourceUrl: e.target.value })} className={FIELD} />
                </label>
              </div>
              <Button type="submit" size="sm" variant="secondary" disabled={pending}>{t("rate.submit")}</Button>
            </form>
          ) : null}

          {notice ? (
            <p role={notice.kind === "error" ? "alert" : "status"}
              className={notice.kind === "error" ? "text-sm text-[var(--dpf-danger)]" : "text-sm text-[var(--dpf-text)]"}>
              {notice.text}
            </p>
          ) : null}
        </div>
      </details>
    </Surface>
  );
}

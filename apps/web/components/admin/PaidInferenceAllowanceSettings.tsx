"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { savePaidInferenceAllowance } from "@/lib/actions/paid-inference-allowance";
import { useMessagesContext } from "@/lib/i18n/messages-context";
import { useT } from "@/lib/i18n/use-t";
import { formatMoney } from "@/lib/org-locale/org-locale";

// BI-F3B6713F: the owner's one control for how much paid AI the platform may
// use per day. Local and subscription models cost nothing extra and are never
// limited by it. Without a recorded amount, each coworker's built-in daily
// cap applies to its paid usage instead. Copy lives in the "admin" catalog
// under paidAiAllowance; the page provides that namespace. Rendered inside the
// closed "Daily limits" disclosure of the autopilot card, so it adds nothing to
// what the page shows on arrival.

interface PaidInferenceAllowanceSettingsProps {
  dailyUsd: number | null;
  spentTodayUsd: number;
  setAt: string | null;
  setByEmail: string | null;
  reason: string | null;
}

export function PaidInferenceAllowanceSettings(props: PaidInferenceAllowanceSettingsProps) {
  const t = useT("admin");
  const { locale } = useMessagesContext();
  const money = (value: number) => formatMoney(value, "USD", locale);
  const [amount, setAmount] = useState(props.dailyUsd === null ? "" : String(props.dailyUsd));
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stored = props.dailyUsd === null ? "" : String(props.dailyUsd);
  const dirty = amount.trim() !== stored;

  const handleSave = () => {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await savePaidInferenceAllowance({
        dailyUsd: amount.trim() === "" ? null : Number(amount),
        reason,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setReason("");
    });
  };

  const fieldClass = "rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";
  const labelClass = "block text-xs font-medium text-[var(--dpf-text)] mb-1";
  const lastChanged = props.setAt
    ? props.setByEmail
      ? t("paidAiAllowance.lastChangedBy", { date: props.setAt.slice(0, 10), by: props.setByEmail })
      : t("paidAiAllowance.lastChanged", { date: props.setAt.slice(0, 10) })
    : null;

  return (
    <div className="space-y-3 border-t border-[var(--dpf-border)] pt-3" data-testid="paid-inference-allowance">
      <div>
        <h3 className="text-xs font-semibold text-[var(--dpf-text)] mb-1">{t("paidAiAllowance.heading")}</h3>
        <p className="text-[var(--dpf-muted)]">
          {props.dailyUsd === null
            ? t("paidAiAllowance.notSet")
            : t("paidAiAllowance.current", { allowance: money(props.dailyUsd), spent: money(props.spentTodayUsd) })}
          {" "}{t("paidAiAllowance.scope")}
        </p>
      </div>
      <div>
        <label className={labelClass} htmlFor="paid-inference-daily-usd">{t("paidAiAllowance.amountLabel")}</label>
        <input
          id="paid-inference-daily-usd"
          type="number"
          min={0}
          step="0.01"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setSaved(false);
          }}
          className={`w-32 ${fieldClass}`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="paid-inference-reason">{t("paidAiAllowance.reasonLabel")}</label>
        <input
          id="paid-inference-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`w-full ${fieldClass}`}
        />
      </div>
      {lastChanged && (
        <p className="text-[var(--dpf-muted)]">{lastChanged}{props.reason ? `: ${props.reason}` : ""}</p>
      )}
      {error && (
        <p className="text-xs text-[var(--dpf-error)]" role="alert">{error}</p>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={isPending || !dirty || !reason.trim()}>
          {isPending ? t("paidAiAllowance.saving") : t("paidAiAllowance.save")}
        </Button>
        {saved && <span className="text-xs text-[var(--dpf-success)]">{t("paidAiAllowance.saved")}</span>}
      </div>
    </div>
  );
}

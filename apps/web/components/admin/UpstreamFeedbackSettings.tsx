"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { setUpstreamFeedbackOptIn } from "@/lib/actions/feedback-escalation";
import { useT } from "@/lib/i18n/use-t";

// BI-6ED89EC6: the one standing place to let this installation's problems reach
// the project team. Until this existed the switch appeared only mid-escalation,
// inside the error and feedback forms — so an installation where nobody ever
// pressed "Report to the project team" had no way to turn on the daily sweep,
// and the sweep halted every day with nobody told. It lives on its own page,
// /admin/issue-reports/upstream, which the sweep's "Needs you" item links to.

export const UPSTREAM_FEEDBACK_ANCHOR = "upstream-feedback";

interface UpstreamFeedbackSettingsProps {
  optIn: boolean;
  /** Private (legacy fork-only) installations keep everything local; the switch cannot apply. */
  forkOnly: boolean;
  /** The master pause overrides this switch. */
  paused: boolean;
  /** Only someone who manages the platform may change it; everyone else sees the state. */
  mayChange?: boolean;
}

export function UpstreamFeedbackSettings(props: UpstreamFeedbackSettingsProps) {
  const t = useT("admin");
  const [optIn, setOptIn] = useState(props.optIn);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockedReason = props.forkOnly
    ? t("upstreamFeedback.reasonPrivate")
    : props.paused
      ? t("upstreamFeedback.reasonPaused")
      : props.mayChange === false
        ? t("upstreamFeedback.reasonNoAuthority")
        : null;
  const dirty = optIn !== props.optIn;

  const handleSave = () => {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await setUpstreamFeedbackOptIn({ enabled: optIn });
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } catch (err) {
        setError(err instanceof Error && err.message ? err.message : t("upstreamFeedback.saveFailed"));
      }
    });
  };

  return (
    <div
      id={UPSTREAM_FEEDBACK_ANCHOR}
      className="max-w-xl space-y-4 rounded-lg border border-[var(--dpf-border)] p-4"
      data-testid="upstream-feedback-settings"
    >
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">{t("upstreamFeedback.heading")}</h2>
        <p className="text-xs text-[var(--dpf-muted)]">{t("upstreamFeedback.explanation")}</p>
      </div>

      <label className={`flex items-start gap-3 ${blockedReason ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
        <input
          type="checkbox"
          checked={optIn}
          disabled={Boolean(blockedReason) || isPending}
          onChange={(e) => {
            setOptIn(e.target.checked);
            setSaved(false);
          }}
          className="mt-0.5 accent-[var(--dpf-accent)]"
          data-testid="upstream-feedback-opt-in"
        />
        <div>
          <span className="text-sm font-medium text-[var(--dpf-text)]">{t("upstreamFeedback.switchLabel")}</span>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            {blockedReason ?? (optIn ? t("upstreamFeedback.stateOn") : t("upstreamFeedback.stateOff"))}
          </p>
        </div>
      </label>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={!dirty || isPending || Boolean(blockedReason)} data-testid="upstream-feedback-save">
          {isPending ? t("upstreamFeedback.saving") : t("upstreamFeedback.save")}
        </Button>
        {saved && <span className="text-xs text-[var(--dpf-success)]" role="status">{t("upstreamFeedback.saved")}</span>}
        {error && <span className="text-xs text-[var(--dpf-error)]" role="alert">{error}</span>}
      </div>
    </div>
  );
}

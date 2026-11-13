"use client";

import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { setUpstreamFeedbackOptIn } from "@/lib/actions/feedback-escalation";
import { useT } from "@/lib/i18n/use-t";
import { OWNER_FIRST_NEXT_ACTION_ATTR } from "@/lib/owner-first/ux-audit";

// BI-6ED89EC6: the one standing place to let this installation's problems reach
// the project team. Until this existed the switch appeared only mid-escalation,
// inside the error and feedback forms — so an installation where nobody ever
// pressed "Report to the project team" had no way to turn on the daily sweep,
// and the sweep halted every day with nobody told. It lives on its own page,
// /admin/issue-reports/upstream, which the sweep's "Needs you" item links to.
//
// The page's whole job is to answer "do problems found here leave this
// installation?", so the state line always describes what is SAVED. A changed,
// unsaved switch says so in words, and a save is only reported once the action
// confirms it — the saved value it returns becomes the new baseline.

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
  const stateId = useId();
  const [savedOptIn, setSavedOptIn] = useState(props.optIn);
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
  const locked = Boolean(blockedReason) || isPending;
  const dirty = optIn !== savedOptIn;
  const stateText = blockedReason
    ?? (dirty
      ? t(optIn ? "upstreamFeedback.pendingOn" : "upstreamFeedback.pendingOff")
      : t(savedOptIn ? "upstreamFeedback.stateOn" : "upstreamFeedback.stateOff"));

  const handleSave = () => {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        const result = await setUpstreamFeedbackOptIn({ enabled: optIn });
        // Only a confirmed save is reported as saved, and its returned value is
        // what the page now shows as true.
        if (!result || result.ok !== true || typeof result.optIn !== "boolean") {
          setError(t("upstreamFeedback.saveFailed"));
          return;
        }
        setSavedOptIn(result.optIn);
        setOptIn(result.optIn);
        setSaved(true);
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

      {/* The one thing the owner does here: decide whether problems leave. */}
      <label
        className={`flex items-start gap-3 ${blockedReason ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
        {...{ [OWNER_FIRST_NEXT_ACTION_ATTR]: "" }}
      >
        <input
          type="checkbox"
          checked={optIn}
          // aria-disabled rather than disabled: a control blocked by policy stays
          // in the tab order, so a keyboard user reaches the reason it cannot change.
          aria-disabled={locked}
          aria-describedby={stateId}
          onChange={(e) => {
            if (locked) return;
            setOptIn(e.target.checked);
            setSaved(false);
            setError(null);
          }}
          className="mt-0.5 accent-[var(--dpf-accent)]"
          data-testid="upstream-feedback-opt-in"
        />
        <div>
          <span className="text-sm font-medium text-[var(--dpf-text)]">{t("upstreamFeedback.switchLabel")}</span>
          <p id={stateId} className="text-xs text-[var(--dpf-muted)] mt-0.5" data-testid="upstream-feedback-state">
            {stateText}
          </p>
        </div>
      </label>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={!dirty || locked} data-testid="upstream-feedback-save">
          {isPending ? t("upstreamFeedback.saving") : t("upstreamFeedback.save")}
        </Button>
        {/* Live regions stay mounted so a screen reader announces the outcome when it arrives. */}
        <span className="text-xs text-[var(--dpf-success)]" role="status" aria-live="polite">
          {saved ? t("upstreamFeedback.saved") : ""}
        </span>
        <span className="text-xs text-[var(--dpf-error)]" role="alert" aria-live="assertive">
          {error ?? ""}
        </span>
      </div>
    </div>
  );
}

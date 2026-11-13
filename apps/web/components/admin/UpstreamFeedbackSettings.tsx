"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { setUpstreamFeedbackOptIn } from "@/lib/actions/feedback-escalation";

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
  const [optIn, setOptIn] = useState(props.optIn);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockedReason = props.forkOnly
    ? "This installation keeps everything on its own system, so nothing can be sent."
    : props.paused
      ? "Contributions are paused for this installation, which overrides this switch."
      : props.mayChange === false
        ? "Only someone who manages the platform can change this."
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
        setError(err instanceof Error && err.message ? err.message : "Could not save. Try again.");
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
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">
          Send problems found here to the project team
        </h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          On: once a day, problems this installation has already triaged are sent to the project team so
          they can be fixed and voted on by other installations. Each report is redacted and sent under this
          installation&apos;s pseudonym, never a person&apos;s name. Nothing is sent while this is off.
        </p>
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
          <span className="text-sm font-medium text-[var(--dpf-text)]">Upstream feedback</span>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            {blockedReason ?? (optIn ? "On — triaged problems are sent daily." : "Off — nothing leaves this installation.")}
          </p>
        </div>
      </label>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={!dirty || isPending || Boolean(blockedReason)} data-testid="upstream-feedback-save">
          {isPending ? "Saving…" : "Save"}
        </Button>
        {saved && <span className="text-xs text-[var(--dpf-success)]" role="status">Saved</span>}
        {error && <span className="text-xs text-[var(--dpf-error)]" role="alert">{error}</span>}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { saveGovernedBacklogSettings } from "@/lib/actions/governed-backlog-settings";

// BI-CEFF2535: the one place an operator turns Build Studio's governed backlog
// lane on. Everything downstream (auto-approved drafts, the 14:00 UTC daily
// tee-up, capacity drain) reads PlatformDevConfig.governedBacklogEnabled; until
// this control existed the flag could only be changed by editing the database.

interface GovernedBacklogSettingsProps {
  enabled: boolean;
  dailyCap: number;
  playbookMode: "off" | "shadow" | "enforce";
}

export function GovernedBacklogSettings(props: GovernedBacklogSettingsProps) {
  const [enabled, setEnabled] = useState(props.enabled);
  const [dailyCap, setDailyCap] = useState(String(props.dailyCap));
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = enabled !== props.enabled || dailyCap !== String(props.dailyCap);

  const handleSave = () => {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await saveGovernedBacklogSettings({ enabled, dailyCap: Number(dailyCap) });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <div className="max-w-xl space-y-4 rounded-lg border border-[var(--dpf-border)] p-4" data-testid="governed-backlog-settings">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-1">Let Build Studio pick up work on its own</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          On: a backlog item triaged to build starts without an approve click. Once a day the
          platform tees up the next eligible items itself. Every build still passes the same
          gates, review and merge queue.
        </p>
      </div>

      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSaved(false);
          }}
          className="mt-0.5 accent-[var(--dpf-accent)]"
          data-testid="governed-backlog-enabled"
        />
        <div>
          <span className="text-sm font-medium text-[var(--dpf-text)]">Governed backlog lane</span>
          <p className="text-xs text-[var(--dpf-muted)] mt-0.5">
            {enabled
              ? "On: promoted drafts start automatically and the daily tee-up runs."
              : "Off: every promoted draft waits for you to approve the start, and nothing is teed up."}
          </p>
        </div>
      </label>

      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--dpf-accent)]">Daily limit and the autopilot switches</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-[var(--dpf-text)] mb-1" htmlFor="governed-backlog-daily-cap">
              Items teed up per day
            </label>
            <input
              id="governed-backlog-daily-cap"
              type="number"
              min={0}
              max={50}
              value={dailyCap}
              onChange={(e) => {
                setDailyCap(e.target.value);
                setSaved(false);
              }}
              className="w-24 rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-1.5 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none"
            />
          </div>
          <p className="text-[var(--dpf-muted)]">
            Phase advancement is governed by the Living Playbook switch, currently{" "}
            <strong>{props.playbookMode}</strong>.
            {props.playbookMode === "off" && " Off: a started build stops at each phase for your decision."}
            {props.playbookMode === "shadow" && " Shadow: it records what it would do, without acting."}
            {props.playbookMode === "enforce" && " Enforce: an evidence-cleared build advances itself."}
            {" "}That is the host setting DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE. It applies on the next self-upgrade.
          </p>
        </div>
      </details>

      {error && (
        <p className="text-xs text-[var(--dpf-error)]" role="alert">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={isPending || !dirty}>
          {isPending ? "Saving..." : "Save"}
        </Button>
        {saved && <span className="text-xs text-[var(--dpf-success)]">Saved</span>}
      </div>
    </div>
  );
}

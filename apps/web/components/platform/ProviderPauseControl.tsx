"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { LocalTime } from "@/components/ui/LocalTime";
import { fieldControlClass, fieldOptionClass } from "@/components/ui/form/styles";
import { useT } from "@/lib/i18n/use-t";
import { toggleProviderStatus } from "@/lib/actions/ai-providers";
import { getProviderPause, pauseProvider, resumeProvider } from "@/lib/actions/provider-operator-pause";

export function ProviderPauseControl({ providerId, initialStatus, initialPause, initialConnectionStatus }: {
  providerId: string; initialStatus: string;
  initialPause?: { resumeAt: string | null; pausedAt?: string } | null;
  initialConnectionStatus?: string | null;
}) {
  const t = useT("setup");
  const [status, setStatus] = useState(initialStatus);
  const [pause, setPause] = useState<{ resumeAt: string | null } | null>(initialPause ?? null);
  const [connectionStatus, setConnectionStatus] = useState(initialConnectionStatus);
  const [editing, setEditing] = useState(false);
  const [duration, setDuration] = useState("24");
  const [unit, setUnit] = useState<"hours" | "days">("hours");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const actionVersion = useRef(0);
  const id = useId();
  const router = useRouter();
  const stopped = pause !== null || ["paused", "inactive", "disabled"].includes(connectionStatus ?? "")
    || (connectionStatus === undefined && (status === "inactive" || status === "disabled"));
  const unavailable = !stopped && !["active", "degraded", "unconfigured"].includes(status);

  useEffect(() => {
    if (initialPause !== undefined) { setPause(initialPause); return; }
    let live = true;
    const version = actionVersion.current;
    getProviderPause(providerId).then(result => {
      if (live && actionVersion.current === version) setPause(result);
    }).catch(() => { if (live && actionVersion.current === version) setMessage(t("providerPause.loadFailed")); });
    return () => { live = false; };
  }, [providerId, initialStatus, initialPause?.resumeAt, initialPause?.pausedAt, initialPause === null]);
  useEffect(() => { setStatus(initialStatus); }, [initialStatus]);
  useEffect(() => { setConnectionStatus(initialConnectionStatus); }, [initialConnectionStatus]);

  function perform(action: () => Promise<void>) {
    actionVersion.current++;
    setMessage(null);
    startTransition(async () => {
      try { await action(); router.refresh(); }
      catch (error) { setMessage(error instanceof Error ? error.message : t("providerPause.updateFailed")); }
    });
  }
  function pauseNow() {
    perform(async () => {
      const result = await pauseProvider(providerId);
      setPause({ resumeAt: result.resumeAt }); setConnectionStatus("paused"); setEditing(false); setMessage(result.warning);
    });
  }
  function resumeNow() {
    perform(async () => {
      if (!pause && connectionStatus !== "paused") {
        const result = await toggleProviderStatus(providerId);
        setStatus(result.status); setMessage(result.warning);
        setConnectionStatus(result.status);
      } else {
        const result = await resumeProvider(providerId);
        if (result.outcome !== "resumed") throw new Error(t("providerPause.pauseChanged"));
        setStatus(result.status ?? "inactive");
        setConnectionStatus(result.connectionStatus ?? "active");
        setMessage(["active", "degraded"].includes(result.status ?? "") ? null : t("providerPause.stillUnavailable"));
      }
      setPause(null); setEditing(false);
    });
  }
  function saveTime() {
    const value = Number(duration);
    if (!Number.isFinite(value) || value <= 0) { setMessage(t("providerPause.positiveDuration")); return; }
    perform(async () => {
      const result = await pauseProvider(providerId, { value, unit });
      setPause({ resumeAt: result.resumeAt }); setConnectionStatus("paused"); setEditing(false); setMessage(result.warning);
    });
  }

  return (
    <div className="flex flex-col items-start gap-2 text-xs" aria-busy={isPending}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge size="md" variant="soft" uppercase={false}
          intent={stopped || unavailable || status === "degraded" ? "warning" : status === "unconfigured" ? "neutral" : "success"}
          label={pause || connectionStatus === "paused" ? t("providerPause.paused") : stopped ? t("providerPause.disabled") : unavailable ? t("providerPause.unavailable") : status === "unconfigured" ? t("providerPause.notSetUp") : status === "degraded" ? t("providerPause.degraded") : t("providerPause.active")} />
        <Button size="sm" variant="secondary" disabled={isPending || (!stopped && status === "unconfigured")} onClick={stopped ? resumeNow : pauseNow}>
          {isPending ? t("providerPause.updating") : stopped ? t("providerPause.resumeNow") : t("providerPause.pauseNow")}
        </Button>
        {stopped && <Button size="sm" variant="ghost" disabled={isPending} aria-expanded={editing} aria-controls={`${id}-time`} onClick={() => setEditing(!editing)}>
          {pause?.resumeAt ? t("providerPause.changePause") : t("providerPause.setResumeTime")}
        </Button>}
      </div>
      {stopped && <p className="text-[var(--dpf-muted)]" aria-live="polite">
        {pause?.resumeAt ? <>{t("providerPause.resumes")} <time dateTime={pause.resumeAt}><LocalTime value={pause.resumeAt} /></time></> : t("providerPause.indefinite")}
      </p>}
      {editing && <fieldset id={`${id}-time`} disabled={isPending} className="flex max-w-full flex-wrap items-end gap-2">
        <label htmlFor={`${id}-duration`} className="flex flex-col gap-1">{t("providerPause.duration")}
          <input id={`${id}-duration`} type="number" min="0" step="any" required value={duration} onChange={event => setDuration(event.target.value)} className={`${fieldControlClass} max-w-20`} />
        </label>
        <label htmlFor={`${id}-unit`} className="flex flex-col gap-1">{t("providerPause.unit")}
          <select id={`${id}-unit`} value={unit} onChange={event => setUnit(event.target.value as "hours" | "days")} className={fieldControlClass}>
            <option value="hours" className={fieldOptionClass}>{t("providerPause.hours")}</option><option value="days" className={fieldOptionClass}>{t("providerPause.days")}</option>
          </select>
        </label>
        <Button size="sm" onClick={saveTime}>{t("providerPause.save")}</Button>
        {pause?.resumeAt && <Button size="sm" variant="ghost" onClick={pauseNow}>{t("providerPause.keepPaused")}</Button>}
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("providerPause.cancel")}</Button>
      </fieldset>}
      {message && <p role="alert" className="max-w-sm text-[var(--dpf-warning)]">{message}</p>}
    </div>
  );
}

export const LocalProviderPauseControl = ProviderPauseControl;

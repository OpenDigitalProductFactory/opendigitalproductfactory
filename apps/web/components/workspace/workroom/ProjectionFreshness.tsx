"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { useDeadlineClock } from "@/components/ui/useDeadlineClock";
import { useT } from "@/lib/i18n/use-t";

const SNAPSHOT_TIME_FORMAT: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false };
export type ProjectionRefreshControl = { onRefresh?: () => void; pending?: boolean; notice?: string | null };
/** Snapshot age describes this read, never provider health or execution progress. */
export function ProjectionFreshness({ readAt, lastEvidenceAt, onRefresh, pending = false, notice }: {
  readAt: string | null; lastEvidenceAt: string | null;
} & ProjectionRefreshControl) {
  const readTime = readAt ? Date.parse(readAt) : NaN;
  const { now } = useDeadlineClock(readTime + 60_000);
  const unknown = now === null || !Number.isFinite(readTime) || readTime > now;
  const stale = !unknown && now - readTime >= 60_000;
  const t = useT("workrooms");
  const [connectivity, setConnectivity] = useState<"unknown" | "offline" | "restored">("unknown");
  useEffect(() => {
    const offline = () => setConnectivity("offline");
    const online = () => setConnectivity(previous => previous === "offline" ? "restored" : previous);
    if (!navigator.onLine) offline();
    window.addEventListener("offline", offline); window.addEventListener("online", online);
    return () => { window.removeEventListener("offline", offline); window.removeEventListener("online", online); };
  }, []);
  const message = connectivity === "offline" ? t("refresh.offline") : notice ?? (connectivity === "restored" ? t("refresh.restored") : null);
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p aria-live="polite" aria-atomic="true">{unknown ? "Snapshot age unknown." : stale ? "Snapshot stale. Refresh to check." : "Recent snapshot."}
        {message ? <> <span>{message}</span></> : null}</p>
      <p>Checked: <LocalTime value={Number.isFinite(readTime) ? readAt : null} options={SNAPSHOT_TIME_FORMAT} fallback="Unknown" />
        {" · Evidence: "}<LocalTime value={lastEvidenceAt} options={SNAPSHOT_TIME_FORMAT} fallback="Unknown" /></p>
    </div>
    {onRefresh ? <Button variant="secondary" className="min-h-11 aria-disabled:cursor-wait aria-disabled:opacity-60"
      aria-disabled={pending} aria-busy={pending} onClick={() => {
        if (pending) return;
        if (!navigator.onLine) { setConnectivity("offline"); return; }
        setConnectivity("unknown"); onRefresh();
      }}>{pending ? "Refreshing state…" : "Refresh state"}</Button> : null}
  </div>;
}

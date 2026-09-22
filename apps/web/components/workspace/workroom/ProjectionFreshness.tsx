"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { useDeadlineClock } from "@/components/ui/useDeadlineClock";

const SNAPSHOT_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
};

/** Snapshot age describes this read, never provider health or execution progress. */
export function ProjectionFreshness({ readAt, lastEvidenceAt }: {
  readAt: string | null;
  lastEvidenceAt: string | null;
}) {
  const readTime = readAt ? Date.parse(readAt) : NaN;
  const { now } = useDeadlineClock(readTime + 60_000);
  const unknown = now === null || !Number.isFinite(readTime) || readTime > now;
  const stale = !unknown && now - readTime >= 60_000;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p aria-live="polite" aria-atomic="true">{unknown ? "Snapshot age unknown." : stale
        ? "Snapshot stale. Refresh to check." : "Recent snapshot."}</p>
      <p>Checked: <LocalTime value={Number.isFinite(readTime) ? readAt : null} options={SNAPSHOT_TIME_FORMAT} fallback="Unknown" />
        {" · Evidence: "}<LocalTime value={lastEvidenceAt} options={SNAPSHOT_TIME_FORMAT} fallback="Unknown" /></p>
    </div>
    <Button variant="secondary" className="min-h-11" disabled={pending}
      onClick={() => startTransition(() => router.refresh())}>
      {pending ? "Refreshing state…" : "Refresh state"}
    </Button>
  </div>;
}

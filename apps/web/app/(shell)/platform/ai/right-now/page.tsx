// apps/web/app/(shell)/platform/ai/right-now/page.tsx
//
// "Right Now" — the lean live cockpit for what's happening on this install this
// moment (BI-1A68257F / EP-FULL-OBS). It answers the founder-observed gap: the
// AI workforce surfaces had NO realtime resource visibility, so "why is memory
// at 90%, and did the local model just kick in?" could only be answered from
// Windows Task Manager. The Operations Map remains the deep analytical/planning
// view (topology, replay, scheduled-job forecasts); this page is deliberately
// "right now" only — resource pressure + who's working, nothing scheduled.
//
// Design grounding: extends EP-FULL-OBS. Source of truth for resource signals is
// the Docker socket + /proc/meminfo (see resource-pressure.ts); for active work,
// the operations-map TaskRun read model (reused, not re-projected). No new
// contract — a new read-only observability surface over existing substrate.

import Link from "next/link";
import { auth } from "@/lib/auth";
import { LocalTime } from "@/components/ui/LocalTime";
import { loadResourcePressure } from "@/lib/platform-runtime/resource-pressure";
import { loadActiveWork } from "@/lib/platform-runtime/right-now-activity";
import { RightNowLiveShell } from "@/components/platform/RightNowLiveShell";

export const dynamic = "force-dynamic";

export default async function RightNowPage() {
  await auth(); // (shell)/platform layout gates platform access; render read-only.

  const [snapshot, activeWork] = await Promise.all([
    loadResourcePressure(),
    loadActiveWork(),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-[var(--dpf-text)]">Right Now</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Live resource pressure and active work on this install. For the routing
          topology, replay, and scheduled-job forecasts, see the{" "}
          <Link className="text-[var(--dpf-accent)] underline" href="/platform/ai/operations-map">
            Operations Map
          </Link>
          ; for which model runs each build phase, see{" "}
          <Link className="text-[var(--dpf-accent)] underline" href="/platform/ai/runtime-health">
            Runtime Health
          </Link>
          .
        </p>
      </header>

      <RightNowLiveShell initialData={snapshot} />

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Working now</h2>
          <span className="text-xs text-[var(--dpf-muted)]">
            {activeWork.length === 0 ? "idle" : `${activeWork.length} active`} · page-load snapshot
          </span>
        </div>
        {activeWork.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">
            No active or waiting task runs right now.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--dpf-border)]">
            {activeWork.map((item) => (
              <li key={item.taskRunId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm text-[var(--dpf-text)]" title={item.title ?? undefined}>
                    {item.title ?? "Untitled task"}
                  </div>
                  <div className="text-[11px] text-[var(--dpf-muted)]">
                    {item.agentId ?? "unassigned"}
                    {item.startedAt ? (
                      <>
                        {" · started "}
                        <LocalTime value={item.startedAt} mode="time" />
                      </>
                    ) : null}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                  style={{
                    background: "var(--dpf-surface-2)",
                    color: item.needsAttention ? "var(--dpf-warning)" : "var(--dpf-accent)",
                  }}
                >
                  {item.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

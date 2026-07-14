// apps/web/components/twin/TwinQueue.tsx
//
// Primitive 5/10 — queue: ordered demand awaiting allocation (waitlist +
// reservations / dispatch queue / reservations to fill). The heartbeat of the
// twin. Each row can carry the cog's inline suggestion for that item; the
// tap-to-confirm itself lives on the CogBanner (HITL). Pure + server-usable.

import { Bot } from "lucide-react";

import type { QueueItemData } from "./types";

export interface TwinQueueProps {
  label: string;
  items: QueueItemData[];
  /** Shown when the queue is empty — an idle queue is good news, say so. */
  emptyLabel?: string;
  className?: string;
}

export function TwinQueue({ label, items, emptyLabel, className = "" }: TwinQueueProps) {
  return (
    <section
      className={`rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] ${className}`.trim()}
    >
      <header className="flex items-center justify-between gap-2 border-b border-[var(--dpf-border)] px-3 py-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
          {label}
        </h4>
        <span className="rounded-full bg-[var(--dpf-surface-3)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--dpf-text-secondary)]">
          {items.length}
        </span>
      </header>

      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-[11px] text-[var(--dpf-muted)]">
          {emptyLabel ?? "Queue clear"}
        </p>
      ) : (
        <ol className="divide-y divide-[var(--dpf-border)]">
          {items.map((item, i) => (
            <li key={item.key} className="flex flex-col gap-1 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="text-[10px] tabular-nums text-[var(--dpf-muted)]">
                    {i + 1}
                  </span>
                  <span className="text-xs font-medium text-[var(--dpf-text)]">
                    {item.label}
                  </span>
                </span>
                {item.waiting ? (
                  <span className="text-[10px] tabular-nums text-[var(--dpf-muted)]">
                    {item.waiting}
                  </span>
                ) : null}
              </div>
              {item.meta ? (
                <span className="pl-5 text-[11px] text-[var(--dpf-muted)]">{item.meta}</span>
              ) : null}
              {item.suggestion ? (
                <span
                  className="ml-5 inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "var(--dpf-accent-soft)",
                    color: "var(--dpf-accent)",
                  }}
                >
                  <Bot aria-hidden size={11} />
                  {item.suggestion}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

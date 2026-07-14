// apps/web/components/twin/NeedsYouQuests.tsx
//
// Primitive 10/10 — needs-you quests: the attention queue pinned to twin context
// (6-top blocked / emergencies unassigned / overdue return). The single
// "what-needs-you-now" surface — the escalation channel for anything the cog
// can't resolve without a human judgment (parent spec §3, WWWD gate §7). Pure +
// server-usable.

import { intentStyle } from "@/components/ui/report-kit";

import type { QuestData } from "./types";

export interface NeedsYouQuestsProps {
  quests: QuestData[];
  emptyLabel?: string;
  className?: string;
}

export function NeedsYouQuests({ quests, emptyLabel, className = "" }: NeedsYouQuestsProps) {
  if (quests.length === 0) {
    return (
      <p className={`text-[11px] text-[var(--dpf-muted)] ${className}`.trim()}>
        {emptyLabel ?? "Nothing needs you right now"}
      </p>
    );
  }
  return (
    <ul className={`flex flex-col gap-2 ${className}`.trim()}>
      {quests.map((q) => {
        const style = intentStyle(q.intent ?? "warning");
        return (
          <li
            key={q.key}
            className="flex items-start gap-2 rounded-md border bg-[var(--dpf-surface-1)] p-2"
            style={{ borderLeftColor: style.border, borderLeftWidth: "3px" }}
          >
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-xs font-semibold text-[var(--dpf-text)]">{q.title}</span>
              {q.detail ? (
                <span className="text-[11px] text-[var(--dpf-muted)]">{q.detail}</span>
              ) : null}
            </div>
            {q.cta ? (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: style.softBg, color: style.fg }}
              >
                {q.cta}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

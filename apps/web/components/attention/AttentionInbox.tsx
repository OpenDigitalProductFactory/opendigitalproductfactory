// The "Needs you" inbox — the full attention queue on /workspace/inbox.
// Presentational + server-rendered: takes the ordered projector output and renders
// each item with its triage CONTEXT (why it's here, what's blocked, how urgent),
// never a composite priority number. Deep-links out to the owning surface for
// heavy context. Spec §4.4, §6. nowMs is injected so age is deterministic.

import Link from "next/link";
import type { AttentionItem, AttentionSource } from "@/lib/attention/types";
import {
  residueReasonLabel,
  riskLabel,
  decideEffortLabel,
  attentionAgeLabel,
  isOverrideTier,
  overrideReason,
  summarizeAttention,
} from "@/lib/attention/triage";

const SOURCE_LABEL: Record<AttentionSource, string> = {
  escalation: "Build escalation",
  "ai-decision": "AI decision",
  "paused-ai": "Paused AI",
  "scheduled-task": "Scheduled work",
  "agent-proposal": "Approval",
  "approval-outbound": "Marketing",
  "approval-bill": "Bill",
  "approval-expense": "Expense",
  "compliance-submission": "Compliance",
  "research-proposal": "Research",
  "ai-readiness-blocker": "AI readiness",
  "platform-health": "Platform health",
  "work-item-mention": "Mention",
};

export function AttentionInbox({
  items,
  failedSources,
  nowMs,
}: {
  items: AttentionItem[];
  failedSources: AttentionSource[];
  nowMs: number;
}) {
  return (
    <div className="space-y-3">
      {failedSources.length > 0 ? (
        <p className="rounded border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-3 py-2 text-[11px] text-[var(--dpf-muted)]">
          Couldn&apos;t load: {failedSources.map((s) => SOURCE_LABEL[s]).join(", ")}. The rest of your
          queue is shown.
        </p>
      ) : null}

      {items.length === 0 ? (
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6 text-center">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Nothing needs you right now</h2>
          <p className="mx-auto mt-1 max-w-prose text-sm text-[var(--dpf-muted)]">
            When the AI can&apos;t resolve a decision on its own — an escalation, an approval, a paused
            coworker — it lands here with the context to act. Until then, you&apos;re clear.
          </p>
        </section>
      ) : (
        <>
          <AttentionSummaryHeader items={items} />
          <ul className="divide-y divide-[var(--dpf-border)] overflow-hidden rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            {items.map((item) => (
              <AttentionRow key={item.id} item={item} nowMs={nowMs} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The at-a-glance overview — total, the "act first" override count, high-risk
 *  count, and grouped per-source counts. Counts only, never a composite score. */
function AttentionSummaryHeader({ items }: { items: AttentionItem[] }) {
  const summary = summarizeAttention(items);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-[var(--dpf-muted)]">
      <span className="font-semibold text-[var(--dpf-text)]">{summary.total} need you</span>
      {summary.pinned > 0 ? <span>· {summary.pinned} pinned</span> : null}
      {summary.highRisk > 0 ? <span>· {summary.highRisk} high-risk</span> : null}
      <span className="ml-auto flex flex-wrap gap-x-2">
        {summary.bySource.map((s) => (
          <span key={s.source}>
            {SOURCE_LABEL[s.source]} {s.count}
          </span>
        ))}
      </span>
    </div>
  );
}

function AttentionRow({ item, nowMs }: { item: AttentionItem; nowMs: number }) {
  const override = isOverrideTier(item);
  const pin = override ? overrideReason(item) : null;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
            {SOURCE_LABEL[item.source]}
          </span>
          {item.riskClass === "high-risk" ? (
            <span className="rounded border border-[var(--dpf-error)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--dpf-error)]">
              {riskLabel(item.riskClass)}
            </span>
          ) : null}
          {pin ? (
            <span className="rounded border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
              Pinned · {pin}
            </span>
          ) : null}
          <span className="text-[10px] text-[var(--dpf-muted)]">
            {attentionAgeLabel(item.createdAtIso, nowMs)}
          </span>
        </div>

        <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">{item.title}</p>
        {item.context ? (
          <p className="mt-0.5 text-[12px] leading-snug text-[var(--dpf-muted)]">{item.context}</p>
        ) : null}

        {/* Why this / why now — the context that makes the order legible. */}
        <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
          <span className="text-[var(--dpf-text)]">Why it&apos;s here:</span>{" "}
          {residueReasonLabel(item.triage.residueReason)}
          {item.triage.blastRadius ? (
            <>
              {" · "}
              <span className="text-[var(--dpf-text)]">Blocks:</span> {item.triage.blastRadius}
            </>
          ) : null}
          {" · "}needs {decideEffortLabel(item.triage.decideEffort)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        {item.actions.map((action) =>
          action.href ? (
            <Link
              key={action.kind + action.label}
              href={action.href}
              className="text-[11px] font-semibold text-[var(--dpf-accent)] hover:opacity-80"
            >
              {action.label} →
            </Link>
          ) : null,
        )}
      </div>
    </li>
  );
}

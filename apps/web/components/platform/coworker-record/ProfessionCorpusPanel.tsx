// apps/web/components/platform/coworker-record/ProfessionCorpusPanel.tsx
// WSID Phase 3 — operator panel for profession-corpus RUNTIME signals on the AI
// Workforce surface. Surfaces usage (corpus injected into prompts), misses, and
// the growth backlog (open ProfessionCorpusGap rows) so an operator can see
// coverage→usage→growth at a glance. Client component (DataTable needs client
// sort/paging); fed serializable props from a server loader (corpus-signals.ts).
"use client";

import { DataTable, StatCard, StatusBadge, type Column } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";
import type { CorpusGapRow, ProfessionCorpusSignals } from "@/lib/coworker-record/corpus-signals";
// Value import MUST come from the dependency-free presentation module, not from
// corpus-signals.ts — that one imports prisma, and a value import across the
// client boundary pulls the whole server graph into the browser bundle.
import { presentCorpusSignals } from "@/lib/coworker-record/corpus-signal-presentation";

const REASON_INTENT: Record<string, Intent> = {
  unmapped: "danger",
  "empty-corpus": "danger",
  "low-relevance": "warning",
  deferred: "info",
  "bet-completed": "success",
};

const REASON_LABEL: Record<string, string> = {
  unmapped: "Unmapped role",
  "empty-corpus": "Empty corpus",
  "low-relevance": "Not covered",
  deferred: "Deferred",
  "bet-completed": "Bet learning",
};

const GAP_COLUMNS: Column<CorpusGapRow>[] = [
  {
    key: "profession",
    header: "Profession",
    cell: (r) => r.label,
    sortAccessor: (r) => r.label,
  },
  {
    key: "reason",
    header: "Reason",
    cell: (r) => (
      <StatusBadge intent={REASON_INTENT[r.reason] ?? "neutral"} label={REASON_LABEL[r.reason] ?? r.reason} />
    ),
    sortAccessor: (r) => r.reason,
  },
  {
    key: "topic",
    header: "Missing topic",
    cell: (r) => <span title={r.missingTopic}>{r.missingTopic}</span>,
    sortAccessor: (r) => r.missingTopic,
  },
  {
    key: "occurrences",
    header: "Hits",
    align: "right",
    cell: (r) => r.occurrences,
    sortAccessor: (r) => r.occurrences,
  },
  {
    key: "suggested",
    header: "Suggested source to seed",
    cell: (r) =>
      r.suggestedSource ? (
        <span className="text-[var(--dpf-muted)]" title={r.suggestedSource}>
          {r.suggestedSource.length > 80 ? `${r.suggestedSource.slice(0, 80)}…` : r.suggestedSource}
        </span>
      ) : (
        <span className="text-[var(--dpf-muted)]">—</span>
      ),
  },
  {
    key: "lastSeen",
    header: "Last seen",
    align: "right",
    cell: (r) => r.lastSeen,
    sortAccessor: (r) => r.lastSeen,
  },
];

export function ProfessionCorpusPanel({ signals }: { signals: ProfessionCorpusSignals }) {
  const { totals, gaps } = signals;
  const rate = totals.injectionRatePct;

  // BI-579210DD — "no signal" must never render as "good signal". The decision
  // lives in corpus-signals.ts (pure, tested without a DOM); this panel stays
  // dumb, per the module's own contract.
  const present = presentCorpusSignals(totals);

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Profession corpus — runtime usage &amp; growth
        </h2>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Coverage is not usage. These are live signals from coworker conversations over the last 30 days:
          how often each profession&apos;s knowledge base was injected into a prompt, how often it was missed,
          and the deduplicated backlog of topics the corpus could not answer.
        </p>
      </div>

      {present.noUsageNotice && (
        <p
          style={{
            fontSize: 11,
            color: "var(--dpf-muted)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 6,
            padding: "8px 10px",
            marginBottom: 12,
          }}
        >
          {present.noUsageNotice}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <StatCard
          label="Corpus injections"
          value={totals.injected.toLocaleString()}
          intent={present.injectionsIntent}
          hint="Prompts grounded in profession corpus"
        />
        <StatCard
          label="Misses"
          value={totals.missed.toLocaleString()}
          intent={present.missesIntent}
          hint="Turns with no corpus injected"
        />
        <StatCard
          label="Injection rate"
          value={rate === null ? "—" : `${rate}%`}
          intent={rate === null ? "neutral" : rate >= 80 ? "success" : rate >= 50 ? "warning" : "danger"}
          hint="Injected ÷ total coworker turns"
        />
        <StatCard
          label="Open growth gaps"
          value={totals.openGaps.toLocaleString()}
          intent={present.gapsIntent}
          hint="Deduped topics to seed next"
        />
      </div>

      <DataTable
        columns={GAP_COLUMNS}
        rows={gaps}
        getRowKey={(r) => r.id}
        initialSort={{ key: "occurrences", dir: "desc" }}
        pageSize={15}
        dense
        empty={<span style={{ color: "var(--dpf-muted)" }}>{present.emptyGapsCopy}</span>}
      />
    </section>
  );
}

"use client";

// The portfolio tie-out on Ops > Delivery Flow (BI-CBF5D708, design §6; home
// chosen by UX-Fit propose-n-pick DI-5DCFAEA03A6D). One row per portfolio plus
// the unallocated row: budget against committed work and measured capacity, in
// points, with the traced share on every row. It reports and steers — setting a
// budget and confirming an epic's portfolio are the only writes, both by a
// person with a reason. Nothing here dispatches work.

import { useState, useTransition } from "react";

import { Surface } from "@/components/ui/Surface";
import { DataTable, Notice, StatusBadge, type Column } from "@/components/ui/report-kit";
import { confirmEpicPortfoliosAction, setPortfolioBudgetAction } from "@/lib/actions/portfolio-budget";
import type { PortfolioTieOut, TieOutRow } from "@/lib/portfolio/tie-out";
import { budgetText, forecastText, overCommitmentText, tracedText } from "@/lib/portfolio/tie-out-view";
import { aiLatencyText, aiSpendText, aiTokensText } from "@/lib/portfolio/ai-resource";

export type UnconfirmedEpic = { epicId: string; title: string; portfolioId: string; portfolioName: string; confidence: "high" | "low" };

type Props = {
  tieOut: PortfolioTieOut;
  /** Proposed points per portfolio for this quarter: last quarter's delivered points. */
  proposedPoints: Record<string, number>;
  unconfirmedEpics: UnconfirmedEpic[];
};

export function PortfolioTieOutPanel({ tieOut, proposedPoints, unconfirmedEpics }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const quarter = `${new Date(tieOut.period.start).toISOString().slice(0, 10)} to ${new Date(new Date(tieOut.period.end).getTime() - 1).toISOString().slice(0, 10)}`;
  const editingRow = tieOut.rows.find((r) => r.portfolioId === editing) ?? null;

  const columns: Column<TieOutRow>[] = [
    { key: "name", header: "Portfolio", cell: (r) => <span className="font-semibold">{r.name}</span> },
    {
      key: "budget",
      header: "Budget (points)",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className={r.budget ? "" : "text-[var(--dpf-muted)]"}>{budgetText(r)}</span>
          {r.portfolioId ? (
            <button type="button" className="text-xs text-[var(--dpf-accent)] underline" onClick={() => setEditing(r.portfolioId)}>
              {r.budget ? "Change" : "Set budget"}
            </button>
          ) : null}
        </span>
      ),
    },
    { key: "reserved", header: "Reserved", align: "right", cell: (r) => r.reservedPoints, sortAccessor: (r) => r.reservedPoints },
    { key: "inFlight", header: "In flight", align: "right", cell: (r) => r.inFlightPoints, sortAccessor: (r) => r.inFlightPoints },
    { key: "delivered", header: "Delivered this quarter", align: "right", cell: (r) => r.deliveredPoints, sortAccessor: (r) => r.deliveredPoints },
    { key: "forecast", header: "Capacity to quarter end", align: "right", cell: (r) => forecastText(r) },
    {
      key: "over",
      header: "Commitment against capacity",
      cell: (r) => {
        const over = overCommitmentText(r);
        return <span className={over.tone === "danger" ? "text-[var(--dpf-error)]" : over.tone === "warning" ? "text-[var(--dpf-warning)]" : ""}>{over.text}</span>;
      },
    },
    { key: "traced", header: "Traced", align: "right", cell: (r) => tracedText(r), sortAccessor: (r) => r.tracedShare ?? -1 },
    // AI beside points, never converted into them (BI-0CA5DA2B).
    { key: "aiTokens", header: "AI tokens", align: "right", cell: (r) => aiTokensText(r.ai), sortAccessor: (r) => r.ai.tokens },
    { key: "aiSpend", header: "AI spend", cell: (r) => aiSpendText(r.ai) },
    { key: "aiLatency", header: "AI run time", cell: (r) => aiLatencyText(r.ai) },
  ];

  return (
    <Surface as="section" level={2} rounded="xl" aria-labelledby="tie-out-heading">
      <h2 id="tie-out-heading" className="text-base font-semibold text-[var(--dpf-text)]">Budget and capacity</h2>
      <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
        This quarter ({quarter}, {tieOut.weeksRemaining} weeks left), in points: what each portfolio has committed against what it
        has measurably delivered over the last six weeks. The traced share is how much of that delivery carries a Workroom or pull
        request, so a low figure means work is happening where this view cannot see it.
      </p>
      <div className="mt-3">
        <DataTable columns={columns} rows={tieOut.rows} getRowKey={(r) => r.portfolioId ?? "unallocated"} dense ariaLabel="Portfolio budget and capacity" />
      </div>
      {tieOut.weeksOfHistory < 4 ? (
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">Capacity is estimated: this install has {tieOut.weeksOfHistory} week(s) of delivery history, and four are needed to measure it.</p>
      ) : null}
      {tieOut.untracedChanges > 0 ? (
        <div className="mt-3">
          <Notice variant="warn" title={`${tieOut.untracedChanges} merged change(s) in six weeks name no backlog item`}>
            They are not counted in any row above, so the delivered and capacity figures are low by that much.
          </Notice>
        </div>
      ) : null}
      {tieOut.aiNotTraced.runs > 0 ? (
        <p className="mt-2 text-xs text-[var(--dpf-muted)]">
          {tieOut.aiNotTraced.runs} AI run(s) this quarter reach no item in these rows ({aiTokensText(tieOut.aiNotTraced)}; {aiSpendText(tieOut.aiNotTraced)}), so they are not traced to a portfolio.
        </p>
      ) : null}
      {editingRow?.portfolioId ? (
        <BudgetForm
          key={editingRow.portfolioId}
          portfolioId={editingRow.portfolioId}
          name={editingRow.name}
          current={editingRow.budget?.allocatedPoints ?? null}
          proposed={proposedPoints[editingRow.portfolioId] ?? 0}
          onDone={() => setEditing(null)}
        />
      ) : null}
      <EpicAttribution epics={unconfirmedEpics} />
    </Surface>
  );
}

function BudgetForm(props: { portfolioId: string; name: string; current: number | null; proposed: number; onDone: () => void }) {
  const [points, setPoints] = useState(String(props.current ?? props.proposed));
  const [reason, setReason] = useState(props.current === null ? `Accepting the proposal: last quarter's delivered points (${props.proposed}).` : "");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const result = await setPortfolioBudgetAction({ portfolioId: props.portfolioId, allocatedPoints: Number(points), reason });
      if (result.ok) props.onDone();
      else setMessage(result.error);
    });
  return (
    <Surface padding="sm" className="mt-3">
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <p className="text-sm font-semibold text-[var(--dpf-text)]">Budget for {props.name} this quarter</p>
      <p className="text-xs text-[var(--dpf-muted)]">Proposed: {props.proposed} points, the points it delivered last quarter.</p>
      <label className="block text-xs text-[var(--dpf-muted)]">
        Points
        <input type="number" min={0} step={1} value={points} onChange={(e) => setPoints(e.target.value)} className="mt-1 block w-32 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]" />
      </label>
      <label className="block text-xs text-[var(--dpf-muted)]">
        Why this figure (recorded with the budget)
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 block w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-sm text-[var(--dpf-text)]" />
      </label>
      {message ? <p role="alert" className="text-xs text-[var(--dpf-error)]">{message}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-sm text-[var(--dpf-on-accent)]">Save budget</button>
        <button type="button" onClick={props.onDone} className="rounded border border-[var(--dpf-border)] px-3 py-1 text-sm text-[var(--dpf-text)]">Cancel</button>
      </div>
      </form>
    </Surface>
  );
}

function EpicAttribution({ epics }: { epics: UnconfirmedEpic[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (epics.length === 0) return null;
  const high = epics.filter((e) => e.confidence === "high");
  const confirm = (list: UnconfirmedEpic[], batch?: "high") =>
    start(async () => {
      const result = await confirmEpicPortfoliosAction({
        confirmations: list.map((e) => ({ epicId: e.epicId, portfolioId: e.portfolioId })),
        reason: batch ? "Confirmed the high-confidence proposals from the tie-out." : "Confirmed from the tie-out after review.",
        ...(batch ? { batch } : {}),
      });
      setMessage(result.ok ? result.data : result.error);
    });
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-[var(--dpf-text)]">
        {epics.length} epic(s) have a proposed portfolio no person has confirmed yet
      </summary>
      <div className="mt-2 space-y-2">
        {high.length > 0 ? (
          <button type="button" disabled={pending} onClick={() => confirm(high, "high")} className="rounded bg-[var(--dpf-accent)] px-3 py-1 text-sm text-[var(--dpf-on-accent)]">
            Confirm the {high.length} high-confidence proposal(s)
          </button>
        ) : null}
        {message ? <p role="status" className="text-xs text-[var(--dpf-muted)]">{message}</p> : null}
        <ul className="space-y-1">
          {epics.map((e) => (
            <li key={e.epicId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-[var(--dpf-text)]">{e.epicId} · {e.title} → {e.portfolioName}</span>
              <span className="flex items-center gap-2">
                <StatusBadge intent={e.confidence === "high" ? "success" : "warning"} label={e.confidence === "high" ? "High confidence" : "Check"} variant="soft" />
                <button type="button" disabled={pending} onClick={() => confirm([e])} className="text-xs text-[var(--dpf-accent)] underline">Confirm</button>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

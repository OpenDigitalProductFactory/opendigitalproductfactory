"use client";

import { useMemo, useState, useTransition } from "react";
import {
  buildValueEffortMatrix,
  groupByFunnelStage,
  itemEffort,
  itemValue,
  QUADRANT_LABELS,
  STAGE_LABELS,
  valueBand,
  type DemandItemView,
} from "@/lib/demand/board";
import type { ValueEffortQuadrant } from "@/lib/demand/scoring";
import { bucketBalance, BUCKET_LABELS, computeBucketMix } from "@/lib/demand/buckets";
import { groupByFlowLane, FLOW_LANE_LABELS, type FlowColumn } from "@/lib/demand/flow";
import { resolveEstimateProvenance } from "@/lib/demand/estimate-provenance";
import { recordEstimate } from "@/lib/actions/demand-estimate";

const VALUE_BAND_LABEL: Record<ReturnType<typeof valueBand>, string> = {
  high: "High value",
  medium: "Medium value",
  low: "Low value",
  unscored: "Not scored",
};

const VALUE_BAND_TOKEN: Record<ReturnType<typeof valueBand>, string> = {
  high: "var(--dpf-success)",
  medium: "var(--dpf-accent)",
  low: "var(--dpf-muted)",
  unscored: "var(--dpf-border)",
};

const QUADRANT_TOKEN: Record<ValueEffortQuadrant, string> = {
  quick_win: "var(--dpf-success)",
  big_bet: "var(--dpf-accent)",
  fill_in: "var(--dpf-muted)",
  time_sink: "var(--dpf-warning)",
};

const ESTIMATE_SOURCE_LABEL: Record<string, string> = { ai: "AI", human: "human", agreed: "agreed" };

/** Tiny inline text button used across the estimate controls. */
function MiniButton({
  onClick,
  disabled,
  title,
  children,
  tone = "accent",
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  tone?: "accent" | "muted" | "success";
}) {
  const color =
    tone === "success" ? "var(--dpf-success)" : tone === "muted" ? "var(--dpf-muted)" : "var(--dpf-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded border px-1.5 py-0.5 text-[10px] font-medium disabled:opacity-40"
      style={{ color, borderColor: color }}
    >
      {children}
    </button>
  );
}

/**
 * Interactive collaborative-estimation controls (EP-DELIVERY-FLOW BI-AA1763CD).
 * The effort estimate is the value/effort score's denominator; here it becomes a
 * visible, attributed, collaborative act:
 * - **AI proposes forward** — "AI estimate" records a first-pass (derived from the
 *   intake effortSize) attributed to the coworker.
 * - **Human confirm/overrule** — confirm adopts the AI number; overrule sets a
 *   different one (the human number leads).
 * - **Reconcile divergence** — when AI and human differ, "Use AI" / "Keep mine"
 *   settle it; the score is provisional (⇄) until then.
 * Writes through the governed recordEstimate action, which recomputes demandScore.
 */
export function EstimateControls({ item }: { item: DemandItemView }) {
  const prov = resolveEstimateProvenance({
    aiJobSize: item.estimateAiJobSize,
    humanJobSize: item.estimateHumanJobSize,
    agreed: item.estimateAgreed,
  });
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (input: Parameters<typeof recordEstimate>[0]) =>
    startTransition(async () => {
      setError(null);
      const res = await recordEstimate(input);
      if (!res.ok) setError(res.error);
      else {
        setEditing(false);
        setDraft("");
      }
    });

  const submitHuman = (agree?: boolean) => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n <= 0) {
      setError("Enter effort points greater than 0.");
      return;
    }
    run({ itemId: item.itemId, by: "human", jobSize: n, agree });
  };

  const editor = (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        step="any"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="pts"
        aria-label="Effort points"
        className="w-12 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-1 py-0.5 text-[10px] text-[var(--dpf-text)]"
      />
      <MiniButton onClick={() => submitHuman()} disabled={pending} title="Set your estimate">
        Set
      </MiniButton>
      <MiniButton
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
        disabled={pending}
        tone="muted"
        title="Cancel"
      >
        ✕
      </MiniButton>
    </span>
  );

  // Chip describing the resolved state.
  const chip =
    prov.source === null ? null : prov.diverged ? (
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
        style={{ color: "var(--dpf-warning)", borderColor: "var(--dpf-warning)" }}
        title="AI and employee estimates diverge — reconcile to trust the score"
      >
        ⇄ AI {item.estimateAiJobSize} ↔ you {item.estimateHumanJobSize}
      </span>
    ) : (
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)]"
        title={`Effort estimate: ${prov.effectiveJobSize} (${ESTIMATE_SOURCE_LABEL[prov.source] ?? prov.source})`}
      >
        est {prov.effectiveJobSize} · {ESTIMATE_SOURCE_LABEL[prov.source] ?? prov.source}
        {prov.source === "ai" ? " (proposed)" : ""}
      </span>
    );

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {chip}
      {editing ? (
        editor
      ) : prov.diverged ? (
        <>
          <MiniButton onClick={() => run({ itemId: item.itemId, by: "human", agree: true })} disabled={pending} tone="success" title="Adopt the AI estimate">
            Use AI {item.estimateAiJobSize}
          </MiniButton>
          <MiniButton
            onClick={() => run({ itemId: item.itemId, by: "human", jobSize: item.estimateHumanJobSize ?? 0, agree: true })}
            disabled={pending}
            title="Keep your estimate as the agreed one"
          >
            Keep {item.estimateHumanJobSize}
          </MiniButton>
        </>
      ) : prov.source === "ai" ? (
        <>
          <MiniButton onClick={() => run({ itemId: item.itemId, by: "human", agree: true })} disabled={pending} tone="success" title="Confirm the AI estimate">
            Confirm
          </MiniButton>
          <MiniButton onClick={() => setEditing(true)} disabled={pending} title="Set a different estimate">
            Overrule
          </MiniButton>
        </>
      ) : prov.source === null ? (
        <>
          {item.effortSize && (
            <MiniButton onClick={() => run({ itemId: item.itemId, by: "ai" })} disabled={pending} tone="muted" title="Propose a first-pass estimate from the effort size">
              ✨ AI estimate
            </MiniButton>
          )}
          <MiniButton onClick={() => setEditing(true)} disabled={pending} title="Set the effort estimate">
            ✎ estimate
          </MiniButton>
        </>
      ) : (
        <MiniButton onClick={() => setEditing(true)} disabled={pending} tone="muted" title="Revise the estimate">
          ✎
        </MiniButton>
      )}
      {pending && <span className="text-[10px] text-[var(--dpf-muted)]">…</span>}
      {error && (
        <span className="text-[10px] text-[var(--dpf-warning)]" title={error}>
          {error.length > 40 ? `${error.slice(0, 40)}…` : error}
        </span>
      )}
    </span>
  );
}

function DemandCard({ item }: { item: DemandItemView }) {
  const [open, setOpen] = useState(false);
  const band = valueBand(item);
  const effort = itemEffort(item);
  const value = itemValue(item);
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2 text-xs">
      <div className="font-medium text-[var(--dpf-text)] leading-snug">{item.title}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: VALUE_BAND_TOKEN[band], borderColor: VALUE_BAND_TOKEN[band] }}
        >
          {VALUE_BAND_LABEL[band]}
        </span>
        <span className="text-[10px] text-[var(--dpf-muted)]">
          {item.effortSize ? `${item.effortSize} effort` : effort !== null ? `effort ${effort}` : "unsized"}
        </span>
        <EstimateControls item={item} />
        {item.claimStatus === "offered" && item.claimedByAgentId && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ color: "var(--dpf-accent)", borderColor: "var(--dpf-accent)" }}
            title={`${item.claimedByAgentId} volunteered to build this — approve the pickup`}
          >
            🙋 {item.claimedByAgentId} volunteered — approve
          </span>
        )}
        <span className="ml-auto font-mono text-[var(--dpf-muted-foreground)]">{item.itemId}</span>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 text-[10px] text-[var(--dpf-accent)] hover:underline"
      >
        {open ? "Hide" : "Why this score?"}
      </button>
      {open && (
        <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-[var(--dpf-muted)]">
          <dt>Score</dt>
          <dd className="text-[var(--dpf-text)]">
            {item.demandScore ?? "—"} {item.demandScoreFramework ? `(${item.demandScoreFramework})` : ""}
          </dd>
          <dt>Value</dt>
          <dd className="text-[var(--dpf-text)]">{value ?? "—"}</dd>
          <dt>Effort</dt>
          <dd className="text-[var(--dpf-text)]">{effort ?? "—"}</dd>
          <dt>Stage</dt>
          <dd className="text-[var(--dpf-text)]">{item.demandStage ?? "raw"}</dd>
        </dl>
      )}
    </div>
  );
}

function FunnelView({ items }: { items: DemandItemView[] }) {
  const columns = useMemo(() => groupByFunnelStage(items), [items]);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {columns.map((col) => (
        <div key={col.stage} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{STAGE_LABELS[col.stage]}</h3>
            <span className="text-xs text-[var(--dpf-muted)]">{col.items.length}</span>
          </div>
          <div className="space-y-2">
            {col.items.length === 0 ? (
              <p className="text-xs text-[var(--dpf-muted)]">Nothing here yet.</p>
            ) : (
              col.items.map((item) => <DemandCard key={item.itemId} item={item} />)
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// The Flow lens (EP-DELIVERY-FLOW BI-1DE21746): the whole river in one view —
// investment funnel → the bet → execution board — so Demand and Backlog stop
// reading as two duplicate boards. Two deliberately different visual languages:
// the funnel lanes are score-tinted and narrowing (invest); the board lane reads
// as execution; the amber bet seam is the funded crossing between them.
function FlowLaneColumn({ col }: { col: FlowColumn }) {
  const isBet = col.half === "bet";
  const isBoard = col.half === "board";
  const accent = isBet ? "var(--dpf-warning)" : isBoard ? "var(--dpf-success)" : "var(--dpf-border)";
  return (
    <div
      className="min-w-0 rounded-lg border bg-[var(--dpf-surface-2)] p-2"
      style={{ borderColor: accent, ...(isBet ? { backgroundColor: "color-mix(in srgb, var(--dpf-warning) 8%, var(--dpf-surface-2))" } : {}) }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">
          {isBet ? "⟐ " : ""}
          {FLOW_LANE_LABELS[col.lane]}
        </h3>
        <span className="text-xs text-[var(--dpf-muted)]">{col.items.length}</span>
      </div>
      {isBet && (
        <p className="mb-2 text-[10px] leading-snug text-[var(--dpf-warning)]">
          Funded — a coworker volunteers to build it.
        </p>
      )}
      <div className="space-y-2">
        {col.items.length === 0 ? (
          <p className="text-xs text-[var(--dpf-muted)]">{isBet ? "No bets on the table." : "Nothing here yet."}</p>
        ) : (
          col.items.map((item) => <DemandCard key={item.itemId} item={item} />)
        )}
      </div>
    </div>
  );
}

function FlowView({ items }: { items: DemandItemView[] }) {
  const columns = useMemo(() => groupByFlowLane(items), [items]);
  const funnel = columns.filter((c) => c.half === "funnel");
  const bet = columns.find((c) => c.half === "bet");
  const board = columns.filter((c) => c.half === "board");
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">
        <span>← Invest · value ÷ effort</span>
        <span>Execute · owner + burn-down →</span>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {funnel.map((col) => (
          <FlowLaneColumn key={col.lane} col={col} />
        ))}
        {bet && <FlowLaneColumn col={bet} />}
        {board.map((col) => (
          <FlowLaneColumn key={col.lane} col={col} />
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        One flow, one item two faces: a score + estimate upstream, an owner + burn-down once it crosses the bet.
        Same dataset as Prioritize and Execute — just a different lens.
      </p>
    </div>
  );
}

const QUADRANT_GRID: ValueEffortQuadrant[][] = [
  ["quick_win", "big_bet"],
  ["fill_in", "time_sink"],
];

function MatrixView({ items }: { items: DemandItemView[] }) {
  const matrix = useMemo(() => buildValueEffortMatrix(items), [items]);
  const byQuadrant = useMemo(() => {
    const acc: Record<ValueEffortQuadrant, typeof matrix.points> = {
      quick_win: [],
      big_bet: [],
      fill_in: [],
      time_sink: [],
    };
    for (const p of matrix.points) acc[p.quadrant].push(p);
    return acc;
  }, [matrix]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {QUADRANT_GRID.flat().map((q) => (
          <div key={q} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: QUADRANT_TOKEN[q] }} />
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{QUADRANT_LABELS[q]}</h3>
              <span className="ml-auto text-xs text-[var(--dpf-muted)]">{byQuadrant[q].length}</span>
            </div>
            <div className="space-y-2">
              {byQuadrant[q].length === 0 ? (
                <p className="text-xs text-[var(--dpf-muted)]">—</p>
              ) : (
                byQuadrant[q].map((p) => <DemandCard key={p.item.itemId} item={p.item} />)
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-[var(--dpf-muted)]">
        Split at value median {matrix.valueMid} · effort median {matrix.effortMid}. Higher value + lower effort ={" "}
        quick wins. {matrix.unplotted.length > 0 && `${matrix.unplotted.length} item(s) not yet scored — sized/scored them to plot.`}
      </p>
    </div>
  );
}

function BalanceView({
  items,
  targets,
}: {
  items: DemandItemView[];
  targets: Partial<Record<"run" | "grow" | "transform", number>> | null;
}) {
  const rows = useMemo(() => {
    const mix = computeBucketMix(
      items.map((i) => ({
        investmentBucket: i.investmentBucket,
        workType: i.workType,
        weight: itemEffort(i),
      })),
    );
    return { mix, balance: bucketBalance(mix, targets) };
  }, [items, targets]);

  if (rows.mix.total === 0) {
    return (
      <p className="text-sm text-[var(--dpf-muted)]">
        No classified demand yet. Score items (bucket auto-derives from work-type) to see the balance.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {rows.balance.map((r) => (
          <div key={r.bucket} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-2">
            <div className="mb-1 flex items-center gap-2 text-sm">
              <span className="font-medium text-[var(--dpf-text)]">{BUCKET_LABELS[r.bucket]}</span>
              {r.starved && (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-warning)]">
                  Starved
                </span>
              )}
              <span className="ml-auto text-xs text-[var(--dpf-muted)]">
                {r.actualPct}% actual · {r.targetPct}% target
              </span>
            </div>
            <div className="relative h-2 w-full overflow-hidden rounded bg-[var(--dpf-surface-2)]">
              <div
                className="absolute left-0 top-0 h-full rounded"
                style={{
                  width: `${Math.min(100, r.actualPct)}%`,
                  backgroundColor: r.starved ? "var(--dpf-warning)" : "var(--dpf-accent)",
                }}
              />
              <div
                className="absolute top-0 h-full w-px bg-[var(--dpf-text)]"
                style={{ left: `${Math.min(100, r.targetPct)}%` }}
                title={`Target ${r.targetPct}%`}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--dpf-muted)]">
        Effort-weighted mix across {rows.mix.total} point(s) of demand vs the target allocation (the black tick). A
        bucket &gt;5% below target is flagged Starved.
        {rows.mix.unclassified > 0 && ` ${rows.mix.unclassified} point(s) unclassified.`}
      </p>
    </div>
  );
}

type Tab = "flow" | "funnel" | "matrix" | "balance";

const TAB_LABELS: Record<Tab, string> = {
  flow: "Flow",
  funnel: "Funnel",
  matrix: "Value × effort",
  balance: "Balance",
};

export function DemandBoard({
  items,
  bucketTargets = null,
  activeFramework,
}: {
  items: DemandItemView[];
  bucketTargets?: Partial<Record<"run" | "grow" | "transform", number>> | null;
  activeFramework?: string;
}) {
  const [tab, setTab] = useState<Tab>("flow");
  const scored = items.filter((i) => i.demandScore !== null).length;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--dpf-border)] p-6 text-center">
        <p className="text-sm text-[var(--dpf-text)]">No demand in the funnel yet.</p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Score backlog items (value + effort) to see them ranked here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--dpf-border)] p-0.5">
          {(["flow", "funnel", "matrix", "balance"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                tab === t
                  ? "bg-[var(--dpf-accent)] text-[var(--dpf-surface-1)]"
                  : "text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--dpf-muted)]">
          {scored} of {items.length} scored
          {activeFramework ? ` · ${activeFramework} policy` : ""}
        </span>
      </div>
      {tab === "flow" ? (
        <FlowView items={items} />
      ) : tab === "funnel" ? (
        <FunnelView items={items} />
      ) : tab === "matrix" ? (
        <MatrixView items={items} />
      ) : (
        <BalanceView items={items} targets={bucketTargets} />
      )}
    </div>
  );
}

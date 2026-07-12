"use client";

import { useMemo, useState } from "react";
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

type Tab = "funnel" | "matrix" | "balance";

export function DemandBoard({
  items,
  bucketTargets = null,
  activeFramework,
}: {
  items: DemandItemView[];
  bucketTargets?: Partial<Record<"run" | "grow" | "transform", number>> | null;
  activeFramework?: string;
}) {
  const [tab, setTab] = useState<Tab>("funnel");
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
          {(["funnel", "matrix", "balance"] as const).map((t) => (
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
              {t === "funnel" ? "Funnel" : t === "matrix" ? "Value × effort" : "Balance"}
            </button>
          ))}
        </div>
        <span className="text-xs text-[var(--dpf-muted)]">
          {scored} of {items.length} scored
          {activeFramework ? ` · ${activeFramework} policy` : ""}
        </span>
      </div>
      {tab === "funnel" ? (
        <FunnelView items={items} />
      ) : tab === "matrix" ? (
        <MatrixView items={items} />
      ) : (
        <BalanceView items={items} targets={bucketTargets} />
      )}
    </div>
  );
}

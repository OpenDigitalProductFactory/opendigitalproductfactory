"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { FilterBar } from "@/components/ui/report-kit/FilterBar";
import type { ShapeGraph, ShapeNodeState, ShapeRow } from "@/lib/work-management/shape-projection";

const STATE_LABEL: Record<ShapeNodeState, string> = {
  passed: "Verified", holding: "Waiting", denied: "Declined",
  "awaiting-confirmation": "Awaiting a person", "not-reached": "Not reached",
  unknown: "Not verified", observed: "Recorded", cancelled: "Cancelled",
};

function Evidence({ rows }: { rows: ShapeRow[] }) {
  if (!rows.length) return <p>No correlated records.</p>;
  return <ul className="space-y-2">{rows.map((row) => <li key={row.key}>
    <details className="rounded border border-[var(--dpf-border)] p-2">
      <summary className="cursor-pointer">{row.label} · {STATE_LABEL[row.state]}</summary>
      <dl className="mt-2 space-y-1 break-words">
        <dt>Source</dt><dd>{row.receiptRef ? `${row.receiptRef.table}:${row.receiptRef.id}` : "Unknown"}</dd>
        <dt>Actor</dt><dd>{row.actor ?? "Unknown"}</dd>
        <dt>Recorded</dt><dd>{row.occurredAt ?? "Unknown"}</dd>
        {row.summary ? <><dt>Finding</dt><dd>{row.summary}</dd></> : null}
      </dl>
    </details>
  </li>)}</ul>;
}

/** Intended order and observed evidence remain separate in both layouts. */
export function WorkroomShape({ graph }: { graph: ShapeGraph }) {
  const titleId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams().toString();
  const operation = new URLSearchParams(params).get("operation");
  const [selected, setSelected] = useState(() => new URLSearchParams(params).get("processStep") ?? graph.process?.currentStageKey ?? "");
  const [layout, setLayout] = useState(() => new URLSearchParams(params).get("processLayout") ?? "map");
  const [filters, setFilters] = useState<Record<string, string>>(() => ({ processQuery: new URLSearchParams(params).get("processQuery") ?? "", processState: new URLSearchParams(params).get("processState") ?? "" }));
  const stepsRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const search = new URLSearchParams(params);
    setSelected(search.get("processStep") ?? graph.process?.currentStageKey ?? "");
    setLayout(search.get("processLayout") ?? "map");
    setFilters({ processQuery: search.get("processQuery") ?? "", processState: search.get("processState") ?? "" });
  }, [params, graph.process?.currentStageKey]);
  function navigate(step: string, nextLayout = layout, nextFilters = filters) {
    setSelected(step);
    setLayout(nextLayout);
    setFilters(nextFilters);
    const search = new URLSearchParams(params);
    if (step) search.set("processStep", step); else search.delete("processStep");
    search.set("processLayout", nextLayout);
    for (const [key, value] of Object.entries(nextFilters)) {
      if (value) search.set(key, value); else search.delete(key);
    }
    router.replace(`${pathname}?${search}${window.location.hash}`, { scroll: false });
  }
  const stage = graph.stages.find((candidate) => candidate.key === selected);
  const inspection = stage?.inspection;
  const visibleStages = graph.stages.filter((item) => (!filters.processState || item.state === filters.processState)
    && `${item.label} ${item.inspection?.owner ?? ""}`.toLowerCase().includes((filters.processQuery ?? "").trim().toLowerCase()));
  return <section aria-labelledby={titleId} className="mt-4 space-y-4 text-sm text-[var(--dpf-text)]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id={titleId} className="text-base font-semibold">{graph.process?.title ?? "Process"}</h2>
        <p className="text-[var(--dpf-muted)]">{graph.process?.definitionRef ?? "Definition unavailable"}</p></div>
      <div aria-label="Process layout" className="flex gap-2">
        {operation ? <ButtonLink variant="ghost" href={`/ea/workrooms?operation=${encodeURIComponent(operation)}#coordination`}>Operation</ButtonLink> : null}
        {(["map", "list"] as const).map((value) => <Button key={value} variant="secondary" className="min-h-11" aria-pressed={layout === value} onClick={() => navigate(selected, value)}>{value === "map" ? "Map" : "List"}</Button>)}
      </div>
    </div>
    {graph.process ? <div className="text-[var(--dpf-muted)]">
      <p>Projection checked: {graph.process.readAt ?? "Freshness unknown"} · Latest evidence: {graph.process.lastEvidenceAt ?? "Unknown"}</p>
      {graph.process.gaps.length ? <details open className="mt-2 rounded border border-[var(--dpf-border)] p-3">
        <summary className="cursor-pointer">Projection gaps ({graph.process.gaps.length})</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{graph.process.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
      </details> : null}
    </div> : null}
    <div className="space-y-2"><h3 className="font-medium">Intended process</h3>
      <FilterBar mode="client" value={filters} onChange={(next) => navigate(selected, layout, next)}
        className="[&_input]:min-h-11 [&_select]:min-h-11 [&_input]:text-sm [&_select]:text-sm"
        facets={[{ kind: "search", key: "processQuery", placeholder: "Search steps" },
          { kind: "select", key: "processState", label: "State", options: [{ value: "", label: "All states" }, ...Object.entries(STATE_LABEL).map(([value, label]) => ({ value, label }))] }]} />
      {!visibleStages.length ? <p>No matching steps</p> : null}
      <div className="overflow-x-auto pb-2">
        <ul ref={stepsRef} aria-label="Process steps" className={layout === "list" ? "space-y-2" : "flex min-w-max gap-3"}>
          {visibleStages.map((item, index) => <li key={item.key} className={layout === "list" ? "" : "w-64 shrink-0"}>
            <Button variant="secondary" aria-label={item.label} aria-pressed={selected === item.key} data-step-key={item.key}
              className={`min-h-20 w-full flex-col items-start text-left ${selected === item.key ? "outline-2 outline-[var(--dpf-accent)]" : ""}`}
              onClick={() => navigate(item.key)} onKeyDown={(event) => {
                let target = index;
                if (event.key === "ArrowRight" || event.key === "ArrowDown") target = Math.min(index + 1, visibleStages.length - 1);
                else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = Math.max(index - 1, 0);
                else if (event.key === "Home") target = 0;
                else if (event.key === "End") target = visibleStages.length - 1;
                else return;
                event.preventDefault();
                navigate(visibleStages[target].key);
                stepsRef.current?.querySelectorAll<HTMLButtonElement>("button[data-step-key]")[target]?.focus();
              }}>
              <span>{graph.stages.indexOf(item) + 1}. {item.label}</span>
              <StatusBadge domain="workroomStage" status={item.state} label={STATE_LABEL[item.state]} size="md" uppercase={false} />
            </Button>
          </li>)}
        </ul>
      </div>
    </div>
    {stage ? <aside aria-label={`${stage.label} inspection`} className="rounded-lg border border-[var(--dpf-border)] p-4">
      <h3 className="mb-3 text-base font-semibold">{stage.label}</h3>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="font-medium">Where are we?</dt><dd>{inspection?.position ?? `${stage.label}: ${STATE_LABEL[stage.state]}`}</dd></div>
        <div><dt className="font-medium">Why are we here?</dt><dd>{inspection?.reason ?? "No reason recorded."}</dd></div>
        <div><dt className="font-medium">What can happen next?</dt><dd>{inspection?.next ?? "Permitted transitions are unknown."}</dd></div>
        <div><dt className="font-medium">Who owns the action?</dt><dd>{inspection?.owner ?? "Owner unknown"}</dd></div>
        <div><dt className="font-medium">What evidence supports this?</dt><dd className="mt-1 space-y-2">
          <Evidence rows={stage.rows} />
          {inspection?.expectedEvidence.length ? <p>Required: {inspection.expectedEvidence.join(", ")}</p> : null}
        </dd></div>
        <div><dt className="font-medium">What else is affected?</dt><dd className="break-words">{inspection?.affected.length ? inspection.affected.map((ref) => `${ref.kind}:${ref.id}`).join(", ") : "Dependencies unknown"}</dd></div>
      </dl>
    </aside> : <p className="text-[var(--dpf-muted)]">Select a step to inspect its state and evidence.</p>}
    {graph.process ? <details className="rounded border border-[var(--dpf-border)] p-3">
      <summary className="cursor-pointer font-medium">Observed execution · {graph.process.receipts.length} room records</summary>
      <div className="mt-3"><Evidence rows={graph.process.receipts} /></div>
    </details> : null}
  </section>;
}

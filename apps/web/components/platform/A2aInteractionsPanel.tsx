"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { StatCard, StatusBadge, intentStyle } from "@/components/ui/report-kit";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  OperationsMapA2aEdge,
  OperationsMapA2aEdgeKind,
  OperationsMapA2aInteractionState,
  OperationsMapA2aLegendItem,
  OperationsMapRoutingCoworker,
} from "@/lib/ai-operations-map/types";
import {
  A2A_EDGE_KINDS,
  A2A_GRAPH_LAYOUT,
  A2A_STATES,
  a2aEdgeSourceRecords,
  a2aStateIntent,
  columnPositions,
  coworkerHref,
  EDGE_KIND_LABEL,
  edgeKindDash,
  edgePath,
  edgeStrokeWidth,
  graphHeight,
  orderedUnique,
  STATE_LABEL,
  svgClip,
  titleize,
} from "./a2a-interaction-graph";
import {
  clearA2aFilterPreference,
  getDefaultA2aFilterPreference,
  loadA2aFilterPreference,
  saveA2aFilterPreference,
  type A2aActorRole,
} from "./ai-operations-map-prefs";

type Props = {
  coworkers: OperationsMapRoutingCoworker[];
  a2aEdges: OperationsMapA2aEdge[];
  a2aLegend: OperationsMapA2aLegendItem[];
};

export function A2aInteractionsPanel({ coworkers, a2aEdges, a2aLegend }: Props) {
  const defaults = getDefaultA2aFilterPreference();
  const [typeFilters, setTypeFilters] = useState<OperationsMapA2aEdgeKind[]>(defaults.types);
  const [stateFilters, setStateFilters] = useState<OperationsMapA2aInteractionState[]>(defaults.states);
  const [actorId, setActorId] = useState<string>(defaults.actorId);
  const [actorRole, setActorRole] = useState<A2aActorRole>(defaults.actorRole);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const hydrated = useRef(false);

  // Hydrate persisted filter state once on mount, then persist on change —
  // mirrors the Operations Map view-preference pattern in AiOperationsMap.
  useEffect(() => {
    const pref = loadA2aFilterPreference();
    setTypeFilters(pref.types);
    setStateFilters(pref.states);
    setActorId(pref.actorId);
    setActorRole(pref.actorRole);
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    saveA2aFilterPreference({ types: typeFilters, states: stateFilters, actorId, actorRole });
  }, [typeFilters, stateFilters, actorId, actorRole]);

  const labelByAgentId = useMemo(
    () => new Map(coworkers.map((coworker) => [coworker.agentId, coworker.label])),
    [coworkers],
  );
  const labelFor = useMemo(
    () => (agentId: string) => labelByAgentId.get(agentId) ?? titleize(agentId),
    [labelByAgentId],
  );

  const participantIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of a2aEdges) {
      ids.add(edge.fromCoworkerId);
      ids.add(edge.toCoworkerId);
    }
    return orderedUnique([...ids], labelFor);
  }, [a2aEdges, labelFor]);

  const filteredEdges = useMemo(
    () =>
      a2aEdges.filter((edge) => {
        if (!typeFilters.includes(edge.edgeKind)) return false;
        if (!stateFilters.includes(edge.state)) return false;
        if (actorId !== "all") {
          const matchesFrom = edge.fromCoworkerId === actorId;
          const matchesTo = edge.toCoworkerId === actorId;
          if (actorRole === "from" && !matchesFrom) return false;
          if (actorRole === "to" && !matchesTo) return false;
          if (actorRole === "either" && !matchesFrom && !matchesTo) return false;
        }
        return true;
      }),
    [a2aEdges, typeFilters, stateFilters, actorId, actorRole],
  );

  const selectedEdge = filteredEdges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const stateCounts = useMemo(() => {
    const counts: Record<OperationsMapA2aInteractionState, number> = { active: 0, completed: 0, failed: 0, blocked: 0 };
    for (const edge of filteredEdges) counts[edge.state] += 1;
    return counts;
  }, [filteredEdges]);

  const toggleType = (kind: OperationsMapA2aEdgeKind) =>
    setTypeFilters((current) => toggleOption(current, kind, A2A_EDGE_KINDS));
  const toggleState = (state: OperationsMapA2aInteractionState) =>
    setStateFilters((current) => toggleOption(current, state, A2A_STATES));
  const resetFilters = () => {
    const reset = getDefaultA2aFilterPreference();
    setTypeFilters(reset.types);
    setStateFilters(reset.states);
    setActorId(reset.actorId);
    setActorRole(reset.actorRole);
    setSelectedEdgeId(null);
    clearA2aFilterPreference();
  };

  return (
    <section
      aria-label="Coworker interaction map"
      className="space-y-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <header className="space-y-3">
        <div className="max-w-2xl">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Coworker-to-coworker interactions</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
            After-the-fact A2A visibility: which coworker delegated, handed off, or spawned work to which other
            coworker, under what authority, and how it resolved. Filter by interaction type, state, and coworker for
            audit and troubleshooting.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Interactions" value={filteredEdges.length} intent="accent" />
          <StatCard label="Active" value={stateCounts.active} intent="accent" />
          <StatCard label="Failed" value={stateCounts.failed} intent="danger" />
          <StatCard label="Blocked" value={stateCounts.blocked} intent="warning" />
        </div>
      </header>

      {a2aEdges.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-center text-sm text-[var(--dpf-muted)]">
          No coworker-to-coworker interactions recorded in the current window. Delegation, build phase-handoff, and
          task-lineage interactions appear here as coworkers collaborate.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
            <ChipGroup label="Interaction type">
              {A2A_EDGE_KINDS.map((kind) => (
                <Chip key={kind} active={typeFilters.includes(kind)} label={EDGE_KIND_LABEL[kind]} onClick={() => toggleType(kind)} />
              ))}
            </ChipGroup>
            <ChipGroup label="State">
              {A2A_STATES.map((state) => (
                <Chip key={state} active={stateFilters.includes(state)} label={STATE_LABEL[state]} onClick={() => toggleState(state)} />
              ))}
            </ChipGroup>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Coworker</p>
              <div className="flex flex-wrap items-center gap-2">
                <label>
                  <span className="sr-only">Filter by coworker</span>
                  <select
                    value={actorId}
                    onChange={(event) => setActorId(event.target.value)}
                    className="min-h-8 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1 text-xs text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                  >
                    <option value="all">All coworkers</option>
                    {participantIds.map((id) => (
                      <option key={id} value={id}>
                        {labelFor(id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={actorId === "all" ? "opacity-50" : undefined}>
                  <span className="sr-only">Coworker role</span>
                  <select
                    value={actorRole}
                    disabled={actorId === "all"}
                    onChange={(event) => setActorRole(event.target.value as A2aActorRole)}
                    className="min-h-8 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-1 text-xs text-[var(--dpf-text)] focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                  >
                    <option value="either">as either</option>
                    <option value="from">as source</option>
                    <option value="to">as target</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs font-medium text-[var(--dpf-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <InteractionBand edges={filteredEdges} labelFor={labelFor} selectedEdgeId={selectedEdge?.id ?? null} onSelect={setSelectedEdgeId} />
            <A2aEdgeInspector edge={selectedEdge} labelFor={labelFor} />
          </div>

          <A2aLegendRail legend={a2aLegend} />
        </>
      )}
    </section>
  );
}

function InteractionBand({
  edges,
  labelFor,
  selectedEdgeId,
  onSelect,
}: {
  edges: OperationsMapA2aEdge[];
  labelFor: (agentId: string) => string;
  selectedEdgeId: string | null;
  onSelect: (edgeId: string) => void;
}) {
  const fromIds = useMemo(() => orderedUnique(edges.map((edge) => edge.fromCoworkerId), labelFor), [edges, labelFor]);
  const toIds = useMemo(() => orderedUnique(edges.map((edge) => edge.toCoworkerId), labelFor), [edges, labelFor]);
  const height = graphHeight(Math.max(fromIds.length, toIds.length, 1));
  const fromY = columnPositions(fromIds, height);
  const toY = columnPositions(toIds, height);

  if (edges.length === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-6 text-sm text-[var(--dpf-muted)]">
        No interactions match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <svg
        viewBox={`0 0 ${A2A_GRAPH_LAYOUT.width} ${height}`}
        role="img"
        aria-label="Coworker-to-coworker interaction edges"
        className="h-full w-full"
        style={{ minHeight: 220 }}
      >
        <defs>
          {A2A_STATES.map((state) => (
            <marker
              key={state}
              id={`a2a-arrow-${state}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={intentStyle(a2aStateIntent(state)).fg} />
            </marker>
          ))}
        </defs>

        <text x={A2A_GRAPH_LAYOUT.fromX} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
          From coworker
        </text>
        <text x={A2A_GRAPH_LAYOUT.toX} y="22" textAnchor="middle" className="fill-[var(--dpf-muted)] text-[10px] uppercase tracking-[0.16em]">
          To coworker
        </text>

        {edges.map((edge, index) => {
          const start = { x: A2A_GRAPH_LAYOUT.fromX, y: fromY.get(edge.fromCoworkerId) ?? height / 2 };
          const end = { x: A2A_GRAPH_LAYOUT.toX, y: toY.get(edge.toCoworkerId) ?? height / 2 };
          const isSelected = edge.id === selectedEdgeId;
          const stroke = intentStyle(a2aStateIntent(edge.state)).fg;
          return (
            <path
              key={edge.id}
              data-a2a-edge={edge.edgeKind}
              data-a2a-state={edge.state}
              role="button"
              tabIndex={0}
              aria-label={`${labelFor(edge.fromCoworkerId)} → ${labelFor(edge.toCoworkerId)}: ${EDGE_KIND_LABEL[edge.edgeKind]} (${STATE_LABEL[edge.state]})`}
              d={edgePath(start, end, index)}
              fill="none"
              stroke={stroke}
              strokeWidth={edgeStrokeWidth(edge.weight, isSelected)}
              strokeDasharray={edgeKindDash(edge.edgeKind)}
              strokeOpacity={isSelected ? 1 : 0.85}
              strokeLinecap="round"
              markerEnd={`url(#a2a-arrow-${edge.state})`}
              className="cursor-pointer focus:outline-none"
              onClick={() => onSelect(edge.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(edge.id);
                }
              }}
            >
              <title>{`${labelFor(edge.fromCoworkerId)} → ${labelFor(edge.toCoworkerId)}: ${edge.label}`}</title>
            </path>
          );
        })}

        {fromIds.map((id) => (
          <CoworkerNode key={`from-${id}`} x={A2A_GRAPH_LAYOUT.fromX} y={fromY.get(id) ?? height / 2} label={labelFor(id)} side="from" />
        ))}
        {toIds.map((id) => (
          <CoworkerNode key={`to-${id}`} x={A2A_GRAPH_LAYOUT.toX} y={toY.get(id) ?? height / 2} label={labelFor(id)} side="to" />
        ))}
      </svg>
    </div>
  );
}

function CoworkerNode({ x, y, label, side }: { x: number; y: number; label: string; side: "from" | "to" }) {
  const textX = side === "from" ? x - A2A_GRAPH_LAYOUT.nodeRadius - 8 : x + A2A_GRAPH_LAYOUT.nodeRadius + 8;
  const anchor = side === "from" ? "end" : "start";
  return (
    <g>
      <circle cx={x} cy={y} r={A2A_GRAPH_LAYOUT.nodeRadius} fill="var(--dpf-surface-1)" stroke="var(--dpf-accent)" strokeWidth="2.2" />
      <circle cx={x} cy={y} r="2.4" fill="var(--dpf-accent)" />
      <text x={textX} y={y + 3.5} textAnchor={anchor} className="fill-[var(--dpf-text)] text-[10px] font-semibold">
        {svgClip(label, 22)}
      </text>
    </g>
  );
}

function A2aEdgeInspector({
  edge,
  labelFor,
}: {
  edge: OperationsMapA2aEdge | null;
  labelFor: (agentId: string) => string;
}) {
  const sourceRecords = edge ? a2aEdgeSourceRecords(edge) : [];
  return (
    <aside aria-label="Interaction inspector" className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Inspector</h3>
      {!edge ? (
        <p className="mt-3 text-xs text-[var(--dpf-muted)]">
          Select an interaction edge to inspect the coworkers, authority, and result behind it.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{EDGE_KIND_LABEL[edge.edgeKind]}</p>
              <StatusBadge domain="a2aInteraction" status={edge.state} label={STATE_LABEL[edge.state]} variant="soft" />
            </div>
            <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
              {labelFor(edge.fromCoworkerId)} → {labelFor(edge.toCoworkerId)}
            </p>
            <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{edge.summary}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
            <dt className="font-semibold text-[var(--dpf-muted)]">When</dt>
            <dd className="min-w-0 break-words text-[var(--dpf-text)]">
              <LocalTime value={edge.occurredAt} fallback="Unknown time" />
            </dd>
            {edge.skillId ? <Fact label="Skill" value={edge.skillId} /> : null}
            {edge.gateResult ? <Fact label="Gate / consensus" value={edge.gateResult} /> : null}
            {edge.authorityScope && edge.authorityScope.length > 0 ? (
              <Fact label="Authority" value={edge.authorityScope.join(", ")} />
            ) : null}
            {edge.sensitivity ? <Fact label="Sensitivity" value={edge.sensitivity} /> : null}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Link href={coworkerHref(edge.fromCoworkerId)} className="text-xs text-[var(--dpf-accent)] hover:underline">
              Open source coworker
            </Link>
            <Link href={coworkerHref(edge.toCoworkerId)} className="text-xs text-[var(--dpf-accent)] hover:underline">
              Open target coworker
            </Link>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Source records</p>
            {sourceRecords.length === 0 ? (
              <p className="text-[11px] text-[var(--dpf-muted)]">No source record reference on this interaction.</p>
            ) : (
              <ul className="space-y-1">
                {sourceRecords.map((record) => (
                  <li key={`${record.label}:${record.value}`} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-semibold text-[var(--dpf-muted)]">{record.label}:</span>
                    {record.href ? (
                      <Link href={record.href} className="break-all text-[var(--dpf-accent)] hover:underline">
                        {record.value}
                      </Link>
                    ) : (
                      <span className="break-all text-[var(--dpf-text)]" title="No detail page for this record type yet">
                        {record.value}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}

function A2aLegendRail({ legend }: { legend: OperationsMapA2aLegendItem[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
      <div aria-label="Interaction type key" className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Types</span>
        {legend.map((item) => (
          <span key={item.edgeKind} title={item.description} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--dpf-text)]">
            <svg width="34" height="8" aria-hidden="true">
              <line x1="1" y1="4" x2="33" y2="4" stroke="var(--dpf-accent)" strokeWidth="2.2" strokeDasharray={edgeKindDash(item.edgeKind)} strokeLinecap="round" />
            </svg>
            {item.label}
          </span>
        ))}
      </div>
      <div aria-label="State key" className="flex flex-wrap items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">States</span>
        {A2A_STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--dpf-text)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: intentStyle(a2aStateIntent(state)).fg }} />
            {STATE_LABEL[state]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Small presentational helpers ─────────────────────────────────────

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={[
        "min-h-7 rounded-full px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
        active
          ? "bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
          : "text-[var(--dpf-muted)] hover:bg-[var(--dpf-surface-1)] hover:text-[var(--dpf-text)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-semibold text-[var(--dpf-muted)]">{label}</dt>
      <dd className="min-w-0 break-words text-[var(--dpf-text)]">{value}</dd>
    </>
  );
}

function toggleOption<T extends string>(current: T[], option: T, all: T[]): T[] {
  if (current.includes(option)) {
    const next = current.filter((candidate) => candidate !== option);
    return next.length === 0 ? all : next;
  }
  return all.filter((candidate) => candidate === option || current.includes(candidate));
}

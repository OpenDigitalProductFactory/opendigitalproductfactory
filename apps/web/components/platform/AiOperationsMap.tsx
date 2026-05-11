"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type {
  OperationsMapProjection,
  OperationsMapProjectionSource,
  OperationsMapQuickViewId,
  OperationsMapSeverity,
  OperationsMapTemplate,
  StationedOperationsMapAgent,
} from "@/lib/ai-operations-map/types";
import {
  filterOperationsMapProjections,
  getOperationsMapQuickViewFilters,
  OPERATIONS_MAP_QUICK_VIEWS,
  summarizeProjectionCounts,
} from "@/lib/ai-operations-map/project-events";

type SelectedItem =
  | { kind: "station"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "projection"; id: string };

type Props = {
  template: OperationsMapTemplate;
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  recentWindowLabel: string;
};

const SEVERITY_CLASS: Record<OperationsMapProjection["severity"], string> = {
  normal: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
  attention: "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]",
  warning: "border-[var(--dpf-warning)] bg-[color-mix(in_srgb,var(--dpf-warning)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]",
  critical: "border-[var(--dpf-error)] bg-[color-mix(in_srgb,var(--dpf-error)_10%,var(--dpf-surface-1))] text-[var(--dpf-text)]",
};

const SOURCE_LABEL: Record<OperationsMapProjection["source"], string> = {
  "tool-execution": "Tool execution",
  "tool-receipt": "Receipt",
  "evidence-backlog": "Backlog evidence",
  "evidence-external": "External evidence",
};

const SOURCE_OPTIONS: OperationsMapProjectionSource[] = [
  "tool-execution",
  "tool-receipt",
  "evidence-backlog",
  "evidence-external",
];

const SEVERITY_OPTIONS: OperationsMapSeverity[] = ["normal", "attention", "warning", "critical"];
const DEFAULT_QUICK_VIEW_ID: OperationsMapQuickViewId = "all";
const DEFAULT_QUICK_VIEW_FILTERS = getOperationsMapQuickViewFilters(DEFAULT_QUICK_VIEW_ID);

export function AiOperationsMap({ template, agents, projections, recentWindowLabel }: Props) {
  const [selected, setSelected] = useState<SelectedItem>({ kind: "station", id: template.stations[0]?.id ?? "" });
  const [activeQuickViewId, setActiveQuickViewId] = useState<OperationsMapQuickViewId | "custom">(
    DEFAULT_QUICK_VIEW_ID,
  );
  const [sourceFilters, setSourceFilters] = useState<OperationsMapProjectionSource[]>(
    DEFAULT_QUICK_VIEW_FILTERS.sources,
  );
  const [severityFilters, setSeverityFilters] = useState<OperationsMapSeverity[]>(
    DEFAULT_QUICK_VIEW_FILTERS.severities,
  );
  const filteredProjections = useMemo(
    () => filterOperationsMapProjections(projections, { sources: sourceFilters, severities: severityFilters }),
    [projections, sourceFilters, severityFilters],
  );
  const counts = useMemo(() => summarizeProjectionCounts(filteredProjections), [filteredProjections]);

  const selectedStation = selected.kind === "station"
    ? template.stations.find((station) => station.id === selected.id) ?? null
    : null;
  const selectedAgent = selected.kind === "agent"
    ? agents.find((agent) => agent.agentId === selected.id) ?? null
    : null;
  const selectedProjection = selected.kind === "projection"
    ? filteredProjections.find((projection) => projection.id === selected.id) ?? null
    : null;
  const applyQuickView = (viewId: OperationsMapQuickViewId) => {
    const filters = getOperationsMapQuickViewFilters(viewId);
    setActiveQuickViewId(viewId);
    setSourceFilters(filters.sources);
    setSeverityFilters(filters.severities);
  };
  const toggleSourceFilter = (source: OperationsMapProjectionSource) => {
    setActiveQuickViewId("custom");
    setSourceFilters((current) => toggleFilterOption(current, source, SOURCE_OPTIONS));
  };
  const toggleSeverityFilter = (severity: OperationsMapSeverity) => {
    setActiveQuickViewId("custom");
    setSeverityFilters((current) => toggleFilterOption(current, severity, SEVERITY_OPTIONS));
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
            AI workforce
          </p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">AI Operations Map</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            {template.label} projects coworker work onto the business flow using existing execution, receipt, and evidence records.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Normal" value={counts.normal} />
          <Metric label="Attention" value={counts.attention} />
          <Metric label="Warning" value={counts.warning} />
          <Metric label="Critical" value={counts.critical} />
        </div>
      </header>

      <section
        aria-label="Map view controls"
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3"
      >
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">View controls</h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Showing {filteredProjections.length} of {projections.length} activities
            </p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <FilterGroup label="Quick views">
              {OPERATIONS_MAP_QUICK_VIEWS.map((view) => (
                <FilterButton
                  key={view.id}
                  active={activeQuickViewId === view.id}
                  label={view.label}
                  title={view.description}
                  onClick={() => applyQuickView(view.id)}
                />
              ))}
              {activeQuickViewId === "custom" ? (
                <span className="inline-flex min-h-8 items-center rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs text-[var(--dpf-muted)]">
                  Custom
                </span>
              ) : null}
            </FilterGroup>
            <FilterGroup label="Sources">
              {SOURCE_OPTIONS.map((source) => (
                <FilterButton
                  key={source}
                  active={sourceFilters.includes(source)}
                  label={SOURCE_LABEL[source]}
                  onClick={() => toggleSourceFilter(source)}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="Severity">
              {SEVERITY_OPTIONS.map((severity) => (
                <FilterButton
                  key={severity}
                  active={severityFilters.includes(severity)}
                  label={capitalizeSeverity(severity)}
                  onClick={() => toggleSeverityFilter(severity)}
                />
              ))}
            </FilterGroup>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section
          aria-label={`${template.label} map`}
          className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
        >
          <div className="border-b border-[var(--dpf-border)] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--dpf-text)]">{template.label}</h2>
                <p className="text-xs text-[var(--dpf-muted)]">{recentWindowLabel}</p>
              </div>
              <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
                Read-only V2
              </span>
            </div>
          </div>

          <div className="space-y-4 p-4">
            {template.lines.map((line) => (
              <div key={line.id} className="space-y-3" aria-label={line.label}>
                <div className="flex items-center gap-2">
                  <div className="h-px flex-1 bg-[var(--dpf-border)]" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
                    {line.label}
                  </span>
                  <div className="h-px flex-1 bg-[var(--dpf-border)]" />
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  {line.stationIds.map((stationId) => {
                    const station = template.stations.find((candidate) => candidate.id === stationId);
                    if (!station) return null;
                    const stationAgents = agents.filter((agent) => agent.stationId === station.id);
                    const stationProjections = filteredProjections.filter((projection) => projection.location.stationId === station.id);
                    const isSelected = selected.kind === "station" && selected.id === station.id;

                    return (
                      <button
                        key={station.id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => setSelected({ kind: "station", id: station.id })}
                        className={[
                          "min-h-44 rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
                          isSelected
                            ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]"
                            : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] hover:border-[var(--dpf-accent)]",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{station.label}</h3>
                            <p className="mt-1 line-clamp-3 text-xs leading-5 text-[var(--dpf-muted)]">
                              {station.description}
                            </p>
                          </div>
                          <span className="rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[10px] text-[var(--dpf-muted)]">
                            {stationProjections.length}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {stationAgents.slice(0, 3).map((agent) => (
                            <span
                              key={agent.agentId}
                              className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-[10px] text-[var(--dpf-text)]"
                            >
                              {agent.name}
                            </span>
                          ))}
                          {stationAgents.length > 3 ? (
                            <span className="rounded border border-[var(--dpf-border)] px-2 py-1 text-[10px] text-[var(--dpf-muted)]">
                              +{stationAgents.length - 3}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-3 space-y-1">
                          {stationProjections.slice(0, 2).map((projection) => (
                            <span
                              key={projection.id}
                              className={[
                                "block rounded border px-2 py-1 text-[10px]",
                                SEVERITY_CLASS[projection.severity],
                              ].join(" ")}
                            >
                              {projection.label}: {projection.severity}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4" aria-label="Map inspector">
          <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Inspector</h2>
          {selectedStation ? (
            <StationInspector station={selectedStation} agents={agents} projections={filteredProjections} onSelect={setSelected} />
          ) : null}
          {selectedAgent ? <AgentInspector agent={selectedAgent} /> : null}
          {selectedProjection ? <ProjectionInspector projection={selectedProjection} /> : null}
        </aside>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={[
        "min-h-8 rounded border px-2.5 py-1 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--dpf-accent)]",
        active
          ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]"
          : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:border-[var(--dpf-accent)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{value}</p>
    </div>
  );
}

function StationInspector({
  station,
  agents,
  projections,
  onSelect,
}: {
  station: OperationsMapTemplate["stations"][number];
  agents: StationedOperationsMapAgent[];
  projections: OperationsMapProjection[];
  onSelect: (selected: SelectedItem) => void;
}) {
  const stationAgents = agents.filter((agent) => agent.stationId === station.id);
  const stationProjections = projections.filter((projection) => projection.location.stationId === station.id);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Station</p>
        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{station.label}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">{station.description}</p>
      </div>

      <InspectorList title="Coworkers">
        {stationAgents.length > 0 ? stationAgents.map((agent) => (
          <button
            key={agent.agentId}
            type="button"
            onClick={() => onSelect({ kind: "agent", id: agent.agentId })}
            className="w-full rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-left text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            {agent.name}
          </button>
        )) : (
          <p className="text-xs text-[var(--dpf-muted)]">No coworkers currently placed here.</p>
        )}
      </InspectorList>

      <InspectorList title="Recent activity">
        {stationProjections.length > 0 ? stationProjections.map((projection) => (
          <button
            key={projection.id}
            type="button"
            onClick={() => onSelect({ kind: "projection", id: projection.id })}
            className={[
              "w-full rounded border px-3 py-2 text-left text-xs hover:border-[var(--dpf-accent)]",
              SEVERITY_CLASS[projection.severity],
            ].join(" ")}
          >
            {projection.summary}
          </button>
        )) : (
          <p className="text-xs text-[var(--dpf-muted)]">No recent activity projected here.</p>
        )}
      </InspectorList>
    </div>
  );
}

function AgentInspector({ agent }: { agent: StationedOperationsMapAgent }) {
  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Coworker</p>
        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{agent.name}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">
          {agent.description ?? "No description recorded."}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <InspectorFact label="Station" value={agent.stationLabel} />
        <InspectorFact label="Tier" value={`Tier ${agent.tier}`} />
        <InspectorFact label="Skills" value={String(agent.counts.skills)} />
        <InspectorFact label="Tool grants" value={String(agent.counts.toolGrants)} />
      </dl>
      <Link href={`/platform/ai/agent/${encodeURIComponent(agent.agentId)}`} className="inline-flex text-sm text-[var(--dpf-accent)] hover:underline">
        Open coworker detail
      </Link>
    </div>
  );
}

function ProjectionInspector({ projection }: { projection: OperationsMapProjection }) {
  const linkItems = [
    projection.links.authorityHref ? { href: projection.links.authorityHref, label: "Open audit row" } : null,
    projection.links.historyHref ? { href: projection.links.historyHref, label: "Open history" } : null,
    projection.links.backlogHref ? { href: projection.links.backlogHref, label: "Open backlog item" } : null,
    projection.links.coworkerHref ? { href: projection.links.coworkerHref, label: "Open coworker" } : null,
  ].filter((item): item is { href: string; label: string } => item !== null);

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
          {SOURCE_LABEL[projection.source]}
        </p>
        <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{projection.label}</h3>
        <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">{projection.summary}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-xs">
        <InspectorFact label="Source" value={SOURCE_LABEL[projection.source]} />
        <InspectorFact label="Severity" value={projection.severity} />
        {projection.refs.threadId ? <InspectorFact label="Thread" value={projection.refs.threadId} /> : null}
        {projection.refs.backlogItemId ? <InspectorFact label="Backlog item" value={projection.refs.backlogItemId} /> : null}
      </dl>
      <div className="flex flex-wrap gap-2">
        {linkItems.map((item) => (
          <Link key={item.href} href={item.href} className="text-sm text-[var(--dpf-accent)] hover:underline">
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function InspectorList({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InspectorFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 break-words font-medium text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function toggleFilterOption<T extends string>(current: T[], option: T, allOptions: T[]): T[] {
  if (current.includes(option)) return current.filter((candidate) => candidate !== option);
  return allOptions.filter((candidate) => candidate === option || current.includes(candidate));
}

function capitalizeSeverity(severity: OperationsMapSeverity): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

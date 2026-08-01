"use client";

// Admin graph explorer (BI-89A149A9) — the visual exploration surface for the
// unified `graph_node` / `graph_edge` mirror that replaced Neo4j in BET-5.
//
// Interaction model is query-first, deliberately the Neo4j-Browser shape: the
// corpus is ~24.6k nodes, so nothing is drawn until the operator names a starting
// point. Search seeds the canvas, a click focuses, "Expand" walks one more hop.
//
// Progressive disclosure (AGENTS.md §12 UX-fit): the default view offers four
// choices — search, domain, hop depth, expand. The 12 raw node labels and 15
// relationship types stay behind "Advanced filters" for the operator who wants
// them.

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { RelationshipGraph, type GraphLegendEntry } from "@/components/inventory/RelationshipGraph";
import {
  findGraphNodes,
  loadGraphNeighbourhood,
  loadGraphNodeDetail,
} from "@/lib/actions/graph-explorer";
import type {
  GraphCensus,
  GraphNodeDetail,
  GraphNodeSummary,
  GraphSubgraph,
} from "@/lib/graph/explorer-queries";
import {
  GRAPH_DOMAINS,
  describeLabel,
  describeNodeLabels,
  describeRelType,
  type GraphDomainKey,
} from "@/lib/graph/explorer-vocabulary";
import type { GraphData } from "@/lib/actions/graph";

type Props = {
  census: GraphCensus;
};

const EMPTY_SUBGRAPH: GraphSubgraph = { nodes: [], edges: [], truncated: false, notice: null };

export function GraphExplorer({ census }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GraphNodeSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const [seedKeys, setSeedKeys] = useState<string[]>([]);
  const [depth, setDepth] = useState(1);
  const [activeDomains, setActiveDomains] = useState<Set<GraphDomainKey>>(new Set());
  const [activeRelTypes, setActiveRelTypes] = useState<Set<string>>(new Set());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [subgraph, setSubgraph] = useState<GraphSubgraph>(EMPTY_SUBGRAPH);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [inspected, setInspected] = useState<GraphNodeDetail | null>(null);

  // ─── Census-derived facets ──────────────────────────────────────────────────

  const domainCounts = useMemo(() => {
    const counts = new Map<GraphDomainKey, number>();
    for (const row of census.labels) {
      const { domain } = describeLabel(row.label);
      // `EaElement` and its concrete `ArchiMate__*` type both count the same node;
      // the generic marker is the one that double-counts, so it is skipped.
      if (row.label === "EaElement") continue;
      counts.set(domain, (counts.get(domain) ?? 0) + row.count);
    }
    return counts;
  }, [census.labels]);

  const labelsForDomain = useCallback(
    (domain: GraphDomainKey) =>
      census.labels.filter((row) => describeLabel(row.label).domain === domain).map((row) => row.label),
    [census.labels],
  );

  /** Raw label filter sent to the server — empty means "no restriction". */
  const activeLabels = useMemo(() => {
    if (activeDomains.size === 0) return [];
    return [...activeDomains].flatMap((domain) => labelsForDomain(domain));
  }, [activeDomains, labelsForDomain]);

  const nodeLegend = useMemo<GraphLegendEntry[]>(() => {
    const seen = new Map<string, GraphLegendEntry>();
    for (const node of subgraph.nodes) {
      const descriptor = describeNodeLabels(node.labels);
      if (!seen.has(descriptor.key)) {
        seen.set(descriptor.key, {
          key: descriptor.key,
          label: descriptor.label,
          color: descriptor.color,
        });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [subgraph.nodes]);

  const linkLegend = useMemo<GraphLegendEntry[]>(() => {
    const seen = new Map<string, GraphLegendEntry>();
    for (const edge of subgraph.edges) {
      if (!seen.has(edge.relType)) seen.set(edge.relType, describeRelType(edge.relType));
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [subgraph.edges]);

  // ─── Canvas data ────────────────────────────────────────────────────────────

  const graphData = useMemo<GraphData>(() => {
    const seedSet = new Set(seedKeys);
    return {
      nodes: subgraph.nodes.map((node) => {
        const descriptor = describeNodeLabels(node.labels);
        return {
          id: node.key,
          name: node.name,
          label: descriptor.key,
          color: descriptor.color,
          // Seeds are drawn larger so the operator never loses their entry point.
          size: seedSet.has(node.key) ? descriptor.size + 3 : descriptor.size,
        };
      }),
      links: subgraph.edges.map((edge) => ({
        source: edge.from,
        target: edge.to,
        type: edge.relType,
      })),
    };
  }, [subgraph, seedKeys]);

  // ─── Data loading ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (seedKeys.length === 0) {
      setSubgraph(EMPTY_SUBGRAPH);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadGraphNeighbourhood({
      seedKeys,
      depth,
      labels: activeLabels,
      relTypes: [...activeRelTypes],
    })
      .then((result) => {
        if (!cancelled) setSubgraph(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setSubgraph(EMPTY_SUBGRAPH);
          setError(cause instanceof Error ? cause.message : "Could not load that view.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seedKeys, depth, activeLabels, activeRelTypes]);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      setResults(await findGraphNodes({ query: trimmed, labels: activeLabels }));
      setSearched(true);
    } catch (cause: unknown) {
      setResults([]);
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  const inspect = useCallback((key: string | null) => {
    if (!key) {
      setInspected(null);
      return;
    }
    loadGraphNodeDetail(key)
      .then(setInspected)
      .catch(() => setInspected(null));
  }, []);

  function startFrom(node: GraphNodeSummary) {
    setSeedKeys([node.key]);
    setInspected(null);
  }

  function expandFromInspected() {
    if (!inspected) return;
    setSeedKeys((prev) => (prev.includes(inspected.key) ? prev : [...prev, inspected.key]));
  }

  function toggleDomain(domain: GraphDomainKey) {
    setActiveDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  function toggleRelType(relType: string) {
    setActiveRelTypes((prev) => {
      const next = new Set(prev);
      if (next.has(relType)) next.delete(relType);
      else next.add(relType);
      return next;
    });
  }

  function reset() {
    setSeedKeys([]);
    setInspected(null);
    setSubgraph(EMPTY_SUBGRAPH);
    setActiveDomains(new Set());
    setActiveRelTypes(new Set());
    setDepth(1);
  }

  const purposeState =
    census.nodeTotal === 0
      ? "empty-corpus"
      : seedKeys.length === 0
        ? "no-starting-point"
        : "neighbourhood-drawn";

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="space-y-4"
      data-component="graph-explorer"
      data-dpf-purpose-route="/admin/graph-explorer"
      data-dpf-purpose-state={purposeState}
    >
      <div className="mb-6" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Graph Explorer</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          See how the parts of the platform link up. Search for a starting point. Then follow its
          links.
        </p>
      </div>

      <AdminTabNav />

      {/* Corpus census — what the platform knows about itself, at a glance. */}
      <section
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        data-dpf-purpose-key="corpus-census"
        data-dpf-purpose-completion-signal-key={
          purposeState === "empty-corpus" ? "graph-corpus-empty" : undefined
        }
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
            In the graph
          </h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            {census.nodeTotal.toLocaleString()} nodes · {census.edgeTotal.toLocaleString()} links
          </p>
        </div>
        <div
          className="grid grid-cols-2 sm:grid-cols-5 gap-3"
          data-dpf-purpose-key="domain-filter"
        >
          {GRAPH_DOMAINS.map((domain) => {
            const count = domainCounts.get(domain.key) ?? 0;
            const active = activeDomains.has(domain.key);
            return (
              <button
                key={domain.key}
                type="button"
                onClick={() => toggleDomain(domain.key)}
                title={domain.description}
                aria-pressed={active}
                className={`text-left p-3 rounded-lg border transition-colors ${
                  active
                    ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10"
                    : "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] hover:border-[var(--dpf-accent)]"
                }`}
              >
                <p className="text-dpf-caption text-[var(--dpf-muted)]">{domain.label}</p>
                <p className="text-sm font-semibold text-[var(--dpf-text)]">
                  {count.toLocaleString()}
                </p>
              </button>
            );
          })}
        </div>
        <p className="text-dpf-caption text-[var(--dpf-muted)] mt-2">
          {activeDomains.size === 0
            ? "All types are shown. Pick one or more to narrow the search."
            : `Set to ${[...activeDomains]
                .map((d) => GRAPH_DOMAINS.find((g) => g.key === d)?.label ?? d)
                .join(", ")}.`}
        </p>
      </section>

      {purposeState === "empty-corpus" && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 border border-[var(--dpf-border)] px-3 py-2"
          data-dpf-purpose-message-key="graph-explorer.empty-corpus"
        >
          <p className="text-xs text-[var(--dpf-muted)]">
            The graph is empty. Populate the platform mirror before exploring relationships.
          </p>
          <a
            href="/admin/platform-development"
            className="text-xs text-[var(--dpf-accent)] underline"
            data-dpf-purpose-action-key="open-platform-development"
            data-dpf-purpose-recovery-action
            data-dpf-purpose-recovery-signal
            data-dpf-purpose-correction-signal-key="graph-population-recovery"
          >
            Open Platform Development
          </a>
        </div>
      )}

      {/* Search — the entry point. Nothing renders until the operator picks a node. */}
      <section
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
        data-dpf-purpose-key="search-field"
      >
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label
              htmlFor="graph-explorer-search"
              className="block text-dpf-caption text-[var(--dpf-muted)] mb-1"
            >
              Find a starting point
            </label>
            <input
              id="graph-explorer-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void runSearch();
                }
              }}
              placeholder="Search by name or path"
              className="w-full px-3 py-2 text-sm rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)]"
            />
          </div>

          <div data-dpf-purpose-key="hop-depth">
            <span className="block text-dpf-caption text-[var(--dpf-muted)] mb-1">Hops</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => setDepth(h)}
                  aria-pressed={depth === h}
                  className={`px-2.5 py-2 text-xs rounded-md border transition-colors ${
                    depth === h
                      ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/20 text-[var(--dpf-text)]"
                      : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
                  }`}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Search is the owner's first move on this surface, so it carries both
              the primary-action and owner-first-next-action markers. It sits above
              the fold, never inside a disclosure — the primary-action-reachable
              check is blocking. */}
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={searching}
            data-dpf-primary-action
            data-owner-first-next-action="graph-explorer-search"
            data-dpf-purpose-action-key="search-graph"
            className="px-3 py-2 text-xs rounded-md bg-[var(--dpf-accent)] text-white disabled:opacity-50"
          >
            {searching ? "Searching…" : "Search"}
          </button>

          <a
            href="/admin/graph-explorer"
            onClick={(event) => {
              event.preventDefault();
              reset();
            }}
            data-dpf-purpose-action-key="reset-explorer"
            data-dpf-purpose-recovery-action={purposeState !== "empty-corpus" || undefined}
            data-dpf-purpose-recovery-signal={purposeState !== "empty-corpus" || undefined}
            className="px-3 py-2 text-xs rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            Reset
          </a>
        </div>

        {searched && results.length === 0 && !searching && (
          <p
            className="text-xs text-[var(--dpf-muted)] mt-3"
            data-dpf-purpose-correction-signal-key="graph-search-correction"
          >
            Nothing matched “{query.trim()}”. Try a shorter word, or clear the type filter.
          </p>
        )}

        {results.length > 0 && (
          <ul
            className="mt-3 max-h-56 overflow-y-auto divide-y divide-[var(--dpf-border)] rounded-md border border-[var(--dpf-border)]"
            data-dpf-purpose-completion-signal-key="graph-search-results-visible"
          >
            {results.map((node) => {
              const descriptor = describeNodeLabels(node.labels);
              return (
                <li key={node.key}>
                  <button
                    type="button"
                    onClick={() => startFrom(node)}
                    className="w-full text-left px-3 py-2 hover:bg-[var(--dpf-surface-2)] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-dpf-caption px-1.5 py-0.5 rounded-full shrink-0"
                        style={{ background: `${descriptor.color}20`, color: descriptor.color }}
                      >
                        {descriptor.label}
                      </span>
                      <span className="text-xs text-[var(--dpf-text)] truncate">{node.name}</span>
                    </div>
                    {node.detail && (
                      <p className="text-dpf-caption text-[var(--dpf-muted)] truncate mt-0.5">
                        {node.detail}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {/* Advanced: the raw label and relationship facets, with live counts. */}
        <div data-dpf-purpose-disclosure-key="advanced-filters">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            aria-controls="graph-explorer-advanced-filters"
            data-dpf-purpose-disclosure-trigger
            className="mt-3 text-dpf-caption text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          >
            {showAdvanced ? "Hide more filters" : "More filters"}
          </button>

          <div
            id="graph-explorer-advanced-filters"
            hidden={!showAdvanced}
            data-dpf-purpose-disclosure-region
            className="mt-3 space-y-3"
          >
            <div>
              <p className="text-dpf-caption text-[var(--dpf-muted)] mb-1">Node types</p>
              <div className="flex flex-wrap gap-1">
                {census.labels.map((row) => {
                  const descriptor = describeLabel(row.label);
                  return (
                    <span
                      key={row.label}
                      className="text-dpf-caption px-1.5 py-0.5 rounded-full"
                      style={{ background: `${descriptor.color}20`, color: descriptor.color }}
                    >
                      {descriptor.label} · {row.count.toLocaleString()}
                    </span>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-dpf-caption text-[var(--dpf-muted)] mb-1">
                Follow only these links
                {activeRelTypes.size > 0 ? ` (${activeRelTypes.size} selected)` : " (all)"}
              </p>
              <div className="flex flex-wrap gap-1">
                {census.relTypes.map((row) => {
                  const descriptor = describeRelType(row.relType);
                  const active = activeRelTypes.has(row.relType);
                  return (
                    <button
                      key={row.relType}
                      type="button"
                      onClick={() => toggleRelType(row.relType)}
                      aria-pressed={active}
                      className="text-dpf-caption px-1.5 py-0.5 rounded-full border transition-colors"
                      style={{
                        borderColor: active ? descriptor.color : "var(--dpf-border)",
                        background: active ? `${descriptor.color}20` : "transparent",
                        color: active ? descriptor.color : "var(--dpf-muted)",
                      }}
                    >
                      {descriptor.label} · {row.count.toLocaleString()}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <p className="text-xs text-[var(--dpf-text)] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
          {error}
        </p>
      )}

      {subgraph.notice && (
        <p
          className="text-xs text-[var(--dpf-muted)] rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
          data-dpf-purpose-correction-signal-key="graph-view-narrowing-guidance"
        >
          {subgraph.notice}
        </p>
      )}

      {/* Canvas + inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">
        <div
          data-dpf-purpose-key="graph-canvas"
          data-dpf-purpose-completion-signal-key={
            purposeState === "neighbourhood-drawn" && subgraph.nodes.length > 0
              ? "graph-neighbourhood-visible"
              : undefined
          }
        >
          {loading && seedKeys.length > 0 && subgraph.nodes.length === 0 ? (
            <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-8 text-center text-sm text-[var(--dpf-muted)]">
              Loading…
            </div>
          ) : (
            <RelationshipGraph
              data={graphData}
              title="Graph Explorer"
              nodeLegend={nodeLegend}
              linkLegend={linkLegend}
              emptyMessage="Search above. Then pick a starting point."
              hint="Click a dot to see what it is"
              onFocusChange={inspect}
            />
          )}
        </div>

        <aside
          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          data-dpf-purpose-key="node-inspector"
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
            Details
          </h2>
          {!inspected ? (
            <p className="text-xs text-[var(--dpf-muted)]">
              {seedKeys.length === 0
                ? "Nothing picked yet."
                : "Click a dot to see what it is."}
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-[var(--dpf-text)] break-words">
                  {inspected.name}
                </p>
                {inspected.detail && (
                  <p className="text-dpf-caption text-[var(--dpf-muted)] break-words mt-0.5">
                    {inspected.detail}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-1">
                {inspected.labels.map((label) => {
                  const descriptor = describeLabel(label);
                  return (
                    <span
                      key={label}
                      className="text-dpf-caption px-1.5 py-0.5 rounded-full"
                      style={{ background: `${descriptor.color}20`, color: descriptor.color }}
                    >
                      {descriptor.label}
                    </span>
                  );
                })}
              </div>

              <p className="text-dpf-caption text-[var(--dpf-muted)]">
                {inspected.degree.toLocaleString()} link{inspected.degree === 1 ? "" : "s"} in
                the whole graph
              </p>

              <button
                type="button"
                onClick={expandFromInspected}
                disabled={seedKeys.includes(inspected.key)}
                data-dpf-purpose-action-key="expand-from-here"
                data-dpf-primary-action
                className="w-full px-3 py-2 text-xs rounded-md bg-[var(--dpf-accent)] text-white disabled:opacity-50"
              >
                {seedKeys.includes(inspected.key) ? "Already added" : "Expand from here"}
              </button>

            </div>
          )}

          <details
            className="mt-3 border-t border-[var(--dpf-border)] pt-3"
            data-dpf-purpose-disclosure-key="node-properties"
          >
            <summary
              className="cursor-pointer text-dpf-caption text-[var(--dpf-muted)]"
              data-dpf-purpose-disclosure-trigger
            >
              Raw properties
            </summary>
            <div data-dpf-purpose-disclosure-region>
              {inspected && Object.keys(inspected.props).length > 0 ? (
                <dl className="space-y-1 pt-2">
                  {Object.entries(inspected.props).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-dpf-caption uppercase tracking-wide text-[var(--dpf-muted)]">
                        {key}
                      </dt>
                      <dd className="text-dpf-caption text-[var(--dpf-text)] break-words">
                        {typeof value === "string" || typeof value === "number"
                          ? String(value)
                          : JSON.stringify(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="pt-2 text-dpf-caption text-[var(--dpf-muted)]">
                  Pick a node to inspect its properties.
                </p>
              )}
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}

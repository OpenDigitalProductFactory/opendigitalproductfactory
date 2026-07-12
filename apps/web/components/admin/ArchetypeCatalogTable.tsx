"use client";

import { useMemo, useState } from "react";

import {
  DataTable,
  FilterBar,
  StatCard,
  StatusBadge,
  type Column,
  type FacetDef,
} from "@/components/ui/report-kit";

export interface ArchetypeCatalogRow {
  archetypeId: string;
  name: string;
  category: string;
  categoryLabel: string;
  ctaType: string;
  isBuiltIn: boolean;
  twinTemplate: string;
  twinVariant: string | null;
  twinPhysical: boolean;
  enabled: boolean;
}

interface Props {
  rows: ArchetypeCatalogRow[];
}

const STATUS_FACET = "status";
const CATEGORY_FACET = "category";
const TWIN_FACET = "twin";
const SEARCH_FACET = "q";

function statusFacetOptions() {
  return [
    { value: "enabled", label: "Enabled" },
    { value: "available", label: "Available" },
  ];
}

export function ArchetypeCatalogTable({ rows }: Props) {
  const [filters, setFilters] = useState<Record<string, string>>({});

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.category)) seen.set(r.category, r.categoryLabel);
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const twinOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(r.twinTemplate);
    return [...seen]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = (filters[SEARCH_FACET] ?? "").trim().toLowerCase();
    return rows.filter((r) => {
      if (filters[STATUS_FACET] === "enabled" && !r.enabled) return false;
      if (filters[STATUS_FACET] === "available" && r.enabled) return false;
      if (filters[CATEGORY_FACET] && r.category !== filters[CATEGORY_FACET]) return false;
      if (filters[TWIN_FACET] && r.twinTemplate !== filters[TWIN_FACET]) return false;
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.archetypeId.toLowerCase().includes(q) &&
        !r.categoryLabel.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [rows, filters]);

  const facets: FacetDef[] = [
    { kind: "search", key: SEARCH_FACET, placeholder: "Search name, id, category…" },
    { kind: "pills", key: STATUS_FACET, label: "Status", options: statusFacetOptions() },
    { kind: "select", key: CATEGORY_FACET, label: "Category", options: categoryOptions },
    { kind: "select", key: TWIN_FACET, label: "Twin", options: twinOptions },
  ];

  const columns: Column<ArchetypeCatalogRow>[] = [
    {
      key: "name",
      header: "Archetype",
      sortAccessor: (r) => r.name,
      cell: (r) => (
        <div className="flex flex-col">
          <span className="font-medium text-[var(--dpf-text)]">{r.name}</span>
          <span className="font-mono text-[11px] text-[var(--dpf-muted)]">{r.archetypeId}</span>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortAccessor: (r) => r.categoryLabel,
      cell: (r) => <span className="text-sm text-[var(--dpf-text)]">{r.categoryLabel}</span>,
    },
    {
      key: "cta",
      header: "CTA",
      sortAccessor: (r) => r.ctaType,
      cell: (r) => <span className="text-sm text-[var(--dpf-muted)]">{r.ctaType}</span>,
    },
    {
      key: "twin",
      header: "Operational twin",
      sortAccessor: (r) => r.twinTemplate,
      cell: (r) => (
        <div className="flex items-center gap-2">
          <StatusBadge
            intent={r.twinPhysical ? "accent" : "info"}
            label={r.twinTemplate}
            variant="soft"
          />
          {r.twinVariant ? (
            <span className="text-[11px] text-[var(--dpf-muted)]">{r.twinVariant}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      sortAccessor: (r) => (r.enabled ? 0 : 1),
      cell: (r) =>
        r.enabled ? (
          <StatusBadge intent="success" label="Enabled" variant="soft" />
        ) : (
          <StatusBadge intent="neutral" label="Available" variant="outline" />
        ),
    },
  ];

  const enabledRow = rows.find((r) => r.enabled) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Configurations" value={rows.length} />
        <StatCard
          label="Enabled"
          value={enabledRow ? 1 : 0}
          intent="success"
          hint={enabledRow ? enabledRow.name : "None enabled yet"}
        />
        <StatCard
          label="Available"
          value={rows.filter((r) => !r.enabled).length}
          intent="neutral"
          hint="Not currently enabled"
        />
        <StatCard label="Categories" value={categoryOptions.length} intent="info" />
      </div>

      <FilterBar
        facets={facets}
        value={filters}
        onChange={setFilters}
        resultCount={filtered.length}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        getRowKey={(r) => r.archetypeId}
        initialSort={{ key: "status", dir: "asc" }}
        pageSize={25}
        empty={
          <span className="text-sm text-[var(--dpf-muted)]">
            No archetype configurations match these filters.
          </span>
        }
      />
    </div>
  );
}

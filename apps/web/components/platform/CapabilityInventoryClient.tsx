"use client";

import { useState } from "react";
import type {
  CapabilityInventoryRow,
  CapabilitySourceType,
} from "@/lib/actions/capability-inventory";

// ─── Badge helpers ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: CapabilityInventoryRow["availabilityStatus"] }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    degraded: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    inactive: "bg-gray-100 text-gray-500 dark:bg-gray-800/50 dark:text-gray-400",
    deprecated: "bg-gray-100 text-gray-400 line-through dark:bg-gray-800/30 dark:text-gray-500",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? styles.inactive}`}
    >
      {status}
    </span>
  );
}

function RiskBadge({ riskClass }: { riskClass: CapabilityInventoryRow["riskClass"] }) {
  if (!riskClass) return <span className="text-muted-foreground text-xs">—</span>;
  const styles: Record<string, string> = {
    critical: "text-red-600 dark:text-red-400",
    elevated: "text-yellow-600 dark:text-yellow-400",
    standard: "text-green-600 dark:text-green-400",
  };
  return (
    <span className={`text-xs font-medium ${styles[riskClass] ?? ""}`}>{riskClass}</span>
  );
}

function AuditBadge({ auditClass }: { auditClass: CapabilityInventoryRow["auditClass"] }) {
  if (!auditClass) return <span className="text-muted-foreground text-xs">—</span>;
  const labels: Record<string, string> = {
    ledger: "Ledger",
    journal: "Journal",
    metrics_only: "Metrics",
  };
  return <span className="text-xs text-[var(--dpf-muted)]">{labels[auditClass] ?? auditClass}</span>;
}

function SourceBadge({ sourceType }: { sourceType: CapabilitySourceType }) {
  const styles: Record<string, string> = {
    internal: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    external_mcp: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    provider_native: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  };
  const labels: Record<string, string> = {
    internal: "Internal",
    external_mcp: "MCP",
    provider_native: "Provider",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[sourceType] ?? ""}`}
    >
      {labels[sourceType] ?? sourceType}
    </span>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  sourceType: CapabilitySourceType | "all";
  onSourceType: (v: CapabilitySourceType | "all") => void;
  enabledFilter: "all" | "enabled" | "disabled";
  onEnabledFilter: (v: "all" | "enabled" | "disabled") => void;
}

function FilterBar({
  search,
  onSearch,
  sourceType,
  onSourceType,
  enabledFilter,
  onEnabledFilter,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Search */}
      <input
        type="search"
        placeholder="Search capabilities..."
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        className="px-3 py-1.5 text-sm rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] w-56 focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
      />

      {/* Source type dropdown */}
      <select
        value={sourceType}
        onChange={(e) => onSourceType(e.target.value as CapabilitySourceType | "all")}
        className="px-3 py-1.5 text-sm rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] text-[var(--dpf-text)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
      >
        <option value="all">All sources</option>
        <option value="internal">Internal</option>
        <option value="external_mcp">MCP</option>
        <option value="provider_native">Provider</option>
      </select>

      {/* Enabled toggle */}
      <select
        value={enabledFilter}
        onChange={(e) => onEnabledFilter(e.target.value as "all" | "enabled" | "disabled")}
        className="px-3 py-1.5 text-sm rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface)] text-[var(--dpf-text)] focus:outline-none focus:ring-1 focus:ring-[var(--dpf-accent)]"
      >
        <option value="all">All</option>
        <option value="enabled">Enabled</option>
        <option value="disabled">Disabled</option>
      </select>
    </div>
  );
}

// ─── Row component ────────────────────────────────────────────────────────────

function CapabilityRow({ row }: { row: CapabilityInventoryRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-[var(--dpf-border)] hover:bg-[var(--dpf-hover)] cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Name + capabilityId */}
        <td className="px-4 py-3">
          <div className="font-medium text-sm text-[var(--dpf-text)]">{row.displayName}</div>
          <div className="text-xs text-[var(--dpf-muted)] mt-0.5 font-mono">{row.capabilityId}</div>
        </td>

        {/* Source */}
        <td className="px-4 py-3">
          <SourceBadge sourceType={row.sourceType} />
        </td>

        {/* Integration */}
        <td className="px-4 py-3 text-xs text-[var(--dpf-muted)]">
          {row.integrationId ?? "—"}
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <StatusBadge status={row.availabilityStatus} />
        </td>

        {/* Risk */}
        <td className="px-4 py-3">
          <RiskBadge riskClass={row.riskClass} />
        </td>

        {/* Audit class */}
        <td className="px-4 py-3">
          <AuditBadge auditClass={row.auditClass} />
        </td>

        {/* Side effects */}
        <td className="px-4 py-3 text-xs text-[var(--dpf-muted)]">
          {row.sideEffect === true ? (
            <span className="text-yellow-600 dark:text-yellow-400 font-medium">Yes</span>
          ) : row.sideEffect === false ? (
            <span>No</span>
          ) : (
            <span>—</span>
          )}
        </td>

        {/* Expand chevron */}
        <td className="px-4 py-3 text-right text-[var(--dpf-muted)]">
          <span className="text-xs select-none">{expanded ? "▲" : "▼"}</span>
        </td>
      </tr>

      {/* Expanded manifest row */}
      {expanded && (
        <tr className="bg-[var(--dpf-surface-alt,var(--dpf-surface))]">
          <td colSpan={8} className="px-6 py-4">
            <div className="space-y-2">
              {row.description && (
                <p className="text-sm text-[var(--dpf-muted)]">{row.description}</p>
              )}
              {row.buildPhases && row.buildPhases.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  <span className="text-xs text-[var(--dpf-muted)]">Build phases:</span>
                  {row.buildPhases.map((p) => (
                    <span
                      key={p}
                      className="text-xs px-1.5 py-0.5 rounded bg-[var(--dpf-border)] text-[var(--dpf-text)]"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {row.integrationDependencies.length > 0 && (
                <div className="text-xs text-[var(--dpf-muted)]">
                  Integration dependencies: {row.integrationDependencies.join(", ")}
                </div>
              )}
              {row.manifest && (
                <details>
                  <summary className="text-xs cursor-pointer text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
                    Raw manifest
                  </summary>
                  <pre className="mt-2 text-xs bg-[var(--dpf-code-bg,#1e1e1e)] text-[var(--dpf-code-text,#d4d4d4)] p-3 rounded overflow-auto max-h-64">
                    {JSON.stringify(row.manifest, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

interface Props {
  capabilities: CapabilityInventoryRow[];
}

export function CapabilityInventoryClient({ capabilities }: Props) {
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<CapabilitySourceType | "all">("all");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");

  // Client-side filtering (data already fetched server-side)
  const filtered = capabilities.filter((row) => {
    if (sourceType !== "all" && row.sourceType !== sourceType) return false;
    if (enabledFilter === "enabled" && !row.enabled) return false;
    if (enabledFilter === "disabled" && row.enabled) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !row.displayName.toLowerCase().includes(q) &&
        !(row.description ?? "").toLowerCase().includes(q) &&
        !row.capabilityId.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <FilterBar
        search={search}
        onSearch={setSearch}
        sourceType={sourceType}
        onSourceType={setSourceType}
        enabledFilter={enabledFilter}
        onEnabledFilter={setEnabledFilter}
      />

      <div className="text-xs text-[var(--dpf-muted)]">
        Showing {filtered.length} of {capabilities.length} capabilities
      </div>

      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-[var(--dpf-surface)] border-b border-[var(--dpf-border)]">
            <tr>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Name
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Source
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Integration
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Status
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Risk
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Audit Class
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wide">
                Side Effects
              </th>
              <th className="px-4 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-12 text-center text-sm text-[var(--dpf-muted)]"
                >
                  No capabilities match your filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => <CapabilityRow key={row.capabilityId} row={row} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

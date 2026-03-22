"use client";

import { useState, useEffect, useTransition, useCallback } from "react";
import { RFCDetailPanel } from "./RFCDetailPanel";
import { StandardChangeCatalog } from "./StandardChangeCatalog";

// ─── Types ──────────────────────────────────────────────────────────────────

type ChangeItem = {
  id: string;
  itemType: string;
  title: string;
  status: string;
};

type RFC = {
  id: string;
  rfcId: string;
  title: string;
  description: string;
  type: string;
  scope: string;
  riskLevel: string;
  status: string;
  createdAt: string;
  submittedAt: string | null;
  assessedAt: string | null;
  approvedAt: string | null;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  impactReport: Record<string, unknown> | null;
  outcome: string | null;
  outcomeNotes: string | null;
  requestedBy: { id: string; displayName?: string } | null;
  assessedBy: { id: string; displayName?: string } | null;
  approvedBy: { id: string; displayName?: string } | null;
  executedBy: { id: string; displayName?: string } | null;
  changeItems: ChangeItem[];
};

// ─── Status / Risk / Type Colour Maps ───────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--dpf-muted-foreground)",
  submitted: "var(--dpf-warning)",
  assessed: "var(--dpf-info)",
  approved: "var(--dpf-success)",
  scheduled: "var(--dpf-accent)",
  "in-progress": "var(--dpf-warning)",
  completed: "var(--dpf-success)",
  "rolled-back": "var(--dpf-destructive)",
  rejected: "var(--dpf-destructive)",
  cancelled: "var(--dpf-muted-foreground)",
  closed: "var(--dpf-muted-foreground)",
};

const RISK_COLORS: Record<string, string> = {
  low: "var(--dpf-success)",
  medium: "var(--dpf-warning)",
  high: "var(--dpf-destructive)",
  critical: "var(--dpf-destructive)",
};

const TYPE_BADGES: Record<string, string> = {
  standard: "STD",
  normal: "NRM",
  emergency: "EMG",
};

// ─── Filter Groups ──────────────────────────────────────────────────────────

type FilterGroup = "active" | "completed" | "history" | "catalog";

const ACTIVE_STATUSES = new Set([
  "draft",
  "submitted",
  "assessed",
  "approved",
  "scheduled",
  "in-progress",
]);
const COMPLETED_STATUSES = new Set(["completed"]);
function filterGroup(status: string): FilterGroup {
  if (ACTIVE_STATUSES.has(status)) return "active";
  if (COMPLETED_STATUSES.has(status)) return "completed";
  return "history";
}

// ─── Badge component ────────────────────────────────────────────────────────

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs border font-medium"
      style={{
        color,
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ChangesClient() {
  const [rfcs, setRfcs] = useState<RFC[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterGroup>("active");
  const [selectedRfcId, setSelectedRfcId] = useState<string | null>(null);
  const [selectedRfc, setSelectedRfc] = useState<RFC | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch list
  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/ops/changes");
      if (!res.ok) throw new Error(`Failed to fetch changes: ${res.status}`);
      const json = await res.json();
      setRfcs(json.data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load changes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // Fetch detail when selected
  useEffect(() => {
    if (!selectedRfcId) {
      setSelectedRfc(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/ops/changes/${selectedRfcId}`);
        if (!res.ok) throw new Error(`Failed to fetch RFC: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setSelectedRfc(json.data ?? json);
      } catch {
        if (!cancelled) setSelectedRfc(null);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRfcId]);

  // Refresh after action
  function handleActionComplete() {
    startTransition(async () => {
      await fetchList();
      if (selectedRfcId) {
        try {
          const res = await fetch(`/api/v1/ops/changes/${selectedRfcId}`);
          if (res.ok) {
            const json = await res.json();
            setSelectedRfc(json.data ?? json);
          }
        } catch {
          // ignore — list was already refreshed
        }
      }
    });
  }

  // Filter and count
  const filtered = rfcs.filter((r) => filterGroup(r.status) === filter);
  const counts: Record<FilterGroup, number> = {
    active: rfcs.filter((r) => filterGroup(r.status) === "active").length,
    completed: rfcs.filter((r) => filterGroup(r.status) === "completed").length,
    history: rfcs.filter((r) => filterGroup(r.status) === "history").length,
    catalog: rfcs.filter((r) => filterGroup(r.status) === "catalog").length,
  };

  if (loading) {
    return (
      <div className="text-center py-12 text-[var(--dpf-muted)]">Loading changes...</div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-[var(--dpf-destructive)]">{error}</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2">
        {(["active", "completed", "history"] as const).map((group) => (
          <button
            key={group}
            onClick={() => { setFilter(group); setSelectedRfcId(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === group
                ? "bg-[var(--dpf-accent)]/20 text-[var(--dpf-accent)] border-[var(--dpf-accent)]/40"
                : "bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] border-[var(--dpf-border)] hover:text-[var(--dpf-text)]"
            }`}
          >
            {group.charAt(0).toUpperCase() + group.slice(1)} ({counts[group]})
          </button>
        ))}
        <button
          onClick={() => { setFilter("catalog"); setSelectedRfcId(null); }}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            filter === "catalog"
              ? "bg-[var(--dpf-accent)]/20 text-[var(--dpf-accent)] border-[var(--dpf-accent)]/40"
              : "bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] border-[var(--dpf-border)] hover:text-[var(--dpf-text)]"
          }`}
        >
          Catalog
        </button>
      </div>

      {/* Catalog view */}
      {filter === "catalog" && (
        <StandardChangeCatalog
          onRFCCreated={() => {
            setFilter("active");
            fetchList();
          }}
        />
      )}

      {/* RFC list */}
      {filter !== "catalog" && filtered.length === 0 && (
        <div className="text-center py-12 text-[var(--dpf-muted)]">
          No changes with status &quot;{filter}&quot;.
        </div>
      )}
      {filter !== "catalog" && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((rfc) => (
            <div key={rfc.id}>
              <button
                type="button"
                onClick={() =>
                  setSelectedRfcId(selectedRfcId === rfc.rfcId ? null : rfc.rfcId)
                }
                className={`w-full text-left p-4 rounded-lg border transition-colors ${
                  selectedRfcId === rfc.rfcId
                    ? "bg-[var(--dpf-surface-2)] border-[var(--dpf-accent)]/40"
                    : "bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] hover:border-[var(--dpf-accent)]/30"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-[var(--dpf-accent)]">
                        {rfc.rfcId}
                      </span>
                      <span className="font-semibold text-[var(--dpf-text)] truncate">
                        {rfc.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <Badge
                        label={TYPE_BADGES[rfc.type] ?? rfc.type.toUpperCase()}
                        color={rfc.type === "emergency" ? "var(--dpf-destructive)" : "var(--dpf-muted-foreground)"}
                      />
                      <Badge
                        label={rfc.riskLevel}
                        color={RISK_COLORS[rfc.riskLevel] ?? "var(--dpf-muted-foreground)"}
                      />
                      <Badge
                        label={rfc.status}
                        color={STATUS_COLORS[rfc.status] ?? "var(--dpf-muted-foreground)"}
                      />
                    </div>
                    <div className="text-xs text-[var(--dpf-muted)] mt-1.5 space-x-3">
                      <span>
                        {new Date(rfc.createdAt).toLocaleDateString()}
                      </span>
                      {rfc.changeItems?.length > 0 && (
                        <span>
                          {rfc.changeItems.length} item{rfc.changeItems.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Inline detail panel */}
              {selectedRfcId === rfc.rfcId && selectedRfc && (
                <div className="mt-1">
                  <RFCDetailPanel
                    rfc={selectedRfc}
                    isPending={isPending}
                    onActionComplete={handleActionComplete}
                    onClose={() => setSelectedRfcId(null)}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

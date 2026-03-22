"use client";

import { useState, useEffect, useCallback, useTransition } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

type TemplateItem = {
  itemType: string;
  title: string;
  description?: string;
  rollbackPlan?: string;
};

type CatalogEntry = {
  id: string;
  catalogKey: string;
  title: string;
  description: string;
  category: string;
  preAssessedRisk: string;
  templateItems: TemplateItem[];
  approvalPolicy: string;
  validFrom: string;
  validUntil: string | null;
  approvedBy: {
    id: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
  } | null;
};

const RISK_COLORS: Record<string, string> = {
  low: "var(--dpf-success)",
  medium: "var(--dpf-warning)",
};

const CATEGORY_LABELS: Record<string, string> = {
  infrastructure: "Infrastructure",
  configuration: "Configuration",
  maintenance: "Maintenance",
};

// ─── Badge ──────────────────────────────────────────────────────────────────

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

export function StandardChangeCatalog({
  onRFCCreated,
}: {
  onRFCCreated?: () => void;
}) {
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [creatingFromKey, setCreatingFromKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/ops/catalog");
      if (!res.ok) throw new Error(`Failed to fetch catalog: ${res.status}`);
      const json = await res.json();
      setEntries(json.data ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load catalog");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function handleCreateRFC(catalogKey: string) {
    setCreatingFromKey(catalogKey);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/v1/ops/catalog/${catalogKey}/create-rfc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          console.error("Create RFC from catalog failed:", err);
          setError(err?.message ?? "Failed to create RFC");
        } else {
          onRFCCreated?.();
        }
      } catch (e) {
        console.error("Create RFC error:", e);
        setError("Failed to create RFC from template");
      } finally {
        setCreatingFromKey(null);
      }
    });
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-[var(--dpf-muted)]">
        Loading catalog...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-[var(--dpf-destructive)]">
        {error}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--dpf-muted)]">
        <p>No standard change templates defined yet.</p>
        <p className="text-xs mt-1">
          Create templates via the API to enable one-click RFC creation for routine changes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const expanded = expandedKey === entry.catalogKey;
        const creating = creatingFromKey === entry.catalogKey;
        const approverName = entry.approvedBy?.displayName
          ?? (entry.approvedBy
            ? `${entry.approvedBy.firstName ?? ""} ${entry.approvedBy.lastName ?? ""}`.trim()
            : "Unknown");

        return (
          <div key={entry.id}>
            <button
              type="button"
              onClick={() =>
                setExpandedKey(expanded ? null : entry.catalogKey)
              }
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                expanded
                  ? "bg-[var(--dpf-surface-2)] border-[var(--dpf-accent)]/40"
                  : "bg-[var(--dpf-surface-1)] border-[var(--dpf-border)] hover:border-[var(--dpf-accent)]/30"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-[var(--dpf-accent)]">
                      {entry.catalogKey}
                    </span>
                    <span className="font-semibold text-[var(--dpf-text)] truncate">
                      {entry.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge
                      label={CATEGORY_LABELS[entry.category] ?? entry.category}
                      color="var(--dpf-muted-foreground)"
                    />
                    <Badge
                      label={entry.preAssessedRisk}
                      color={RISK_COLORS[entry.preAssessedRisk] ?? "var(--dpf-muted-foreground)"}
                    />
                    <Badge
                      label={entry.approvalPolicy === "auto" ? "Auto-approve" : "Delegated"}
                      color="var(--dpf-info)"
                    />
                  </div>
                  <p className="text-xs text-[var(--dpf-muted)] mt-1.5 line-clamp-2">
                    {entry.description}
                  </p>
                </div>
              </div>
            </button>

            {/* Expanded detail */}
            {expanded && (
              <div className="mt-1 p-4 rounded-lg bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]">
                {/* Template items */}
                <h4 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                  Template Items ({entry.templateItems.length})
                </h4>
                <div className="flex flex-col gap-1.5 mb-4">
                  {entry.templateItems.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs p-2 rounded bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
                    >
                      <span className="text-[var(--dpf-muted)] shrink-0 w-4 text-right">
                        {i + 1}.
                      </span>
                      <span className="text-[var(--dpf-text)] truncate">
                        {item.title}
                      </span>
                      <span className="text-[var(--dpf-muted)] shrink-0">
                        {item.itemType}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Metadata */}
                <div className="flex gap-4 flex-wrap text-xs text-[var(--dpf-muted)] mb-4">
                  <span>Approved by: {approverName}</span>
                  <span>Valid from: {new Date(entry.validFrom).toLocaleDateString()}</span>
                  {entry.validUntil && (
                    <span>Expires: {new Date(entry.validUntil).toLocaleDateString()}</span>
                  )}
                </div>

                {/* Create RFC button */}
                <button
                  onClick={() => handleCreateRFC(entry.catalogKey)}
                  disabled={isPending || creating}
                  className="px-4 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50"
                  style={{
                    color: "var(--dpf-accent)",
                    borderColor: "var(--dpf-accent)",
                    backgroundColor: "color-mix(in srgb, var(--dpf-accent) 15%, transparent)",
                  }}
                >
                  {creating ? "Creating RFC..." : "Create RFC from Template"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

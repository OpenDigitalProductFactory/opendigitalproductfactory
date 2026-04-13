"use client";

import { useState, useMemo } from "react";
import type { RouteDecisionLogRow } from "@/lib/actions/route-decision-logs";
import type { CandidateTrace } from "@/lib/routing/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: Date): string {
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (n * 100).toFixed(0) + "%";
}

function sensitivityColor(s: string): string {
  switch (s) {
    case "restricted":   return "var(--dpf-error)";
    case "confidential": return "#f97316";
    case "internal":     return "#facc15";
    default:             return "var(--dpf-success)";
  }
}

function fitnessColor(score: number | null | undefined): string {
  if (score === null || score === undefined || isNaN(score)) return "var(--dpf-muted)";
  if (score >= 0.7) return "var(--dpf-success)";
  if (score >= 0.4) return "#facc15";
  return "var(--dpf-error)";
}

// ── Candidate table ───────────────────────────────────────────────────────────

function CandidateTable({ candidates }: { candidates: CandidateTrace[] }) {
  if (!candidates.length) return <p style={{ color: "var(--dpf-muted)", fontSize: 11 }}>No candidates recorded.</p>;

  const dims = Object.keys(candidates[0]?.dimensionScores ?? {});

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--dpf-muted)", fontWeight: 500 }}>Model</th>
            <th style={{ textAlign: "right", padding: "4px 8px", color: "var(--dpf-muted)", fontWeight: 500 }}>Fitness</th>
            {dims.map((d) => (
              <th key={d} style={{ textAlign: "right", padding: "4px 8px", color: "var(--dpf-muted)", fontWeight: 500, textTransform: "capitalize" }}>
                {d}
              </th>
            ))}
            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--dpf-muted)", fontWeight: 500 }}>Exclusion</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr
              key={`${c.endpointId}::${c.modelId}`}
              style={{
                borderBottom: "1px solid #1a1a2e",
                opacity: c.excluded ? 0.5 : 1,
              }}
            >
              <td style={{ padding: "4px 8px", color: c.excluded ? "var(--dpf-muted)" : "var(--dpf-text)" }}>
                <span style={{ fontFamily: "monospace" }}>{c.modelId || c.endpointId}</span>
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: fitnessColor(c.fitnessScore), fontFamily: "monospace" }}>
                {fmtScore(c.fitnessScore)}
              </td>
              {dims.map((d) => (
                <td key={d} style={{ padding: "4px 8px", textAlign: "right", color: "#aaa", fontFamily: "monospace" }}>
                  {c.dimensionScores[d] ?? "—"}
                </td>
              ))}
              <td style={{ padding: "4px 8px", color: "var(--dpf-error)", fontSize: 10 }}>
                {c.excludedReason ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Single decision row ───────────────────────────────────────────────────────

function DecisionRow({ row }: { row: RouteDecisionLogRow }) {
  const [expanded, setExpanded] = useState(false);

  const isNone = row.selectedEndpointId === "none";
  const modelLabel = row.selectedModelId ?? row.selectedEndpointId;

  return (
    <div style={{ borderBottom: "1px solid #1a1a2e" }}>
      {/* Summary line */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "130px 120px 80px 60px 1fr 80px",
          gap: 8,
          alignItems: "center",
          padding: "10px 12px",
          textAlign: "left",
          color: "var(--dpf-text)",
        }}
      >
        {/* Time */}
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", fontFamily: "monospace" }}>
          {fmtTime(row.createdAt)}
        </span>

        {/* Task type */}
        <span style={{
          fontSize: 10,
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 4,
          padding: "2px 6px",
          color: "var(--dpf-accent)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {row.taskType}
        </span>

        {/* Sensitivity */}
        <span style={{
          fontSize: 10,
          color: sensitivityColor(row.sensitivity),
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}>
          {row.sensitivity}
        </span>

        {/* Fitness */}
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: isNone ? "var(--dpf-error)" : fitnessColor(row.fitnessScore),
          fontFamily: "monospace",
        }}>
          {isNone ? "—" : fmtScore(row.fitnessScore)}
        </span>

        {/* Selected model */}
        <span style={{
          fontSize: 11,
          color: isNone ? "var(--dpf-error)" : "var(--dpf-text)",
          fontFamily: "monospace",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {isNone ? "No route found" : modelLabel}
        </span>

        {/* Expand toggle */}
        <span style={{ fontSize: 11, color: "var(--dpf-muted)", textAlign: "right" }}>
          {row.candidateTrace.length} candidate{row.candidateTrace.length !== 1 ? "s" : ""}
          {" "}{expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Reason */}
      <div style={{ padding: "0 12px 6px", fontSize: 11, color: "var(--dpf-muted)" }}>
        {row.reason}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 12px 16px", borderTop: "1px solid #1e1e3a", marginTop: 4 }}>
          {/* Metadata row */}
          <div style={{ display: "flex", gap: 16, marginTop: 12, marginBottom: 12, fontSize: 11, color: "var(--dpf-muted)" }}>
            {row.agentMessageId && (
              <span>Message: <span style={{ color: "var(--dpf-text)", fontFamily: "monospace" }}>{row.agentMessageId.slice(0, 12)}…</span></span>
            )}
            {row.fallbackChain.length > 0 && (
              <span>Fallback chain: <span style={{ color: "#facc15", fontFamily: "monospace" }}>{row.fallbackChain.join(" → ")}</span></span>
            )}
            {row.policyRulesApplied.length > 0 && (
              <span>Policies: <span style={{ color: "#f97316" }}>{row.policyRulesApplied.join(", ")}</span></span>
            )}
            {row.shadowMode && (
              <span style={{ color: "var(--dpf-accent)" }}>Shadow mode</span>
            )}
          </div>

          {/* All candidates */}
          <div style={{ marginBottom: 4, fontSize: 11, fontWeight: 600, color: "#e2e8f0" }}>
            All candidates ({row.candidateTrace.length})
          </div>
          <CandidateTable candidates={row.candidateTrace} />

          {/* Excluded only */}
          {row.excludedTrace.length > 0 && (
            <>
              <div style={{ marginTop: 12, marginBottom: 4, fontSize: 11, fontWeight: 600, color: "var(--dpf-error)" }}>
                Excluded ({row.excludedTrace.length})
              </div>
              <CandidateTable candidates={row.excludedTrace} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

interface Props {
  rows: RouteDecisionLogRow[];
}

export function RouteDecisionLogClient({ rows }: Props) {
  const [taskFilter, setTaskFilter] = useState<string>("all");

  const taskTypes = useMemo(() => {
    const types = Array.from(new Set(rows.map((r) => r.taskType))).sort();
    return ["all", ...types];
  }, [rows]);

  const filtered = useMemo(
    () => (taskFilter === "all" ? rows : rows.filter((r) => r.taskType === taskFilter)),
    [rows, taskFilter],
  );

  if (rows.length === 0) {
    return (
      <div style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        padding: 32,
        textAlign: "center",
        color: "var(--dpf-muted)",
        fontSize: 13,
      }}>
        No routing decisions recorded yet. Decisions are logged each time the router selects an endpoint for an agent task.
      </div>
    );
  }

  return (
    <div>
      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {taskTypes.map((t) => (
          <button
            key={t}
            onClick={() => setTaskFilter(t)}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              border: "1px solid",
              cursor: "pointer",
              borderColor: taskFilter === t ? "var(--dpf-accent)" : "var(--dpf-border)",
              background: taskFilter === t ? "var(--dpf-surface-2)" : "transparent",
              color: taskFilter === t ? "var(--dpf-accent)" : "var(--dpf-muted)",
            }}
          >
            {t === "all" ? `All (${rows.length})` : t}
          </button>
        ))}
      </div>

      {/* Column header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "130px 120px 80px 60px 1fr 80px",
        gap: 8,
        padding: "6px 12px",
        fontSize: 10,
        color: "var(--dpf-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        borderBottom: "1px solid var(--dpf-border)",
      }}>
        <span>Time</span>
        <span>Task</span>
        <span>Sensitivity</span>
        <span>Score</span>
        <span>Selected Model</span>
        <span style={{ textAlign: "right" }}>Detail</span>
      </div>

      {/* Rows */}
      <div style={{ background: "var(--dpf-bg)", borderRadius: "0 0 8px 8px" }}>
        {filtered.map((row) => (
          <DecisionRow key={row.id} row={row} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--dpf-muted)", fontSize: 12 }}>
          No decisions for task type "{taskFilter}".
        </div>
      )}
    </div>
  );
}

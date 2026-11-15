"use client";

import { useState, useMemo } from "react";
import type { RouteDecisionLogRow } from "@/lib/actions/route-decision-logs";
import type { RoutingConfidenceSignal } from "@/lib/deliberation/routing-confidence";
import { useT } from "@/lib/i18n/use-t";
import {
  describeProvenance,
  describeVariability,
  type CallParameterReceipt,
} from "@/lib/routing/call-parameter-receipt";
import type { CandidateTrace } from "@/lib/routing/types";
import type { ProviderSuitabilityRouteReceipt } from "@/lib/routing/provider-suitability/evidence";

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
    <div className="max-w-full overflow-x-auto">
      <table className="min-w-[560px]" style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
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

function SuitabilityReceipt({ receipt }: { receipt: ProviderSuitabilityRouteReceipt }) {
  return (
    <div className="break-words" style={{ marginTop: 12, border: "1px solid var(--dpf-border)", borderRadius: 6, padding: 10, fontSize: 11 }}>
      <div style={{ color: "var(--dpf-text)", fontWeight: 600, marginBottom: 6 }}>Provider suitability evidence</div>
      <div style={{ color: "var(--dpf-muted)", lineHeight: 1.6 }}>
        <div>Connection: <span className="break-all" style={{ fontFamily: "monospace", color: "var(--dpf-text)" }}>{receipt.connectionRef}</span></div>
        <div>Channel/account: <span style={{ color: "var(--dpf-text)" }}>{receipt.executionChannel} · {receipt.accountClass}</span></div>
        <div>Policy/compiler: <span style={{ fontFamily: "monospace", color: "var(--dpf-text)" }}>{receipt.policyId} · {receipt.compilerVersion}</span></div>
        {receipt.selectedUnderlyingProviderId && <div>Underlying provider: <span style={{ color: "var(--dpf-text)" }}>{receipt.selectedUnderlyingProviderId}</span></div>}
        {receipt.obligations?.requiredRegion && <div>Required processing region: <span style={{ color: "var(--dpf-text)" }}>{receipt.obligations.requiredRegion}</span></div>}
        {receipt.explanationCodes.length > 0 && <div>Decision evidence: <span style={{ color: "var(--dpf-text)" }}>{receipt.explanationCodes.join(", ")}</span></div>}
      </div>
      <div style={{ marginTop: 6, color: "var(--dpf-muted)" }}>This receipt records policy facts only—never prompts, attachments, credentials, or external account IDs.</div>
    </div>
  );
}


// ── How the model was called (BI-B4081AA1) ────────────────────────────────────
//
// The routing log could say WHICH model ran and never HOW it was called. Intent
// first, numbers second, provenance last: "temperature 0.6 — the model's
// published setting for reasoning mode" reads as a documented requirement rather
// than an arbitrary choice, which is the difference that decides whether an
// operator trusts it.

/** Catalog keys for the sampling labels, so the names travel with the copy. */
const PARAMETER_KEYS = ["temperature", "topP", "topK", "minP", "repeatPenalty"] as const;
type ParameterKey = (typeof PARAMETER_KEYS)[number];

function isParameterKey(key: string): key is ParameterKey {
  return (PARAMETER_KEYS as readonly string[]).includes(key);
}

export function CallParameters({ receipt }: { receipt: CallParameterReceipt }) {
  const t = useT("routeAudit");
  const entries = Object.entries(receipt.sampling) as Array<[string, number]>;

  return (
    <div style={{ marginTop: 12, padding: 10, background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
        {t("callParameters.heading")}
      </div>

      {entries.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          {t("callParameters.providerDefaults")}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 4, fontSize: 11 }}>
          {entries.map(([key, value]) => {
            const origin = receipt.provenance[key as keyof typeof receipt.provenance];
            return (
              <div key={key} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
                <span style={{ color: "var(--dpf-muted)", minWidth: 96 }}>
                  {isParameterKey(key) ? t(`callParameters.${key}`) : key}
                </span>
                <span style={{ color: "var(--dpf-text)", fontFamily: "monospace", fontWeight: 600 }}>{value}</span>
                {key === "temperature" && (
                  <span style={{ color: "var(--dpf-muted)" }}>({describeVariability(value)})</span>
                )}
                {origin && (
                  <span style={{ color: "var(--dpf-accent)" }}>
                    — {describeProvenance(origin, receipt.mode === "thinking")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11, color: "var(--dpf-muted)" }}>
        <span>{t("callParameters.outputCeiling")} <span style={{ color: "var(--dpf-text)", fontFamily: "monospace" }}>{receipt.maxTokens}</span></span>
        {receipt.effort && (
          <span>
            {t("callParameters.reasoningLabel")}{" "}
            <span style={{ color: "var(--dpf-success)" }}>{t("callParameters.reasoningOn")}</span>
            {receipt.effort.budgetTokens !== undefined && (
              <span style={{ fontFamily: "monospace" }}>
                {" "}
                {t("callParameters.reasoningBudget", { tokens: receipt.effort.budgetTokens })}
              </span>
            )}
            <span style={{ fontFamily: "monospace" }}> · {receipt.effort.expressedAs}</span>
          </span>
        )}
        {receipt.constrainedDecoding && <span style={{ color: "var(--dpf-success)" }}>{t("callParameters.jsonConstrained")}</span>}
        {receipt.recipeId && <span>{t("callParameters.recipe")} <span style={{ fontFamily: "monospace", color: "var(--dpf-text)" }}>{receipt.recipeId.slice(0, 10)}…</span></span>}
      </div>

      {receipt.effortUnexpressed && (
        // The honest version of a silent no-op.
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--dpf-warning)" }}>
          {t("callParameters.effortUnexpressed")}
        </div>
      )}

      {receipt.dropped && receipt.dropped.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--dpf-muted)" }}>
          {t("callParameters.dropped", { names: receipt.dropped.join(", ") })}
        </div>
      )}
    </div>
  );
}

// ── How confident routing was (BI-A08285BC) ──────────────────────────────────
//
// A below-floor run used to leave only a sentence in `reason`. Showing it here
// makes it countable by eye, and the panel stays silent when routing was
// confident so it never becomes noise on a healthy decision.

export function RoutingConfidence({ signal }: { signal: RoutingConfidenceSignal }) {
  const t = useT("routeAudit");
  const belowFloor = signal.qualityFloorRelaxed === true;
  const noChoice = typeof signal.candidateCount === "number" && signal.candidateCount <= 1;
  if (!belowFloor && !noChoice && !signal.fallbackUsed) return null;

  return (
    <div style={{ marginTop: 12, padding: 10, background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-warning)", borderRadius: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-warning)", marginBottom: 4 }}>
        {t("lowConfidence.heading")}
      </div>
      <div style={{ fontSize: 11, color: "var(--dpf-muted)", display: "grid", gap: 2 }}>
        {belowFloor && <div>{t("lowConfidence.belowFloor")}</div>}
        {noChoice && <div>{t("lowConfidence.noChoice")}</div>}
        {signal.fallbackUsed && <div>{t("lowConfidence.fallback")}</div>}
      </div>
    </div>
  );
}

// ── Single decision row ───────────────────────────────────────────────────────

function DecisionRow({ row }: { row: RouteDecisionLogRow }) {
  const [expanded, setExpanded] = useState(false);

  const isNone = row.selectedEndpointId === "none";
  const modelLabel = row.selectedModelId ?? row.selectedEndpointId;

  return (
    <div className="min-w-0 max-w-full overflow-hidden" style={{ borderBottom: "1px solid #1a1a2e" }}>
      {/* Summary line */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[130px_120px_80px_60px_minmax(0,1fr)_80px]"
        style={{
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 12, marginBottom: 12, fontSize: 11, color: "var(--dpf-muted)" }}>
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
          {row.routingConfidence && <RoutingConfidence signal={row.routingConfidence} />}
          {row.callParameters && <CallParameters receipt={row.callParameters} />}
          {row.suitabilityReceipt && <SuitabilityReceipt receipt={row.suitabilityReceipt} />}
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
      <div className="hidden sm:grid sm:grid-cols-[130px_120px_80px_60px_minmax(0,1fr)_80px]" style={{
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
      <div className="min-w-0 max-w-full" style={{ background: "var(--dpf-bg)", borderRadius: "0 0 8px 8px" }}>
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

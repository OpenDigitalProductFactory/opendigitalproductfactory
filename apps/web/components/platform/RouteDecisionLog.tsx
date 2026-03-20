"use client";

import { useState } from "react";

type RouteDecision = {
  id: string;
  taskType: string;
  selectedEndpointId: string;
  sensitivity: string;
  reason: string;
  fitnessScore: number;
  policyRulesApplied: string[];
  shadowMode: boolean;
  createdAt: string;
};

type Props = {
  decisions: RouteDecision[];
};

const TASK_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  chat:             { bg: "rgba(124,140,248,0.12)", text: "#7c8cf8", border: "rgba(124,140,248,0.3)" },
  codegen:          { bg: "rgba(74,222,128,0.10)",  text: "#4ade80", border: "rgba(74,222,128,0.3)" },
  reasoning:        { bg: "rgba(251,191,36,0.10)",  text: "#fbbf24", border: "rgba(251,191,36,0.3)" },
  tool_use:         { bg: "rgba(56,189,248,0.10)",  text: "#38bdf8", border: "rgba(56,189,248,0.3)" },
  structured_output:{ bg: "rgba(232,121,249,0.10)", text: "#e879f9", border: "rgba(232,121,249,0.3)" },
};

const SENSITIVITY_COLORS: Record<string, string> = {
  public:       "#4ade80",
  internal:     "#7c8cf8",
  confidential: "#fbbf24",
  restricted:   "#ef4444",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) !== 1 ? "s" : ""} ago`;
}

function fitnessColor(score: number): string {
  if (score >= 0.8) return "#4ade80";
  if (score >= 0.5) return "#fbbf24";
  return "#ef4444";
}

function DecisionCard({ decision }: { decision: RouteDecision }) {
  const [expanded, setExpanded] = useState(false);

  const taskColor = TASK_TYPE_COLORS[decision.taskType] ?? {
    bg: "rgba(136,136,160,0.10)",
    text: "#8888a0",
    border: "rgba(136,136,160,0.3)",
  };
  const sensitivityColor = SENSITIVITY_COLORS[decision.sensitivity] ?? "#8888a0";
  const score = decision.fitnessScore;
  const truncatedReason = decision.reason.length > 200
    ? decision.reason.slice(0, 200) + "…"
    : decision.reason;
  const needsExpand = decision.reason.length > 200;

  return (
    <div style={{
      background: "#161625",
      border: "1px solid #2a2a40",
      borderRadius: 6,
      padding: "12px 14px",
      marginBottom: 8,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {/* Task type badge */}
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 4,
          background: taskColor.bg,
          color: taskColor.text,
          border: `1px solid ${taskColor.border}`,
          textTransform: "capitalize",
        }}>
          {decision.taskType}
        </span>

        {/* Endpoint */}
        <span style={{ fontSize: 12, color: "#e0e0ff", fontFamily: "monospace" }}>
          {decision.selectedEndpointId}
        </span>

        {/* Sensitivity */}
        <span style={{ fontSize: 11, color: sensitivityColor, textTransform: "capitalize", marginLeft: 4 }}>
          {decision.sensitivity}
        </span>

        {/* Fitness score */}
        <span style={{
          marginLeft: "auto",
          fontSize: 12,
          fontFamily: "monospace",
          fontWeight: 600,
          color: fitnessColor(score),
        }}>
          {(score * 100).toFixed(0)}%
        </span>

        {/* Shadow mode badge */}
        {decision.shadowMode && (
          <span style={{
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: 4,
            background: "rgba(251,191,36,0.10)",
            color: "#fbbf24",
            border: "1px solid rgba(251,191,36,0.3)",
          }}>
            shadow
          </span>
        )}

        {/* Time */}
        <span style={{ fontSize: 11, color: "#8888a0", flexShrink: 0 }}>
          {relativeTime(decision.createdAt)}
        </span>
      </div>

      {/* Reason */}
      <div style={{ fontSize: 12, color: "#b0b0c8", lineHeight: 1.5 }}>
        {expanded ? decision.reason : truncatedReason}
        {needsExpand && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              marginLeft: 6,
              fontSize: 11,
              color: "#7c8cf8",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {expanded ? "collapse" : "expand"}
          </button>
        )}
      </div>

      {/* Policy rules */}
      {decision.policyRulesApplied.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {decision.policyRulesApplied.map((rule) => (
            <span key={rule} style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 4,
              background: "#0d0d1a",
              color: "#8888a0",
              border: "1px solid #2a2a40",
            }}>
              {rule}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RouteDecisionLog({ decisions }: Props) {
  return (
    <div style={{
      marginTop: 24,
      background: "#1a1a2e",
      border: "1px solid #2a2a40",
      borderRadius: 8,
      padding: 20,
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: 0 }}>
          Route Decision Log
        </h2>
        <p style={{ fontSize: 12, color: "#b0b0c8", marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>
          Every time the platform selects an AI endpoint for a task, the decision
          is logged here with the full reasoning. This audit trail shows what was
          selected, why, and what alternatives were considered.
        </p>
      </div>

      {decisions.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "32px 0",
          color: "#8888a0",
          fontSize: 12,
        }}>
          No routing decisions recorded for this endpoint yet.
        </div>
      ) : (
        <div>
          {decisions.map((d) => (
            <DecisionCard key={d.id} decision={d} />
          ))}
        </div>
      )}
    </div>
  );
}

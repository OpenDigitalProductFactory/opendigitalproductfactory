"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerDimensionEval } from "@/lib/actions/endpoint-performance";

type Props = {
  endpointId: string;
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  profileSource: string;
  profileConfidence: string;
  evalCount: number;
  lastEvalAt: string | null;
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
};

const DIMENSIONS: Array<{ key: keyof Props & string; label: string }> = [
  { key: "reasoning",           label: "Reasoning" },
  { key: "codegen",             label: "Code Generation" },
  { key: "toolFidelity",        label: "Tool Fidelity" },
  { key: "instructionFollowing", label: "Instruction Following" },
  { key: "structuredOutput",    label: "Structured Output" },
  { key: "conversational",      label: "Conversational" },
  { key: "contextRetention",    label: "Context Retention" },
];

const CONFIDENCE_COLORS: Record<string, string> = {
  low:    "#fbbf24",
  medium: "#7c8cf8",
  high:   "#4ade80",
};

const SOURCE_LABELS: Record<string, string> = {
  seed:       "Seed data",
  evaluated:  "Evaluated",
  production: "Production observations",
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 50) return "#fbbf24";
  return "#ef4444";
}

function DimensionBar({ label, score }: { label: string; score: number }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <div style={{ width: 160, fontSize: 12, color: "#8888a0", flexShrink: 0 }}>{label}</div>
      <div style={{
        flex: 1,
        height: 8,
        borderRadius: 4,
        background: "#0d0d1a",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          borderRadius: 4,
          background: color,
          width: `${score}%`,
          transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{ width: 36, fontSize: 12, fontFamily: "monospace", color, textAlign: "right", flexShrink: 0 }}>
        {score}
      </div>
    </div>
  );
}

export default function RoutingProfilePanel(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const confidenceColor = CONFIDENCE_COLORS[props.profileConfidence] ?? "#8888a0";
  const sourceLabel = SOURCE_LABELS[props.profileSource] ?? props.profileSource;

  // Drift detection: flag any dimension below 40 as a concern worth highlighting
  const lowDimensions = DIMENSIONS.filter((d) => (props[d.key as keyof Props] as number) < 40);

  function handleRunEval() {
    setMessage(null);
    startTransition(async () => {
      try {
        await triggerDimensionEval(props.endpointId);
        setMessage("Evaluation triggered. Refresh in a moment to see updated scores.");
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to trigger evaluation.");
      }
    });
  }

  return (
    <div style={{
      marginTop: 24,
      background: "#1a1a2e",
      border: "1px solid #2a2a40",
      borderRadius: 8,
      padding: 20,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: 0 }}>Routing Profile</h2>
          <p style={{ fontSize: 12, color: "#b0b0c8", marginTop: 6, lineHeight: 1.5, maxWidth: 560 }}>
            These scores determine how the platform selects this endpoint for tasks.
            Higher scores mean this endpoint is more likely to be chosen for tasks
            requiring that capability. Scores are set initially from seed data and
            refined by evaluations and production observations.
          </p>
        </div>
        <button
          onClick={handleRunEval}
          disabled={isPending}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid #7c8cf8",
            background: isPending ? "#2a2a40" : "rgba(124,140,248,0.15)",
            color: isPending ? "#8888a0" : "#7c8cf8",
            cursor: isPending ? "not-allowed" : "pointer",
            flexShrink: 0,
          }}
        >
          {isPending ? "Running..." : "Run Evaluation"}
        </button>
      </div>

      {/* Drift warning */}
      {lowDimensions.length > 0 && (
        <div style={{
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.3)",
          borderRadius: 6,
          padding: "10px 14px",
          marginBottom: 16,
          fontSize: 12,
          color: "#fbbf24",
          lineHeight: 1.5,
        }}>
          Low-confidence dimensions: {lowDimensions.map((d) => d.label).join(", ")}.
          Consider running an evaluation to refresh these scores.
        </div>
      )}

      {/* Dimension bars */}
      <div style={{ marginBottom: 16 }}>
        {DIMENSIONS.map((d) => (
          <DimensionBar
            key={d.key}
            label={d.label}
            score={props[d.key as keyof Props] as number}
          />
        ))}
      </div>

      {/* Meta row */}
      <div style={{
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
        paddingTop: 14,
        borderTop: "1px solid #2a2a40",
        fontSize: 12,
      }}>
        <div>
          <span style={{ color: "#8888a0" }}>Confidence</span>{" "}
          <span style={{
            fontWeight: 600,
            color: confidenceColor,
            textTransform: "capitalize",
          }}>{props.profileConfidence}</span>
        </div>
        <div>
          <span style={{ color: "#8888a0" }}>Source</span>{" "}
          <span style={{ color: "#e0e0ff" }}>{sourceLabel}</span>
        </div>
        <div>
          <span style={{ color: "#8888a0" }}>Evaluations run</span>{" "}
          <span style={{ color: "#e0e0ff" }}>{props.evalCount}</span>
        </div>
        {props.lastEvalAt && (
          <div>
            <span style={{ color: "#8888a0" }}>Last evaluated</span>{" "}
            <span style={{ color: "#e0e0ff" }}>
              {new Date(props.lastEvalAt).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>

      {/* Capability flags */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <CapabilityBadge label="Tool Use"          active={props.supportsToolUse} />
        <CapabilityBadge label="Structured Output" active={props.supportsStructuredOutput} />
        <CapabilityBadge label="Streaming"         active={props.supportsStreaming} />
        {props.maxContextTokens !== null && props.maxContextTokens !== undefined && (
          <span style={{ fontSize: 11, padding: "2px 10px", borderRadius: 4, background: "#161625", color: "#b0b0c8", border: "1px solid #2a2a40" }}>
            {(props.maxContextTokens / 1000).toFixed(0)}k ctx
          </span>
        )}
      </div>

      {/* Feedback message */}
      {message && (
        <div style={{
          marginTop: 14,
          fontSize: 12,
          color: message.startsWith("Failed") ? "#ef4444" : "#4ade80",
          padding: "8px 12px",
          background: "#161625",
          borderRadius: 6,
        }}>
          {message}
        </div>
      )}
    </div>
  );
}

function CapabilityBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span style={{
      fontSize: 11,
      padding: "2px 10px",
      borderRadius: 4,
      border: `1px solid ${active ? "rgba(74,222,128,0.3)" : "#2a2a40"}`,
      background: active ? "rgba(74,222,128,0.08)" : "#161625",
      color: active ? "#4ade80" : "#8888a0",
    }}>
      {label}
    </span>
  );
}

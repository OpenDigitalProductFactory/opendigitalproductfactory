"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerDimensionEval } from "@/lib/actions/endpoint-performance";

type ModelProfile = {
  modelId: string;
  friendlyName: string;
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowingScore: number;
  structuredOutputScore: number;
  conversational: number;
  contextRetention: number;
  profileSource: string;
  profileConfidence: string;
  evalCount: number;
  lastEvalAt: string | null;
  maxContextTokens: number | null;
  supportsToolUse: boolean;
  modelStatus: string;
  retiredAt: string | null;
};

type Props = {
  endpointId: string;
  profiles: ModelProfile[];
};

const DIMENSIONS: Array<{ key: keyof ModelProfile; label: string }> = [
  { key: "reasoning",               label: "Reasoning" },
  { key: "codegen",                 label: "Code Gen" },
  { key: "toolFidelity",            label: "Tool Fidelity" },
  { key: "instructionFollowingScore", label: "Instruction Following" },
  { key: "structuredOutputScore",   label: "Structured Output" },
  { key: "conversational",          label: "Conversational" },
  { key: "contextRetention",        label: "Context Retention" },
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

const STATUS_COLORS: Record<string, string> = {
  active:   "#4ade80",
  degraded: "#fbbf24",
  retired:  "#8888a0",
};

function scoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 50) return "#fbbf24";
  return "#ef4444";
}

function DimensionBar({ label, score }: { label: string; score: number }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <div style={{ width: 130, fontSize: 11, color: "#8888a0", flexShrink: 0 }}>{label}</div>
      <div style={{
        flex: 1,
        height: 6,
        borderRadius: 3,
        background: "#0d0d1a",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          borderRadius: 3,
          background: color,
          width: `${score}%`,
          transition: "width 0.3s ease",
        }} />
      </div>
      <div style={{ width: 28, fontSize: 11, fontFamily: "monospace", color, textAlign: "right", flexShrink: 0 }}>
        {score}
      </div>
    </div>
  );
}

function ModelCard({ profile, endpointId }: { profile: ModelProfile; endpointId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const isRetired = profile.modelStatus === "retired";
  const confidenceColor = CONFIDENCE_COLORS[profile.profileConfidence] ?? "#8888a0";
  const statusColor = STATUS_COLORS[profile.modelStatus] ?? "#8888a0";
  const sourceLabel = SOURCE_LABELS[profile.profileSource] ?? profile.profileSource;

  function handleRunEval() {
    setMessage(null);
    startTransition(async () => {
      try {
        await triggerDimensionEval(endpointId, profile.modelId);
        setMessage("Evaluation triggered.");
        router.refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to trigger evaluation.");
      }
    });
  }

  return (
    <div style={{
      background: isRetired ? "#13131f" : "#161625",
      border: "1px solid #2a2a40",
      borderRadius: 6,
      padding: 14,
      opacity: isRetired ? 0.6 : 1,
    }}>
      {/* Model header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: isRetired ? "#8888a0" : "#e0e0ff", marginBottom: 2 }}>
            {profile.friendlyName || profile.modelId}
          </div>
          {profile.friendlyName && (
            <div style={{ fontSize: 11, color: "#8888a0", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {profile.modelId}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, marginLeft: 10 }}>
          {/* Status badge */}
          <span style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${statusColor}44`,
            background: `${statusColor}11`,
            color: statusColor,
            textTransform: "capitalize",
          }}>
            {profile.modelStatus}
          </span>

          {/* Confidence badge */}
          <span style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${confidenceColor}44`,
            background: `${confidenceColor}11`,
            color: confidenceColor,
            textTransform: "capitalize",
          }}>
            {profile.profileConfidence} confidence
          </span>

          {/* Run Eval button */}
          {!isRetired && (
            <button
              onClick={handleRunEval}
              disabled={isPending}
              style={{
                padding: "3px 10px",
                fontSize: 11,
                borderRadius: 4,
                border: "1px solid #7c8cf8",
                background: isPending ? "#2a2a40" : "rgba(124,140,248,0.12)",
                color: isPending ? "#8888a0" : "#7c8cf8",
                cursor: isPending ? "not-allowed" : "pointer",
              }}
            >
              {isPending ? "Running..." : "Run Eval"}
            </button>
          )}
        </div>
      </div>

      {/* Dimension bars */}
      <div style={{ marginBottom: 10 }}>
        {DIMENSIONS.map((d) => (
          <DimensionBar
            key={d.key}
            label={d.label}
            score={profile[d.key] as number}
          />
        ))}
      </div>

      {/* Meta row */}
      <div style={{
        display: "flex",
        gap: 16,
        flexWrap: "wrap",
        paddingTop: 10,
        borderTop: "1px solid #2a2a40",
        fontSize: 11,
        color: "#8888a0",
      }}>
        <span>Source: <span style={{ color: "#b0b0c8" }}>{sourceLabel}</span></span>
        <span>Evals: <span style={{ color: "#b0b0c8" }}>{profile.evalCount}</span></span>
        {profile.lastEvalAt && (
          <span>Last eval: <span style={{ color: "#b0b0c8" }}>{new Date(profile.lastEvalAt).toLocaleDateString()}</span></span>
        )}
        {profile.supportsToolUse && (
          <span style={{ color: "#4ade80" }}>Tool use</span>
        )}
        {profile.maxContextTokens !== null && profile.maxContextTokens !== undefined && (
          <span>{(profile.maxContextTokens / 1000).toFixed(0)}k ctx</span>
        )}
        {isRetired && profile.retiredAt && (
          <span>Retired: <span style={{ color: "#b0b0c8" }}>{new Date(profile.retiredAt).toLocaleDateString()}</span></span>
        )}
      </div>

      {/* Feedback message */}
      {message && (
        <div style={{
          marginTop: 8,
          fontSize: 11,
          color: message.startsWith("Failed") ? "#ef4444" : "#4ade80",
          padding: "6px 10px",
          background: "#0d0d1a",
          borderRadius: 4,
        }}>
          {message}
        </div>
      )}
    </div>
  );
}

export default function RoutingProfilePanel({ endpointId, profiles }: Props) {
  const activeProfiles = profiles.filter((p) => p.modelStatus !== "retired");
  const retiredProfiles = profiles.filter((p) => p.modelStatus === "retired");
  const orderedProfiles = [...activeProfiles, ...retiredProfiles];

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
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#fff", margin: 0 }}>Routing Profiles</h2>
        <p style={{ fontSize: 12, color: "#b0b0c8", marginTop: 6, lineHeight: 1.5, maxWidth: 640 }}>
          Per-model capability scores used by the routing engine to select the best model for each task.
          Higher scores mean the model is preferred for tasks requiring that capability.
          Scores start from seed data and are refined by evaluations and production observations.
          Active models appear first; retired models are shown below.
        </p>
      </div>

      {/* Summary counts */}
      {profiles.length > 0 && (
        <div style={{
          display: "flex",
          gap: 16,
          marginBottom: 16,
          fontSize: 12,
          color: "#8888a0",
        }}>
          <span>
            <span style={{ color: "#4ade80", fontWeight: 600 }}>{activeProfiles.length}</span> active
          </span>
          {retiredProfiles.length > 0 && (
            <span>
              <span style={{ color: "#8888a0", fontWeight: 600 }}>{retiredProfiles.length}</span> retired
            </span>
          )}
          <span>
            <span style={{ color: "#e0e0ff", fontWeight: 600 }}>{profiles.length}</span> total
          </span>
        </div>
      )}

      {/* Model list or empty state */}
      {orderedProfiles.length === 0 ? (
        <div style={{
          padding: "24px 16px",
          textAlign: "center",
          fontSize: 13,
          color: "#8888a0",
          background: "#161625",
          borderRadius: 6,
          border: "1px solid #2a2a40",
        }}>
          No model profiles available. Run &ldquo;Discover Models&rdquo; first.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {orderedProfiles.map((profile) => (
            <ModelCard
              key={profile.modelId}
              profile={profile}
              endpointId={endpointId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

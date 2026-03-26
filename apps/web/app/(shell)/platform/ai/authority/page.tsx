// apps/web/app/(shell)/platform/ai/authority/page.tsx
import { getToolExecutions, getToolExecutionStats } from "@/lib/tool-execution-data";
import { getAgentGrantSummaries } from "@/lib/agent-grants";
import { ToolExecutionLogClient } from "@/components/platform/ToolExecutionLogClient";
import { AiTabNav } from "@/components/platform/AiTabNav";

const STAT_CARDS: Array<{ key: "total" | "successful" | "failed" | "uniqueAgents" | "uniqueTools"; label: string; accent: string }> = [
  { key: "total", label: "Total", accent: "#7c8cf8" },
  { key: "successful", label: "Successful", accent: "#4ade80" },
  { key: "failed", label: "Failed", accent: "#ef4444" },
  { key: "uniqueAgents", label: "Agents", accent: "#38bdf8" },
  { key: "uniqueTools", label: "Tools", accent: "#fbbf24" },
];

export default async function AuthorityPage() {
  const [executions, stats, agentSummaries] = await Promise.all([
    getToolExecutions(),
    getToolExecutionStats(),
    Promise.resolve(getAgentGrantSummaries()),
  ]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Authority &amp; Audit
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Agent grants, permissions, and tool execution log
        </p>
      </div>

      <AiTabNav />

      {/* Agent Authority Overview */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Agent Authority Overview
        </h2>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 8,
        }}>
          {agentSummaries.map((agent) => (
            <div
              key={agent.agentId}
              style={{
                background: "var(--dpf-surface-1)",
                border: "1px solid var(--dpf-border)",
                borderLeft: "3px solid var(--dpf-accent)",
                borderRadius: 6,
                padding: "10px 12px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 6 }}>
                {agent.agentName}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11 }}>
                <div>
                  <span style={{ color: "var(--dpf-muted)" }}>Grants: </span>
                  <span style={{ color: "var(--dpf-text)" }}>{agent.grantCount}</span>
                </div>
                <div>
                  <span style={{ color: "var(--dpf-muted)" }}>HITL: </span>
                  <span style={{ color: "var(--dpf-text)" }}>T{agent.hitlTier}</span>
                </div>
                <div>
                  <span style={{ color: "var(--dpf-muted)" }}>Supervisor: </span>
                  <span style={{ color: "var(--dpf-text)" }}>{agent.supervisorId || "\u2014"}</span>
                </div>
                <div>
                  <span style={{ color: "var(--dpf-muted)" }}>Stream: </span>
                  <span style={{ color: "var(--dpf-text)" }}>{agent.valueStream}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tool Execution Log */}
      <div>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", margin: "0 0 12px 0" }}>
          Tool Execution Log
        </h2>

        {/* Stats cards */}
        {stats.total > 0 && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
            gap: 8,
            marginBottom: 24,
          }}>
            {STAT_CARDS.map((card) => (
              <div
                key={card.key}
                style={{
                  background: "var(--dpf-surface-1)",
                  border: "1px solid var(--dpf-border)",
                  borderLeft: `3px solid ${card.accent}`,
                  borderRadius: 6,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 10, color: "var(--dpf-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  {card.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, color: "var(--dpf-text)", marginTop: 4 }}>
                  {stats[card.key]}
                </div>
              </div>
            ))}
          </div>
        )}

        <ToolExecutionLogClient executions={executions} />
      </div>
    </div>
  );
}

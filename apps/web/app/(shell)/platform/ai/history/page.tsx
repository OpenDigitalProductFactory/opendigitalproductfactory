// apps/web/app/(shell)/platform/ai/history/page.tsx
import { getProposals, getProposalStats } from "@/lib/proposal-data";
import { ProposalHistoryClient } from "@/components/platform/ProposalHistoryClient";
import { AiTabNav } from "@/components/platform/AiTabNav";

const STAT_CARDS: Array<{ key: "total" | "executed" | "proposed" | "rejected" | "failed"; label: string; accent: string }> = [
  { key: "total", label: "Total", accent: "#7c8cf8" },
  { key: "executed", label: "Executed", accent: "#4ade80" },
  { key: "proposed", label: "Pending", accent: "#38bdf8" },
  { key: "rejected", label: "Rejected", accent: "#ef4444" },
  { key: "failed", label: "Failed", accent: "#fbbf24" },
];

export default async function AgentHistoryPage() {
  const [proposals, stats] = await Promise.all([
    getProposals(),
    getProposalStats(),
  ]);

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Action History
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {stats.total} proposal{stats.total !== 1 ? "s" : ""} recorded
        </p>
      </div>

      <AiTabNav />

      {/* Summary cards */}
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

      <ProposalHistoryClient proposals={proposals} />
    </div>
  );
}

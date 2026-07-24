// apps/web/app/(shell)/platform/audit/journal/page.tsx
import { getJournalToolExecutions, getToolExecutionStats } from "@/lib/tool-execution-data";
import { CapabilityJournalClient } from "@/components/platform/CapabilityJournalClient";

type CapabilityJournalPageProps = {
  searchParams?: Promise<{
    executionId?: string | string[];
    receiptId?: string | string[];
  }>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function CapabilityJournalPage({ searchParams }: CapabilityJournalPageProps) {
  const query = (await searchParams) ?? {};
  const initialFocusExecutionId = firstParam(query.executionId);
  const [executions, stats] = await Promise.all([
    getJournalToolExecutions(500, initialFocusExecutionId),
    getToolExecutionStats(),
  ]);

  const journalCount = executions.length;
  const successCount = executions.filter((e) => e.success).length;
  const failCount = executions.filter((e) => !e.success).length;
  const uniqueAgents = new Set(executions.map((e) => e.agentId)).size;
  const uniqueCapabilities = new Set(executions.map((e) => e.capabilityId).filter(Boolean)).size;

  const statCards = [
    { label: "Executions", value: journalCount, accent: "var(--dpf-accent)" },
    { label: "Successful", value: successCount, accent: "var(--dpf-success)" },
    { label: "Failed", value: failCount, accent: "var(--dpf-error)" },
    { label: "Coworkers", value: uniqueAgents, accent: "var(--dpf-info)" },
    { label: "Capabilities", value: uniqueCapabilities, accent: "var(--dpf-warning)" },
  ];

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Capability Journal
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Execution history for journal-class and ledger-class tool calls. Read-only probes are aggregated in Operational Metrics.
        </p>
      </div>

      {journalCount > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8,
          marginBottom: 24,
        }}>
          {statCards.map((card) => (
            <div
              key={card.label}
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
                {card.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <CapabilityJournalClient
        executions={executions}
        initialFocusExecutionId={initialFocusExecutionId}
      />

      {stats.total > 0 && (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 12 }}>
          Showing journal and ledger class executions ({journalCount} of {stats.total} total).
          Read-only probe counts are in{" "}
          <a href="/platform/audit/metrics" style={{ color: "var(--dpf-accent)" }}>Operational Metrics</a>.
        </p>
      )}
    </div>
  );
}

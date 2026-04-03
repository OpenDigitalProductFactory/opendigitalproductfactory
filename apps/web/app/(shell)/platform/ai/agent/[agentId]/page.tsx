// apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx
// EP-AI-WORKFORCE-001: Unified Agent Detail Page with Lifecycle Tabs
import { prisma } from "@dpf/db";
import { notFound } from "next/navigation";
import Link from "next/link";

const TIER_LABELS: Record<number, string> = {
  1: "Orchestrator",
  2: "Specialist",
  3: "Cross-cutting",
};

const PHASE_COLORS: Record<string, string> = {
  learning: "#fbbf24",
  practicing: "#60a5fa",
  innate: "#34d399",
};

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const decoded = decodeURIComponent(agentId);

  const agent = await prisma.agent.findFirst({
    where: { OR: [{ agentId: decoded }, { slugId: decoded }] },
    include: {
      executionConfig: true,
      skills: { orderBy: { sortOrder: "asc" } },
      toolGrants: { orderBy: { grantKey: "asc" } },
      performanceProfiles: { orderBy: { taskType: "asc" } },
      degradationMappings: { orderBy: { featureRoute: "asc" } },
      promptContext: true,
      governanceProfile: {
        include: {
          capabilityClass: true,
          directivePolicyClass: true,
        },
      },
      portfolio: { select: { slug: true, name: true } },
    },
  });

  if (!agent) return notFound();

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <Link
          href="/platform/ai"
          style={{ fontSize: 11, color: "var(--dpf-muted)", textDecoration: "none" }}
        >
          AI Workforce
        </Link>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)", margin: "0 6px" }}>/</span>
        <span style={{ fontSize: 11, color: "var(--dpf-text)" }}>{agent.name}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          {agent.name}
        </h1>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 4,
          background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)",
          color: "#60a5fa",
        }}>
          {TIER_LABELS[agent.tier] ?? `Tier ${agent.tier}`}
        </span>
        {agent.valueStream && (
          <span style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4,
            background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.3)",
            color: "#34d399",
          }}>
            {agent.valueStream}
          </span>
        )}
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 4,
          background: "rgba(156,163,175,0.1)", border: "1px solid rgba(156,163,175,0.3)",
          color: "#9ca3af",
        }}>
          {agent.lifecycleStage}
        </span>
      </div>

      {agent.description && (
        <p style={{ fontSize: 12, color: "var(--dpf-muted)", marginBottom: 16, maxWidth: 700 }}>
          {agent.description}
        </p>
      )}

      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 20 }}>
        <span>ID: <code style={{ fontSize: 10 }}>{agent.agentId}</code></span>
        {agent.slugId && (
          <span style={{ marginLeft: 12 }}>Slug: <code style={{ fontSize: 10 }}>{agent.slugId}</code></span>
        )}
        {agent.humanSupervisorId && (
          <span style={{ marginLeft: 12 }}>Supervisor: {agent.humanSupervisorId}</span>
        )}
        {agent.portfolio && (
          <span style={{ marginLeft: 12 }}>Portfolio: {agent.portfolio.name}</span>
        )}
      </div>

      {/* Overview Section */}
      <Section title="Overview">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          <InfoCard label="Sensitivity" value={agent.sensitivity} />
          <InfoCard label="HITL Tier" value={`${agent.hitlTierDefault} (${agent.hitlTierDefault === 0 ? "human-only" : agent.hitlTierDefault === 3 ? "autonomous" : "review required"})`} />
          <InfoCard label="Escalates To" value={agent.escalatesTo ?? "none"} />
          <InfoCard label="Delegates To" value={agent.delegatesTo.length > 0 ? agent.delegatesTo.join(", ") : "none"} />
          {agent.executionConfig && (
            <>
              <InfoCard label="Default Model" value={agent.executionConfig.defaultModelId ?? "auto-routed"} />
              <InfoCard label="Temperature" value={String(agent.executionConfig.temperature)} />
              <InfoCard label="Max Tokens" value={String(agent.executionConfig.maxTokens)} />
              <InfoCard label="Timeout" value={`${agent.executionConfig.timeoutSeconds}s`} />
              <InfoCard label="Token Budget" value={`${(agent.executionConfig.dailyTokenLimit / 1000).toFixed(0)}k daily / ${(agent.executionConfig.perTaskTokenLimit / 1000).toFixed(0)}k per task`} />
              <InfoCard label="Memory" value={agent.executionConfig.memoryType} />
              <InfoCard label="Concurrency" value={String(agent.executionConfig.concurrencyLimit)} />
            </>
          )}
        </div>
      </Section>

      {/* Skills Section */}
      <Section title="Skills" count={agent.skills.length}>
        {agent.skills.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
            {agent.skills.map((skill) => (
              <div key={skill.id} style={{
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid var(--dpf-border)",
                background: "var(--dpf-surface)",
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>{skill.label}</div>
                <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>{skill.description}</div>
                {skill.capability && (
                  <div style={{ fontSize: 10, color: "#60a5fa", marginTop: 4 }}>requires: {skill.capability}</div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState text="No skills assigned" />
        )}
      </Section>

      {/* Tool Grants Section */}
      <Section title="Tool Grants" count={agent.toolGrants.length}>
        {agent.toolGrants.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {agent.toolGrants.map((grant) => (
              <span key={grant.id} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 4,
                background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.2)",
                color: "#fbbf24", fontFamily: "monospace",
              }}>
                {grant.grantKey}
              </span>
            ))}
          </div>
        ) : (
          <EmptyState text="No tool grants assigned" />
        )}
      </Section>

      {/* Performance Section */}
      <Section title="Performance" count={agent.performanceProfiles.length}>
        {agent.performanceProfiles.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <th style={thStyle}>Task Type</th>
                  <th style={thStyle}>Phase</th>
                  <th style={thStyle}>Evals</th>
                  <th style={thStyle}>Avg Score</th>
                  <th style={thStyle}>Success Rate</th>
                  <th style={thStyle}>Confidence</th>
                  <th style={thStyle}>Last Evaluated</th>
                </tr>
              </thead>
              <tbody>
                {agent.performanceProfiles.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={tdStyle}>{p.taskType}</td>
                    <td style={tdStyle}>
                      <span style={{ color: PHASE_COLORS[p.instructionPhase] ?? "var(--dpf-text)" }}>
                        {p.instructionPhase}
                      </span>
                    </td>
                    <td style={tdStyle}>{p.evaluationCount}</td>
                    <td style={tdStyle}>{p.avgOrchestratorScore.toFixed(2)}</td>
                    <td style={tdStyle}>
                      {p.evaluationCount > 0 ? `${((p.successCount / p.evaluationCount) * 100).toFixed(0)}%` : "n/a"}
                    </td>
                    <td style={tdStyle}>{p.profileConfidence}</td>
                    <td style={tdStyle}>{p.lastEvaluatedAt ? new Date(p.lastEvaluatedAt).toLocaleDateString() : "never"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="No performance data yet" />
        )}
      </Section>

      {/* Governance Section */}
      <Section title="Governance">
        {agent.governanceProfile ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            <InfoCard label="Capability Class" value={agent.governanceProfile.capabilityClass.name} />
            <InfoCard label="Autonomy Level" value={agent.governanceProfile.autonomyLevel} />
            <InfoCard label="HITL Policy" value={agent.governanceProfile.hitlPolicy} />
            <InfoCard label="Delegation" value={agent.governanceProfile.allowDelegation ? "allowed" : "denied"} />
            {agent.governanceProfile.maxDelegationRiskBand && (
              <InfoCard label="Max Delegation Risk" value={agent.governanceProfile.maxDelegationRiskBand} />
            )}
          </div>
        ) : (
          <EmptyState text="No governance profile configured" />
        )}
      </Section>

      {/* Degradation Mappings Section */}
      <Section title="Feature Degradation" count={agent.degradationMappings.length}>
        {agent.degradationMappings.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                  <th style={thStyle}>Route</th>
                  <th style={thStyle}>Feature</th>
                  <th style={thStyle}>Required Tier</th>
                  <th style={thStyle}>Degradation Mode</th>
                  <th style={thStyle}>User Message</th>
                </tr>
              </thead>
              <tbody>
                {agent.degradationMappings.map((m) => (
                  <tr key={m.id} style={{ borderBottom: "1px solid var(--dpf-border)" }}>
                    <td style={tdStyle}><code style={{ fontSize: 10 }}>{m.featureRoute}</code></td>
                    <td style={tdStyle}>{m.featureName}</td>
                    <td style={tdStyle}>{m.requiredTier}</td>
                    <td style={tdStyle}>
                      <span style={{
                        padding: "1px 6px", borderRadius: 4, fontSize: 10,
                        background: m.degradationMode === "disabled" ? "rgba(239,68,68,0.1)" : "rgba(251,191,36,0.1)",
                        color: m.degradationMode === "disabled" ? "#ef4444" : "#fbbf24",
                        border: `1px solid ${m.degradationMode === "disabled" ? "rgba(239,68,68,0.3)" : "rgba(251,191,36,0.3)"}`,
                      }}>
                        {m.degradationMode}
                      </span>
                    </td>
                    <td style={tdStyle}>{m.userMessage ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text="No degradation mappings defined" />
        )}
      </Section>

      {/* Prompt Context Section */}
      {agent.promptContext && (
        <Section title="Prompt Context">
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            {agent.promptContext.perspective && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>Perspective</div>
                <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{agent.promptContext.perspective}</div>
              </div>
            )}
            {agent.promptContext.heuristics && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>Heuristics</div>
                <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{agent.promptContext.heuristics}</div>
              </div>
            )}
            {agent.promptContext.interpretiveModel && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>Interpretive Model</div>
                <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>{agent.promptContext.interpretiveModel}</div>
              </div>
            )}
            {agent.promptContext.domainTools.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>Domain Tools</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {agent.promptContext.domainTools.map((tool) => (
                    <code key={tool} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: "var(--dpf-surface)", border: "1px solid var(--dpf-border)" }}>
                      {tool}
                    </code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        {title}
        {count !== undefined && (
          <span style={{ fontSize: 10, color: "var(--dpf-muted)", fontWeight: 400 }}>({count})</span>
        )}
      </h2>
      {children}
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      padding: "8px 12px",
      borderRadius: 6,
      border: "1px solid var(--dpf-border)",
      background: "var(--dpf-surface)",
    }}>
      <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--dpf-text)", fontWeight: 500 }}>{value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 11, color: "var(--dpf-muted)", fontStyle: "italic", padding: "8px 0" }}>
      {text}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--dpf-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  color: "var(--dpf-text)",
};

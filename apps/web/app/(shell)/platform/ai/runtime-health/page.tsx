// apps/web/app/(shell)/platform/ai/runtime-health/page.tsx
//
// Model Selection & Runtime Health — the single authoritative view that answers
// "which model/provider/engine runs each build phase right now — local or cloud?"
// and "where does live config contradict platform guidance?". It synthesizes the
// three otherwise-disconnected sources (Providers & Routing, Build Runtime, DMR
// serving config) so a fresh operator can answer in ONE place rather than
// grepping code or clicking two admin pages. See BI-768AFB99 / EP-FULL-OBS.
import { auth } from "@/lib/auth";
import {
  resolveModelSelectionByPhase,
  type ModelSelectionOverview,
  type PhaseResolution,
  type FlagSeverity,
} from "@/lib/inference/phase-model-resolution";
import { LocalTime } from "@/components/ui/LocalTime";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { AiReadinessHeaderLink } from "@/components/platform/AiReadinessHeaderLink";
import { QueueHealthSection } from "@/components/queue/QueueHealthSection";
import { readQueueSnapshots } from "@/lib/queue/queue-snapshot-service";
import { getJobEngineHealth, type JobEngineHealth } from "@/lib/queue/job-engine-health";
import { PhaseRemediationActions } from "@/components/platform/PhaseRemediationActions";
import Link from "next/link";
import { CapabilityServiceHealth } from "@/components/monitoring/CapabilityServiceHealth";
import {
  type CapabilityServiceHealthProjection,
} from "@/lib/platform-runtime/service-health";
import { loadCapabilityServiceHealth } from "@/lib/platform-runtime/service-health-loader";

export const dynamic = "force-dynamic";

const SEVERITY_STYLE: Record<FlagSeverity, { bg: string; fg: string; label: string }> = {
  error: { bg: "var(--dpf-state-error)", fg: "var(--dpf-error)", label: "Error" },
  warning: { bg: "var(--dpf-state-warning)", fg: "var(--dpf-warning)", label: "Warning" },
  info: { bg: "var(--dpf-state-info)", fg: "var(--dpf-info)", label: "Info" },
};

// Server-composed handoff prompt: carries the error flags' own messages and
// remediations so the coworker starts from the facts, not a screenshot.
function buildRuntimeHealthPrompt(overview: ModelSelectionOverview): string {
  const errors = overview.flags.filter((f) => f.severity === "error").slice(0, 8);
  return [
    `I'm on the AI Runtime Health page. Verdict: "${overview.summary}" with ${errors.length} error flag(s):`,
    ...errors.map((f) => `- [${f.phase}] ${f.code}: ${f.message} (suggested: ${f.remediation})`),
    "Please diagnose what's actually wrong, explain the impact in plain language, and either fix it if you have a safe way to do so or walk me through the exact next step.",
  ].join("\n");
}

const VERDICT_COPY: Record<ModelSelectionOverview["verdict"], { tone: string; title: string }> = {
  "all-local": { tone: "var(--dpf-success)", title: "All phases run locally" },
  "all-cloud": { tone: "var(--dpf-accent)", title: "All phases route to cloud" },
  mixed: { tone: "var(--dpf-warning)", title: "Mixed: local + cloud" },
  unconfigured: { tone: "var(--dpf-error)", title: "Not configured" },
};

function Chip({ children, bg, fg }: { children: React.ReactNode; bg: string; fg: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function LocalCloudChip({ isLocal }: { isLocal: boolean | null }) {
  if (isLocal === null)
    return <Chip bg="var(--dpf-surface-2)" fg="var(--dpf-muted)">Not resolved</Chip>;
  return isLocal ? (
    <Chip bg="var(--dpf-state-success)" fg="var(--dpf-success)">● Local</Chip>
  ) : (
    <Chip bg="var(--dpf-state-info)" fg="var(--dpf-accent)">☁ Cloud</Chip>
  );
}

const GOVERNED_LABEL: Record<PhaseResolution["governedBy"], string> = {
  "build-runtime": "Build Runtime",
  "providers-routing": "Providers & Routing",
  "dmr-serving": "Local endpoint (DMR)",
};

const td: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid var(--dpf-border)",
  fontSize: 12,
  color: "var(--dpf-text)",
  verticalAlign: "top",
};
const th: React.CSSProperties = {
  padding: "6px 10px",
  textAlign: "left",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--dpf-muted)",
  borderBottom: "1px solid var(--dpf-border)",
};

export default async function RuntimeHealthPage() {
  await auth(); // (shell)/platform layout gates platform access; render read-only.

  const overviewPromise = resolveModelSelectionByPhase()
    .then((value) => ({ value, unavailable: false as const }))
    .catch(() => {
      logRuntimeHealthReadFailure("model-selection");
      return { value: null, unavailable: true as const };
    });
  const capabilityPromise = loadCapabilityServiceHealth()
    .then((value) => ({ value, unavailable: false as const }))
    .catch(() => {
      logRuntimeHealthReadFailure("capability-authority");
      return { value: null, unavailable: true as const };
    });
  const queuePromise = readQueueSnapshots({ limit: 24 }).catch(() => {
    logRuntimeHealthReadFailure("queue-snapshots");
    return [];
  });
  const jobEnginePromise = getJobEngineHealth().catch(() => {
    logRuntimeHealthReadFailure("job-engine");
    return unavailableJobEngineHealth();
  });

  const [overviewResult, capabilityResult, queueSnapshots, jobEngineHealth] = await Promise.all([
    overviewPromise,
    capabilityPromise,
    queuePromise,
    jobEnginePromise,
  ]);
  const overview: ModelSelectionOverview | null = overviewResult.value;
  const capabilityHealth: CapabilityServiceHealthProjection | null = capabilityResult.value;
  const loadError = overviewResult.unavailable;
  const errorCount = overview?.flags.filter((f) => f.severity === "error").length ?? 0;

  return (
    <div>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
            Model Selection &amp; Runtime Health
          </h1>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2, maxWidth: 760 }}>
            One authoritative view of which model, provider, and engine will run each
            build phase <em>right now</em> — and where live config contradicts platform
            guidance. Resolved before a build runs, using the same routing logic the
            build uses.
          </p>
        </div>
        <AiReadinessHeaderLink />
      </div>

      <div style={{ marginBottom: 20 }}>
        <QueueHealthSection snapshots={queueSnapshots} />
      </div>

      <div className="mb-5">
        {capabilityHealth ? (
          <CapabilityServiceHealth projection={capabilityHealth} />
        ) : (
          <section
            aria-labelledby="capability-service-health-title"
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          >
            <h2 id="capability-service-health-title" className="text-sm font-semibold text-[var(--dpf-text)]">
              Capability service requirements
            </h2>
            <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
              Capability authority is unavailable. Service requirements cannot be classified safely
              right now.
            </p>
          </section>
        )}
      </div>

      <section
        style={{
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: 14,
          marginBottom: 20,
          background: "var(--dpf-surface-1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
              Background job engine
            </h2>
            <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4, maxWidth: 740 }}>
              Watches Inngest registration and executor traffic from the portal process,
              so starvation is visible even when Inngest cron itself is not firing.
            </p>
          </div>
          <Chip
            bg={
              jobEngineHealth.status === "healthy"
                ? "var(--dpf-state-success)"
                : jobEngineHealth.status === "degraded"
                  ? "var(--dpf-state-error)"
                  : "var(--dpf-surface-2)"
            }
            fg={
              jobEngineHealth.status === "healthy"
                ? "var(--dpf-success)"
                : jobEngineHealth.status === "degraded"
                  ? "var(--dpf-error)"
                  : "var(--dpf-muted)"
            }
          >
            {jobEngineHealth.status.toUpperCase()}
          </Chip>
        </div>
        {jobEngineHealth.detail && (
          <p style={{ fontSize: 12, color: "var(--dpf-text)", marginTop: 8, marginBottom: 0 }}>
            {jobEngineHealth.detail}
          </p>
        )}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "var(--dpf-muted)" }}>
          <span>
            Last registration:{" "}
            {jobEngineHealth.checkedAt ? <LocalTime value={jobEngineHealth.checkedAt} /> : "not recorded"}
          </span>
          <span>
            Last executor POST:{" "}
            {jobEngineHealth.watchdog.lastInvocationAt ? (
              <LocalTime value={jobEngineHealth.watchdog.lastInvocationAt} />
            ) : (
              "not observed"
            )}
          </span>
          <span>
            Watchdog: {jobEngineHealth.watchdog.status}
          </span>
          {jobEngineHealth.watchdog.lastRecoveryAttemptAt && (
            <span>
              Last safe reap: <LocalTime value={jobEngineHealth.watchdog.lastRecoveryAttemptAt} />
            </span>
          )}
        </div>
        {jobEngineHealth.watchdog.lastRecoverySummary && (
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 8, marginBottom: 0 }}>
            Recovery summary: {jobEngineHealth.watchdog.lastRecoverySummary}
          </p>
        )}
      </section>

      {loadError && (
        <div
          style={{
            border: "1px solid var(--dpf-error)",
            background: "var(--dpf-state-error)",
            borderRadius: 8,
            padding: 14,
            fontSize: 12,
            color: "var(--dpf-text)",
          }}
        >
          Model selection is temporarily unavailable. Review provider and routing diagnostics, then retry.
        </div>
      )}

      {overview && (
        <>
          {/* Verdict banner */}
          <div
            style={{
              border: `1px solid ${VERDICT_COPY[overview.verdict].tone}`,
              borderLeft: `4px solid ${VERDICT_COPY[overview.verdict].tone}`,
              background: "var(--dpf-surface-1)",
              borderRadius: 8,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: VERDICT_COPY[overview.verdict].tone }}>
                {VERDICT_COPY[overview.verdict].title}
              </span>
              <Chip bg="var(--dpf-surface-2)" fg="var(--dpf-muted)">
                Build engine: {overview.buildEngineLabel}
              </Chip>
              {errorCount > 0 && (
                <Chip bg={SEVERITY_STYLE.error.bg} fg={SEVERITY_STYLE.error.fg}>
                  {errorCount} error(s)
                </Chip>
              )}
              {errorCount > 0 && (
                <AskCoworkerButton
                  prompt={buildRuntimeHealthPrompt(overview)}
                  routeContext="/platform"
                  label="Ask coworker to investigate"
                  className="text-[var(--dpf-accent)] hover:underline underline-offset-2 text-xs"
                />
              )}
            </div>
            <p style={{ fontSize: 12, color: "var(--dpf-text)", marginTop: 8, marginBottom: 0 }}>
              {overview.summary}
            </p>
          </div>

          {/* Per-phase table */}
          <div
            data-testid="phase-routing-table-scroll"
            style={{ overflowX: "auto", minWidth: 0, maxWidth: "100%", marginBottom: 22 }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Phase</th>
                  <th style={th}>Runs on</th>
                  <th style={th}>Provider / Model</th>
                  <th style={th}>Mechanism</th>
                  <th style={th}>Governed by</th>
                  <th style={th}>Context</th>
                  <th style={th}>Flags</th>
                </tr>
              </thead>
              <tbody>
                {overview.phases.map((p) => {
                  const errs = p.flags.filter((f) => f.severity === "error").length;
                  const warns = p.flags.filter((f) => f.severity === "warning").length;
                  return (
                    <tr key={p.phase}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{p.label}</div>
                        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{p.engine}</div>
                      </td>
                      <td style={td}>
                        <LocalCloudChip isLocal={p.isLocal} />
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{p.providerId ?? "—"}</div>
                        <div style={{ fontSize: 11, color: "var(--dpf-muted)", fontFamily: "var(--dpf-mono, monospace)" }}>
                          {p.modelId ?? "—"}
                        </div>
                      </td>
                      <td style={td}>{p.mechanism}</td>
                      <td style={td}>{GOVERNED_LABEL[p.governedBy]}</td>
                      <td style={td}>
                        {p.contextTokens !== null ? `${p.contextTokens.toLocaleString()} tok` : "—"}
                      </td>
                      <td style={td}>
                        {errs === 0 && warns === 0 ? (
                          <Chip bg="var(--dpf-state-success)" fg="var(--dpf-success)">OK</Chip>
                        ) : (
                          <span style={{ display: "inline-flex", gap: 4 }}>
                            {errs > 0 && (
                              <Chip bg={SEVERITY_STYLE.error.bg} fg={SEVERITY_STYLE.error.fg}>{errs} err</Chip>
                            )}
                            {warns > 0 && (
                              <Chip bg={SEVERITY_STYLE.warning.bg} fg={SEVERITY_STYLE.warning.fg}>{warns} warn</Chip>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mismatches & remediation */}
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--dpf-text)", marginBottom: 10 }}>
            Mismatches &amp; remediation
          </h2>
          {overview.flags.length === 0 ? (
            <p style={{ fontSize: 12, color: "var(--dpf-muted)" }}>
              No mismatches — live config matches platform guidance for every phase.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
              {overview.flags.map((f, i) => {
                const s = SEVERITY_STYLE[f.severity];
                const phase = overview!.phases.find((p) => p.phase === f.phase);
                const phaseLabel = phase?.label ?? f.phase;
                const candidates =
                  f.code === "no-eligible-endpoint" ? phase?.enableCandidates ?? [] : [];
                return (
                  <div
                    key={`${f.code}-${i}`}
                    style={{
                      border: "1px solid var(--dpf-border)",
                      borderLeft: `3px solid ${s.fg}`,
                      borderRadius: 6,
                      padding: "10px 12px",
                      background: "var(--dpf-surface-1)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <Chip bg={s.bg} fg={s.fg}>{s.label}</Chip>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--dpf-text)" }}>{phaseLabel}</span>
                      <code style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{f.code}</code>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--dpf-text)" }}>{f.message}</div>
                    <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 }}>
                      → {f.remediation}
                    </div>
                    {candidates.length > 0 && <PhaseRemediationActions candidates={candidates} />}
                  </div>
                );
              })}
            </div>
          )}

          {/* How this is resolved + cross-links */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 11, color: "var(--dpf-muted)", cursor: "pointer" }}>
              How this is resolved
            </summary>
            <ul style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 8, paddingLeft: 18, lineHeight: 1.6 }}>
              {overview.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </details>

          <div style={{ fontSize: 11, color: "var(--dpf-muted)", display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)" }}>
              Providers &amp; Routing →
            </Link>
            <Link href="/platform/ai/build-studio" style={{ color: "var(--dpf-accent)" }}>
              Build Runtime →
            </Link>
            <span>
              Resolved <LocalTime value={overview.generatedAt} />
            </span>
            <span>Agents: <code>resolve_model_selection</code> (MCP)</span>
          </div>
        </>
      )}
    </div>
  );
}

function logRuntimeHealthReadFailure(source: string): void {
  console.error("[runtime-health] read unavailable", {
    event: "runtime_health_read_unavailable",
    source,
    route: "/platform/ai/runtime-health",
  });
}

function unavailableJobEngineHealth(): JobEngineHealth {
  return {
    status: "unknown",
    detail: "Background job health is temporarily unavailable.",
    checkedAt: null,
    watchdog: {
      status: "unknown",
      detail: "Background job watchdog evidence is temporarily unavailable.",
      lastInvocationAt: null,
      lastGatewayHitAt: null,
      lastRecoveryAttemptAt: null,
      lastRecoverySummary: null,
    },
  };
}

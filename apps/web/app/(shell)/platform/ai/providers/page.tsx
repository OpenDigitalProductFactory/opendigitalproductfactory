// apps/web/app/(shell)/platform/ai/providers/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs, groupByEndpointTypeAndCategory, getProviderModelSummaries } from "@/lib/ai-provider-data";
import { syncProviderRegistry, detectMcpServers, runProviderCatalogReconciliationIfDue } from "@/lib/actions/ai-providers";
import { DetectedServicesBanner } from "@/components/platform/DetectedServicesBanner";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { checkBundledProviders } from "@/lib/ollama";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { ServiceSection } from "@/components/platform/ServiceSection";
import { ServiceRow } from "@/components/platform/ServiceRow";
import { getAllCliPoolStatuses, formatWeeklyAllocationHint, type CliPoolState } from "@/lib/routing/cli-pool-status";
import { CliPoolStatusPanel } from "@/components/platform/CliPoolStatusPanel";
import { cliAdapterTypeForProvider, deriveRoutingEligibility, type RoutingEligibility } from "@/lib/routing/provider-routing-eligibility";
import { getRecentBudgetEvents, countRecentRejections } from "@/lib/inference/budget-events-data";
import { AgentBudgetEventsPanel } from "@/components/platform/AgentBudgetEventsPanel";
import { LocalOnlyInferenceToggle } from "@/components/platform/LocalOnlyInferenceToggle";
import { getLocalOnlyInference } from "@/lib/inference/local-only";
import { LocalTime } from "@/components/ui/LocalTime";
import { AiReadinessHeaderLink } from "@/components/platform/AiReadinessHeaderLink";
import { resolveModelSelectionByPhase } from "@/lib/inference/phase-model-resolution";
import Link from "next/link";
import { ProviderSuitabilityGuide } from "@/components/platform/ProviderSuitabilityGuide";
import { loadProviderOnboardingRecommendation } from "@/lib/routing/provider-suitability/provider-onboarding-data";
import { resolveRuntimeConnectionStatus } from "@/lib/routing/provider-suitability/onboarding-recommendation";
import { getProviderSuitabilityTelemetryRollup } from "@/lib/actions/route-decision-logs";


/**
 * Short, human reset hint for an exhausted CLI pool, e.g. "in ~5min".
 * Fills the routing-eligibility "rate_limited" reason on CLI-backed rows.
 */
function poolResetHint(pool: CliPoolState): string | null {
  const s = pool.secondsUntilReset;
  if (s == null) return null;
  if (s <= 0) return "any moment";
  if (s < 60) return `in ~${s}s`;
  return `in ~${Math.ceil(s / 60)}min`;
}

export default async function ProvidersPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  // Auto-sync if due
  const jobs = await getScheduledJobs();
  const syncJob = jobs.find((j) => j.jobId === "provider-registry-sync");
  if (syncJob && syncJob.schedule !== "disabled" && syncJob.nextRunAt && syncJob.nextRunAt < new Date()) {
    await syncProviderRegistry();
  }

  // Re-enable providers whose quota reset timer has elapsed
  const reenableJobs = jobs.filter((j) => j.jobId.startsWith("provider-reenable-") && j.schedule !== "disabled" && j.nextRunAt && j.nextRunAt < new Date());
  for (const job of reenableJobs) {
    const providerId = job.jobId.replace("provider-reenable-", "");
    await prisma.modelProvider.update({ where: { providerId }, data: { status: "active" } }).catch(() => {});
    await prisma.scheduledJob.update({ where: { jobId: job.jobId }, data: { lastStatus: "completed", lastRunAt: new Date(), schedule: "disabled" } }).catch(() => {});
  }

  // Passive health check for bundled Ollama (may change provider status)
  // These are side-effects that must not crash the page render.
  await checkBundledProviders().catch((e) => console.warn("[providers] checkBundledProviders failed:", e));
  await runProviderCatalogReconciliationIfDue().catch((e) => console.warn("[providers] catalog reconciliation failed:", e));

  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  // Bypass React cache for jobs — syncProviderRegistry() may have mutated the DB above.
  const [providers, byProvider, byAgent, freshJobs, detected, modelSummaries, cliPoolStatuses, budgetEvents, recentRejections, localOnlyInference, onboardingRecommendation, suitabilityTelemetry] = await Promise.all([
    getProviders(),
    getTokenSpendByProvider(currentMonth),
    getTokenSpendByAgent(currentMonth),
    prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
    detectMcpServers(),
    getProviderModelSummaries(),
    getAllCliPoolStatuses(),
    getRecentBudgetEvents(),
    countRecentRejections(),
    getLocalOnlyInference(),
    loadProviderOnboardingRecommendation(),
    getProviderSuitabilityTelemetryRollup(),
  ]);
  const aiProviders = providers.filter((pw) => pw.provider.endpointType !== "service");

  // BI-04E4F111: routing filters on AiProviderConnection.status, not
  // ModelProvider.status — a provider whose only connection is disabled must
  // not read "active" here while routing silently skips it. Fold the default
  // connection's veto into the status the eligibility badge derives from.
  const defaultConnections =
    typeof prisma.aiProviderConnection?.findMany === "function"
      ? await prisma.aiProviderConnection
          .findMany({
            where: { connectionId: { startsWith: "provider-default-" } },
            select: { providerId: true, status: true },
          })
          .catch(() => [] as Array<{ providerId: string; status: string }>)
      : [];
  const connectionStatusByProvider = new Map(
    defaultConnections.map((c) => [c.providerId, c.status] as const),
  );

  // Derive the single routing-eligibility state per provider from data already
  // loaded above (status + credential + discovered models + CLI pool). This one
  // answer drives the row badge and the section counts — replacing the old
  // status-dot / "needs credentials" / billing "Not connected" muddle, and
  // folding the separate CLI-pool box's signal into each CLI-backed row.
  const cliPoolByAdapter = new Map(cliPoolStatuses.map((s) => [s.adapterType, s] as const));
  const nowMs = now.getTime();
  const eligibilityById: Record<string, RoutingEligibility> = {};
  const weeklyHintById: Record<string, string | null> = {};
  for (const pw of aiProviders) {
    const p = pw.provider;
    const adapterType = cliAdapterTypeForProvider(p.providerId);
    const pool = adapterType ? cliPoolByAdapter.get(adapterType) : undefined;
    const summary = modelSummaries.get(p.providerId);
    const credentialExpired =
      !!pw.credential?.tokenExpiresAt &&
      new Date(pw.credential.tokenExpiresAt).getTime() < nowMs;
    const connectionStatus = connectionStatusByProvider.get(p.providerId);
    const connectionVetoed = p.status === "active" && connectionStatus === "disabled";
    const eligibility = deriveRoutingEligibility({
      status: connectionStatus != null
        ? resolveRuntimeConnectionStatus(p.status, connectionStatus)
        : p.status,
      endpointType: p.endpointType,
      category: p.category,
      serviceKind: p.serviceKind ?? null,
      authMethod: p.authMethod,
      hasCredential: pw.credential?.hasUsableMaterial ?? false,
      credentialExpired,
      discoveredModelCount: summary?.totalModels ?? 0,
      cliPoolExhausted: pool?.isExhausted ?? false,
      cliPoolResetHint: pool ? poolResetHint(pool) : null,
    });
    eligibilityById[p.providerId] = connectionVetoed
      ? {
          ...eligibility,
          reason:
            "The provider is on, but its connection is disabled — routing skips it until you reconnect.",
        }
      : eligibility;
    // Real remaining weekly subscription allocation, when a fresh snapshot exists.
    weeklyHintById[p.providerId] = pool ? formatWeeklyAllocationHint(pool, now) : null;
  }

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;

  // F11 (BI-1A75E068): tie provider → blocked phase. Reuse the SAME resolver
  // runtime-health uses; for any phase blocked with `no-eligible-endpoint`, it
  // already computed which currently-off providers would resolve it. Map those
  // to phase labels so each candidate row shows a "Resolves <phase>" badge —
  // no duplicated eligibility logic. Best-effort: a resolver error never breaks
  // the providers list.
  const resolvesPhasesById = new Map<string, string[]>();
  try {
    const overview = await resolveModelSelectionByPhase();
    for (const phase of overview.phases) {
      for (const cand of phase.enableCandidates ?? []) {
        const list = resolvesPhasesById.get(cand.providerId) ?? [];
        if (!list.includes(phase.label)) list.push(phase.label);
        resolvesPhasesById.set(cand.providerId, list);
      }
    }
  } catch {
    // Leave the map empty — badges simply don't render.
  }

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>Providers &amp; Routing</h1>
          <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
            {aiProviders.length} provider{aiProviders.length !== 1 ? "s" : ""} registered
            {lastSync ? <> · last synced <LocalTime value={lastSync} mode="date" /></> : ""}
          </p>
        </div>
        <AiReadinessHeaderLink />
      </div>

      <DetectedServicesBanner detected={detected} />

      <ProviderSuitabilityGuide recommendation={onboardingRecommendation} telemetry={suitabilityTelemetry} />

      <div
        style={{
          marginBottom: 24,
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: "12px 14px",
          background: "var(--dpf-surface-1)",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, color: "var(--dpf-text)" }}>
          MCP service operations and runtime tool inventory now live under{" "}
          <Link href="/platform/tools/services" style={{ color: "var(--dpf-accent)" }}>
            Tools &amp; Services
          </Link>.
        </p>
      </div>

      {/* Section 1: Provider catalog */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Providers
          </div>
          <ProviderCatalogStatus lastSyncAt={lastSync ?? null} />
        </div>

        {aiProviders.length === 0 ? (
          <p style={{ color: "var(--dpf-muted)", fontSize: 11 }}>
            No providers are registered yet. The provider catalog loads automatically; setup actions appear only when a provider needs credentials or review.
          </p>
        ) : (
          groupByEndpointTypeAndCategory(aiProviders).map((group) => (
            <ServiceSection
              key={`${group.endpointType}:${group.category}`}
              endpointType={group.endpointType}
              displayName={group.displayName}
              providers={group.providers}
              eligibilityById={eligibilityById}
              hasResolver={group.providers.some((pw) => resolvesPhasesById.has(pw.provider.providerId))}
            >
              {group.providers.map((pw) => (
                <ServiceRow
                  key={pw.provider.providerId}
                  pw={pw}
                  eligibility={eligibilityById[pw.provider.providerId]!}
                  weeklyAllocationHint={weeklyHintById[pw.provider.providerId] ?? null}
                  {...(modelSummaries.has(pw.provider.providerId) ? { modelSummary: modelSummaries.get(pw.provider.providerId)! } : {})}
                  {...(resolvesPhasesById.has(pw.provider.providerId) ? { resolvesPhases: resolvesPhasesById.get(pw.provider.providerId)! } : {})}
                />
              ))}
            </ServiceSection>
          ))
        )}
      </div>

      <details
        style={{
          marginBottom: 24,
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: "12px 14px",
          background: "var(--dpf-surface-1)",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            color: "var(--dpf-text)",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Advanced routing operations
        </summary>
        <div style={{ marginTop: 14 }}>
          {/* CLI pool rate-limit detail (reset times, error snippets). The live gate
              itself now also shows inline on each CLI-backed provider's row as the
              "rate_limited" eligibility state (BI-1C4AAE1E); this panel is the
              drill-down. Only renders when a pool has a recorded 429. */}
          <CliPoolStatusPanel statuses={cliPoolStatuses} />

          {/* EP-COST Phase 2: Agent Budget Events — surface warning_95 and rejected threshold crossings */}
          <AgentBudgetEventsPanel events={budgetEvents} recentRejections={recentRejections} />

          {/* Local-only inference (cloud-disabled) guarantee — BI-594E8782 */}
          <LocalOnlyInferenceToggle initialEnabled={localOnlyInference} canWrite={canWrite} />
        </div>
      </details>

      <details
        style={{
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          padding: "12px 14px",
          background: "var(--dpf-surface-1)",
        }}
      >
        <summary
          style={{
            cursor: "pointer",
            color: "var(--dpf-text)",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Spend and scheduled maintenance
        </summary>
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 32 }}>
            <TokenSpendPanel initialMonth={currentMonth} byProvider={byProvider} byAgent={byAgent} />
          </div>

          <div>
            <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
              Scheduled Jobs
            </div>
            <ScheduledJobsTable jobs={freshJobs} canWrite={canWrite} />
          </div>
        </div>
      </details>
    </div>
  );
}

function ProviderCatalogStatus({ lastSyncAt }: { lastSyncAt: Date | null }) {
  return (
    <div style={{ textAlign: "right", fontSize: 10, color: "var(--dpf-muted)" }}>
      <div style={{ color: "var(--dpf-text)", fontWeight: 600 }}>Provider catalog</div>
      <div>
        {lastSyncAt ? (
          <>
            Last updated <LocalTime value={lastSyncAt} mode="date" />
          </>
        ) : (
          "Updates automatically"
        )}
      </div>
      <div>
        <AskCoworkerButton
          prompt={`I'm on the AI Providers page. The provider catalog shows ${
            lastSyncAt
              ? `it was last updated ${lastSyncAt.toISOString()}`
              : "no recorded catalog sync"
          }. Please check the provider/catalog status, tell me in plain language whether anything is wrong, and give me the exact next step if action is needed.`}
          routeContext="/platform"
          label="Ask AI Coworker if this status looks wrong."
          className="text-[var(--dpf-accent)] hover:underline underline-offset-2"
        />
      </div>
    </div>
  );
}

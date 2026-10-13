// apps/web/app/(shell)/platform/ai/providers/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs, getProviderModelSummaries } from "@/lib/ai-provider-data";
import { syncProviderRegistry, detectMcpServers, runProviderCatalogReconciliationIfDue } from "@/lib/actions/ai-providers";
import { DetectedServicesBanner } from "@/components/platform/DetectedServicesBanner";
import { AskCoworkerButton } from "@/components/agent/AskCoworkerButton";
import { checkBundledProviders } from "@/lib/ollama";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { getAllCliPoolStatuses } from "@/lib/routing/cli-pool-status";
import { CliPoolStatusPanel } from "@/components/platform/CliPoolStatusPanel";
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
import { loadProviderRoutingControls } from "@/lib/inference/provider-routing-control-data";
import { getProviderSuitabilityTelemetryRollup } from "@/lib/actions/route-decision-logs";
import { ProviderAccountsOverview } from "@/components/platform/ProviderAccountsOverview";
import { getProviderAccountCopy, loadProviderAccountOverview } from "@/lib/inference/provider-account-overview.server";
import { getProviderAccountSetupState } from "@/lib/actions/provider-account-setup";
import { Notice } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";


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
    getLocalOnlyInference().catch(() => null),
    loadProviderOnboardingRecommendation(),
    getProviderSuitabilityTelemetryRollup(),
  ]);
  const aiProviders = providers.filter((pw) => pw.provider.endpointType !== "service");

  const routingControls = localOnlyInference === null ? new Map() : await loadProviderRoutingControls(aiProviders, new Map([...modelSummaries].map(([id, summary]) => [id, summary.totalModels])), now).catch(() => new Map());

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;
  const lastCatalogRefresh = freshJobs.find((j) => j.jobId === "model-discovery-refresh")?.lastRunAt;

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
  const [copy, setup] = await Promise.all([getProviderAccountCopy(), getProviderAccountSetupState()]);
  const accountRows = await loadProviderAccountOverview({ providers: aiProviders, modelSummaries, controls: routingControls, resolvesPhases: resolvesPhasesById, copy, now });

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

      <section className="mb-3" aria-label={copy.whereAiMayRun}>
        {localOnlyInference === null ? <Notice variant="error">{copy.policyUnavailable}</Notice>
          : <LocalOnlyInferenceToggle initialEnabled={localOnlyInference} canWrite={canWrite} />}
      </section>

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
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Providers
          </div>
          <ProviderCatalogStatus lastSyncAt={lastCatalogRefresh ?? null} />
        </div>

        <ProviderAccountsOverview rows={accountRows} catalog={aiProviders.map(({ provider }) => ({ providerId: provider.providerId,
          name: provider.name, summary: provider.costPerformanceNotes ?? provider.billingLabel ?? "", supportedAuthMethods: provider.supportedAuthMethods }))}
          firstRun={setup.showCatalog} canWrite={canWrite} copy={copy} />
      </div>

      <Surface className="mb-3" padding="sm"><details>
        <summary className="cursor-pointer py-2 text-sm font-semibold">{copy.allowedWork}</summary>
        <ProviderSuitabilityGuide recommendation={onboardingRecommendation} telemetry={suitabilityTelemetry} />
      </details></Surface>

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

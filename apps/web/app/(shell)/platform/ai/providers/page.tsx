// apps/web/app/(shell)/platform/ai/providers/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs, groupByEndpointTypeAndCategory, getProviderModelSummaries } from "@/lib/ai-provider-data";
import { syncProviderRegistry, detectMcpServers, runProviderCatalogReconciliationIfDue } from "@/lib/actions/ai-providers";
import { DetectedServicesBanner } from "@/components/platform/DetectedServicesBanner";
import { checkBundledProviders } from "@/lib/ollama";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { SyncProvidersButton } from "@/components/platform/SyncProvidersButton";
import { ServiceSection } from "@/components/platform/ServiceSection";
import { ServiceRow } from "@/components/platform/ServiceRow";
import Link from "next/link";


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
  const [providers, byProvider, byAgent, freshJobs, detected, modelSummaries] = await Promise.all([
    getProviders(),
    getTokenSpendByProvider(currentMonth),
    getTokenSpendByAgent(currentMonth),
    prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
    detectMcpServers(),
    getProviderModelSummaries(),
  ]);

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>Providers &amp; Routing</h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {providers.length} provider{providers.length !== 1 ? "s" : ""} registered
          {lastSync ? ` · last synced ${new Date(lastSync).toLocaleDateString()}` : ""}
        </p>
      </div>

      <DetectedServicesBanner detected={detected} />

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

      {/* Section 1: External Services Registry */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            External Services
          </div>
          {canWrite && <SyncProvidersButton lastSyncAt={lastSync ?? null} />}
        </div>

        {providers.length === 0 ? (
          <p style={{ color: "var(--dpf-muted)", fontSize: 11 }}>No services registered. Click &quot;Update Providers&quot; to import.</p>
        ) : (
          groupByEndpointTypeAndCategory(providers).map((group) => (
            <ServiceSection
              key={`${group.endpointType}:${group.category}`}
              endpointType={group.endpointType}
              displayName={group.displayName}
              providers={group.providers}
            >
              {group.providers.map((pw) => (
                <ServiceRow key={pw.provider.providerId} pw={pw} {...(modelSummaries.has(pw.provider.providerId) ? { modelSummary: modelSummaries.get(pw.provider.providerId)! } : {})} />
              ))}
            </ServiceSection>
          ))
        )}
      </div>

      {/* Section 2: Token Spend */}
      <div style={{ marginBottom: 32 }}>
        <TokenSpendPanel initialMonth={currentMonth} byProvider={byProvider} byAgent={byAgent} />
      </div>

      {/* Section 3: Scheduled Jobs */}
      <div>
        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
          Scheduled Jobs
        </div>
        <ScheduledJobsTable jobs={freshJobs} canWrite={canWrite} />
      </div>
    </div>
  );
}

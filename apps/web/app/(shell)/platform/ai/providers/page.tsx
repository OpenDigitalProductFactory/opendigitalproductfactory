// apps/web/app/(shell)/platform/ai/providers/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs, groupByEndpointTypeAndCategory } from "@/lib/ai-provider-data";
import { syncProviderRegistry, detectMcpServers } from "@/lib/actions/ai-providers";
import { DetectedServicesBanner } from "@/components/platform/DetectedServicesBanner";
import { checkBundledProviders } from "@/lib/ollama";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { SyncProvidersButton } from "@/components/platform/SyncProvidersButton";
import { ServiceSection } from "@/components/platform/ServiceSection";
import { ServiceRow } from "@/components/platform/ServiceRow";
import { AiTabNav } from "@/components/platform/AiTabNav";


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
  const reenableJobs = jobs.filter((j) => j.jobId.startsWith("provider-reenable-") && j.nextRunAt && j.nextRunAt < new Date());
  for (const job of reenableJobs) {
    const providerId = job.jobId.replace("provider-reenable-", "");
    await prisma.modelProvider.update({ where: { providerId }, data: { status: "active" } }).catch(() => {});
    await prisma.scheduledJob.update({ where: { jobId: job.jobId }, data: { lastStatus: "completed", lastRunAt: new Date(), schedule: "disabled" } }).catch(() => {});
  }

  // Passive health check for bundled Ollama (may change provider status)
  await checkBundledProviders();

  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  // Bypass React cache for jobs — syncProviderRegistry() may have mutated the DB above.
  const [providers, byProvider, byAgent, freshJobs, detected] = await Promise.all([
    getProviders(),
    getTokenSpendByProvider(currentMonth),
    getTokenSpendByAgent(currentMonth),
    prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
    detectMcpServers(),
  ]);

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>External Services</h1>
        <p style={{ fontSize: 11, color: "#8888a0", marginTop: 2 }}>
          {providers.length} service{providers.length !== 1 ? "s" : ""} registered
          {lastSync ? ` · last synced ${new Date(lastSync).toLocaleDateString()}` : ""}
        </p>
      </div>

      <AiTabNav />

      <DetectedServicesBanner detected={detected} />

      {/* Section 1: External Services Registry */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            External Services
          </div>
          {canWrite && <SyncProvidersButton lastSyncAt={lastSync ?? null} />}
        </div>

        {providers.length === 0 ? (
          <p style={{ color: "#8888a0", fontSize: 11 }}>No services registered. Click &quot;Update Providers&quot; to import.</p>
        ) : (
          groupByEndpointTypeAndCategory(providers).map((group) => (
            <ServiceSection
              key={`${group.endpointType}:${group.category}`}
              endpointType={group.endpointType}
              displayName={group.displayName}
              providers={group.providers}
            >
              {group.providers.map((pw) => (
                <ServiceRow key={pw.provider.providerId} pw={pw} />
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
        <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
          Scheduled Jobs
        </div>
        <ScheduledJobsTable jobs={freshJobs} canWrite={canWrite} />
      </div>
    </div>
  );
}

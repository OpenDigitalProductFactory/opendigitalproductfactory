// apps/web/app/(shell)/platform/ai/providers/page.tsx
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs } from "@/lib/ai-provider-data";
import { syncProviderRegistry } from "@/lib/actions/ai-providers";
import { checkBundledProviders } from "@/lib/ollama";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { SyncProvidersButton } from "@/components/platform/SyncProvidersButton";
import { ProviderStatusToggle } from "@/components/platform/ProviderStatusToggle";
import { getBillingLabel } from "@/lib/ai-provider-types";
import { AiTabNav } from "@/components/platform/AiTabNav";

const STATUS_COLOURS: Record<string, string> = {
  active:        "#4ade80",
  unconfigured:  "#8888a0",
  inactive:      "#fbbf24",
};

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
  const [providers, byProvider, byAgent, freshJobs] = await Promise.all([
    getProviders(),
    getTokenSpendByProvider(currentMonth),
    getTokenSpendByAgent(currentMonth),
    prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
  ]);

  const localProviders = providers.filter((pw) => pw.provider.category === "local");
  const directProviders = providers.filter((pw) => pw.provider.category === "direct");
  const routerProviders = providers.filter((pw) => pw.provider.category === "router");
  const agentProviders = providers.filter((pw) => pw.provider.category === "agent");

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>AI Providers</h1>
        <p style={{ fontSize: 11, color: "#8888a0", marginTop: 2 }}>
          {providers.length} provider{providers.length !== 1 ? "s" : ""} registered ({localProviders.length} local, {directProviders.length} direct, {agentProviders.length} agent, {routerProviders.length} routers)
          {lastSync ? ` · last synced ${new Date(lastSync).toLocaleDateString()}` : ""}
        </p>
      </div>

      <AiTabNav />

      {/* Section 1: Provider Registry */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Providers</div>
          {canWrite && <SyncProvidersButton lastSyncAt={lastSync ?? null} />}
        </div>

        {/* Local Providers */}
        {localProviders.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#4ade80", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Local Providers
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              {localProviders.map(({ provider }) => {
                const colour = STATUS_COLOURS[provider.status] ?? "#8888a0";
                return (
                  <div
                    key={provider.providerId}
                    style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                      <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
                    </div>
                    <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>
                      {provider.families.length > 0
                        ? provider.families.slice(0, 3).join(" · ") + (provider.families.length > 3 ? " +more" : "")
                        : "No models configured"}
                    </div>
                    {(() => {
                      const label = getBillingLabel(provider);
                      return label ? (
                        <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>{label}</div>
                      ) : null;
                    })()}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Link
                        href={`/platform/ai/providers/${provider.providerId}`}
                        style={{ color: "#7c8cf8", fontSize: 10 }}
                      >
                        Configure →
                      </Link>
                      {provider.docsUrl && (
                        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Docs
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Direct Providers */}
        {directProviders.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Direct Providers
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              {directProviders.map(({ provider }) => {
                const colour = STATUS_COLOURS[provider.status] ?? "#8888a0";
                return (
                  <div
                    key={provider.providerId}
                    style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                      <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
                    </div>
                    <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>
                      {provider.families.slice(0, 3).join(" · ")}
                      {provider.families.length > 3 ? " +more" : ""}
                    </div>
                    {(() => {
                      const label = getBillingLabel(provider);
                      return label ? (
                        <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>{label}</div>
                      ) : null;
                    })()}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Link
                        href={`/platform/ai/providers/${provider.providerId}`}
                        style={{ color: "#7c8cf8", fontSize: 10 }}
                      >
                        Configure →
                      </Link>
                      {provider.docsUrl && (
                        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Docs
                        </a>
                      )}
                      {provider.consoleUrl && (
                        <a href={provider.consoleUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Console
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Agent Providers */}
        {agentProviders.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Agent Providers
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              {agentProviders.map(({ provider }) => {
                const colour = STATUS_COLOURS[provider.status] ?? "#8888a0";
                const label = getBillingLabel(provider);
                return (
                  <div
                    key={provider.providerId}
                    style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                      <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
                    </div>
                    <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>
                      {provider.families.slice(0, 3).join(" · ")}
                      {provider.families.length > 3 ? " +more" : ""}
                    </div>
                    {label && (
                      <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>{label}</div>
                    )}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Link
                        href={`/platform/ai/providers/${provider.providerId}`}
                        style={{ color: "#7c8cf8", fontSize: 10 }}
                      >
                        Configure →
                      </Link>
                      {provider.docsUrl && (
                        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Docs
                        </a>
                      )}
                      {provider.consoleUrl && (
                        <a href={provider.consoleUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Console
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Routers & Gateways */}
        {routerProviders.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
              Routers &amp; Gateways
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
              {routerProviders.map(({ provider }) => {
                const colour = STATUS_COLOURS[provider.status] ?? "#8888a0";
                return (
                  <div
                    key={provider.providerId}
                    style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                      <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                      <ProviderStatusToggle providerId={provider.providerId} initialStatus={provider.status} />
                    </div>
                    <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>
                      {provider.families.slice(0, 3).join(" · ")}
                      {provider.families.length > 3 ? " +more" : ""}
                    </div>
                    {(() => {
                      const label = getBillingLabel(provider);
                      return label ? (
                        <div style={{ color: "#8888a0", fontSize: 10, marginBottom: 6 }}>{label}</div>
                      ) : null;
                    })()}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Link
                        href={`/platform/ai/providers/${provider.providerId}`}
                        style={{ color: "#7c8cf8", fontSize: 10 }}
                      >
                        Configure →
                      </Link>
                      {provider.docsUrl && (
                        <a href={provider.docsUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Docs
                        </a>
                      )}
                      {provider.consoleUrl && (
                        <a href={provider.consoleUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#8888a0", fontSize: 10 }}>
                          Console
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {providers.length === 0 && (
          <p style={{ color: "#8888a0", fontSize: 11 }}>No providers registered. Click &quot;Update Providers&quot; to import.</p>
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

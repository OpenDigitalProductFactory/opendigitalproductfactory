// apps/web/app/(shell)/platform/ai/page.tsx
import Link from "next/link";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { getProviders, getTokenSpendByProvider, getTokenSpendByAgent, getScheduledJobs } from "@/lib/ai-provider-data";
import { syncProviderRegistry, triggerProviderSync } from "@/lib/actions/ai-providers";
import { TokenSpendPanel } from "@/components/platform/TokenSpendPanel";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";

async function syncAction(_formData: FormData): Promise<void> {
  "use server";
  await triggerProviderSync();
}

const STATUS_COLOURS: Record<string, string> = {
  active:        "#4ade80",
  unconfigured:  "#fbbf24",
  inactive:      "#555566",
};

export default async function PlatformAiPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections");

  // Auto-sync if due
  const jobs = await getScheduledJobs();
  const syncJob = jobs.find((j) => j.jobId === "provider-registry-sync");
  if (syncJob && syncJob.schedule !== "disabled" && syncJob.nextRunAt && syncJob.nextRunAt < new Date()) {
    await syncProviderRegistry();
  }

  const now = new Date();
  const currentMonth = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  // Bypass React cache for jobs — syncProviderRegistry() may have mutated the DB above.
  const [providers, byProvider, byAgent, freshJobs] = await Promise.all([
    getProviders(),
    getTokenSpendByProvider(currentMonth),
    getTokenSpendByAgent(currentMonth),
    prisma.scheduledJob.findMany({ orderBy: { jobId: "asc" } }),
  ]);

  const lastSync = freshJobs.find((j) => j.jobId === "provider-registry-sync")?.lastRunAt;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>AI Providers</h1>
        <p style={{ fontSize: 11, color: "#555566", marginTop: 2 }}>
          {providers.length} provider{providers.length !== 1 ? "s" : ""} registered
          {lastSync ? ` · last synced ${new Date(lastSync).toLocaleDateString()}` : ""}
        </p>
      </div>

      {/* Section 1: Provider Registry */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>Providers</div>
          {canWrite && (
            <form action={syncAction}>
              <button
                type="submit"
                style={{ fontSize: 10, padding: "3px 10px", background: "transparent", border: "1px solid #2a2a40", color: "#555566", borderRadius: 3, cursor: "pointer" }}
              >
                ↻ Sync from registry
              </button>
            </form>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
          {providers.map(({ provider }) => {
            const colour = STATUS_COLOURS[provider.status] ?? "#555566";
            return (
              <div
                key={provider.providerId}
                style={{ background: "#1a1a2e", border: "1px solid #2a2a40", borderLeft: `3px solid ${colour}`, borderRadius: 6, padding: 10 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <span style={{ color: "#e0e0ff", fontWeight: 600, fontSize: 12 }}>{provider.name}</span>
                  <span style={{ background: `${colour}20`, color: colour, fontSize: 8, padding: "1px 5px", borderRadius: 3 }}>
                    {provider.status}
                  </span>
                </div>
                <div style={{ color: "#555566", fontSize: 9, marginBottom: 6 }}>
                  {provider.families.slice(0, 3).join(" · ")}
                  {provider.families.length > 3 ? " +more" : ""}
                </div>
                <Link
                  href={`/platform/ai/providers/${provider.providerId}`}
                  style={{ color: "#7c8cf8", fontSize: 9 }}
                >
                  Configure →
                </Link>
              </div>
            );
          })}
          {providers.length === 0 && (
            <p style={{ color: "#555566", fontSize: 11 }}>No providers registered. Click &quot;Sync from registry&quot; to import.</p>
          )}
        </div>
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

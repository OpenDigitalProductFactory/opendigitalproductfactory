// apps/web/app/(shell)/platform/tools/catalog/sync/page.tsx
// Moved from /platform/integrations/sync

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { McpSyncButton } from "@/components/platform/McpSyncButton";
import { ScheduledJobsTable } from "@/components/platform/ScheduledJobsTable";
import { getScheduledJobs } from "@/lib/ai-provider-data";
import { runInfraPruneIfDue } from "@/lib/actions/infra-prune";

export default async function IntegrationsSyncPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite =
    !!user &&
    can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_provider_connections"
    );

  // Ensure the infra prune job exists and kick it off if due
  await runInfraPruneIfDue();

  const [recentSyncs, allJobs] = await Promise.all([
    prisma.mcpCatalogSync.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
    }),
    getScheduledJobs(),
  ]);

  const syncJob      = allJobs.filter((j) => j.jobId === "mcp-catalog-sync");
  const infraPruneJob = allJobs.filter((j) => j.jobId === "infra-ci-prune");
  const isRunning = recentSyncs.some((s) => s.status === "running");
  const lastSync = recentSyncs[0] ?? null;

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Integrations Sync</h1>
        <p className="text-muted-foreground text-sm">
          Manages the weekly pull from the MCP Registry and Glama.ai.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Status</h2>
        {lastSync ? (
          <div className="border rounded-lg p-4 space-y-1 text-sm">
            <p>
              Last sync:{" "}
              <strong>{new Date(lastSync.startedAt).toLocaleString()}</strong> —{" "}
              <span
                className={
                  lastSync.status === "success"
                    ? "text-green-600"
                    : lastSync.status === "failed"
                    ? "text-red-600"
                    : "text-yellow-600"
                }
              >
                {lastSync.status}
              </span>
            </p>
            {lastSync.totalFetched != null && (
              <p>
                Fetched {lastSync.totalFetched} · Upserted {lastSync.totalUpserted} · New{" "}
                {lastSync.totalNew} · Removed {lastSync.totalRemoved}
              </p>
            )}
            {lastSync.error && (
              <p className="text-destructive text-xs">{lastSync.error}</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No sync has run yet.</p>
        )}
        {canWrite && <McpSyncButton disabled={isRunning} />}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Schedule</h2>
        <ScheduledJobsTable jobs={syncJob} canWrite={canWrite} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Infrastructure Maintenance</h2>
        <p className="text-muted-foreground text-sm">
          Prunes InfraCI nodes no longer seen by discovery.
          Nodes unseen for 30+ days receive a <em>decommissionedAt</em> timestamp (status unchanged);
          after 90 days they are hard-deleted from the graph.
        </p>
        <ScheduledJobsTable jobs={infraPruneJob} canWrite={canWrite} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sync History</h2>
        <table className="w-full text-sm border rounded-lg overflow-hidden">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Triggered by</th>
              <th className="text-left p-2">Fetched</th>
              <th className="text-left p-2">New</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {recentSyncs.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{new Date(s.startedAt).toLocaleDateString()}</td>
                <td className="p-2">{s.triggeredBy}</td>
                <td className="p-2">{s.totalFetched ?? "—"}</td>
                <td className="p-2">{s.totalNew ?? "—"}</td>
                <td
                  className={`p-2 font-medium ${
                    s.status === "success"
                      ? "text-green-600"
                      : s.status === "failed"
                      ? "text-red-600"
                      : "text-yellow-600"
                  }`}
                >
                  {s.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

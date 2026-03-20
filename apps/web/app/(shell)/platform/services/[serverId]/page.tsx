import { notFound } from "next/navigation";
import Link from "next/link";
import { getMcpServerDetail, deactivateMcpServer } from "@/lib/actions/mcp-services";
import { HealthCheckButton } from "@/components/platform/HealthCheckButton";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const HEALTH_LABELS: Record<string, { text: string; className: string }> = {
  healthy: { text: "Healthy", className: "text-green-600" },
  degraded: { text: "Degraded", className: "text-yellow-600" },
  unreachable: { text: "Unreachable", className: "text-red-600" },
  unknown: { text: "Unknown", className: "text-gray-500" },
};

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const server = await getMcpServerDetail(serverId);
  if (!server) notFound();

  const session = await auth();
  const canWrite = !!session?.user && can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_provider_connections",
  );

  const health = HEALTH_LABELS[server.healthStatus] ?? HEALTH_LABELS.unknown;

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/platform/services" className="text-xs text-muted-foreground hover:underline">
            &larr; Services
          </Link>
          <h1 className="text-2xl font-bold mt-1">{server.name}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
            <span className={`font-medium ${health.className}`}>{health.text}</span>
            {server.transport && <span className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{server.transport.toUpperCase()}</span>}
            {server.category && <span>{server.category}</span>}
          </div>
        </div>
      </div>

      {/* Health */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Health</h2>
        <div className="border rounded-lg p-4 space-y-2 text-sm">
          <p>Status: <span className={`font-medium ${health.className}`}>{health.text}</span></p>
          {server.lastHealthCheck && (
            <p>Last checked: {new Date(server.lastHealthCheck).toLocaleString()}</p>
          )}
          {server.lastHealthError && (
            <p className="text-destructive text-xs">{server.lastHealthError}</p>
          )}
          {canWrite && <HealthCheckButton serverId={server.id} />}
        </div>
      </section>

      {/* Connection Config (redacted) */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Connection</h2>
        <pre className="border rounded-lg p-4 text-xs bg-muted overflow-auto">
          {JSON.stringify(server.config, null, 2)}
        </pre>
      </section>

      {/* Tools */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Tools ({server.tools.length})</h2>
        {server.tools.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tools discovered yet.</p>
        ) : (
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Description</th>
                <th className="text-left p-2 w-20">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {server.tools.map((tool) => (
                <tr key={tool.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{tool.toolName}</td>
                  <td className="p-2 text-muted-foreground">{tool.description ?? "\u2014"}</td>
                  <td className="p-2">
                    <span className={tool.isEnabled ? "text-green-600" : "text-gray-400"}>
                      {tool.isEnabled ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Activation Metadata */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Metadata</h2>
        <div className="border rounded-lg p-4 text-sm space-y-1">
          {server.activatedBy && <p>Activated by: {server.activatedBy}</p>}
          {server.activatedAt && <p>Activated: {new Date(server.activatedAt).toLocaleString()}</p>}
          {server.integration && (
            <p>Catalog entry: <Link href="/platform/integrations" className="text-primary hover:underline">{server.integration.name}</Link></p>
          )}
          {server.deactivatedAt && <p className="text-destructive">Deactivated: {new Date(server.deactivatedAt).toLocaleString()}</p>}
        </div>
      </section>

      {/* Deactivate */}
      {canWrite && server.status !== "deactivated" && (
        <section>
          <form action={async () => { "use server"; await deactivateMcpServer(server.id); }}>
            <button type="submit" className="px-4 py-2 rounded border border-destructive text-destructive text-sm hover:bg-destructive/10">
              Deactivate Service
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

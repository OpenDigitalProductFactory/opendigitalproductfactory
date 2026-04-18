import Link from "next/link";

type McpServerSummary = {
  id: string;
  serverId: string;
  name: string;
  status: string;
  transport: string | null;
  healthStatus: string;
  category: string | null;
  lastHealthCheck: Date | null;
  _count: { tools: number };
  integration: { logoUrl: string | null } | null;
};

const HEALTH_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  unreachable: "bg-red-500",
  unknown: "bg-gray-400",
};

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: "STDIO",
  sse: "SSE",
  http: "HTTP",
};

export function ServiceCard({ server }: { server: McpServerSummary }) {
  const healthColor = HEALTH_COLORS[server.healthStatus] ?? HEALTH_COLORS.unknown;

  return (
    <Link
      href={`/platform/tools/services/${server.id}`}
      className="border rounded-lg p-4 flex flex-col gap-2 hover:shadow-md transition-shadow bg-card"
    >
      <div className="flex items-start gap-3">
        {server.integration?.logoUrl ? (
          <img src={server.integration.logoUrl} alt="" className="w-10 h-10 rounded object-contain" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
            {server.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{server.name}</span>
            <span className={`w-2 h-2 rounded-full ${healthColor}`} title={server.healthStatus} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {server.transport && (
              <span className="bg-muted px-1.5 py-0.5 rounded font-mono">
                {TRANSPORT_LABELS[server.transport] ?? server.transport}
              </span>
            )}
            {server.category && <span>{server.category}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto pt-1 text-xs text-muted-foreground">
        <span>{server._count.tools} tool{server._count.tools !== 1 ? "s" : ""}</span>
        {server.lastHealthCheck && (
          <span>Checked {new Date(server.lastHealthCheck).toLocaleDateString()}</span>
        )}
      </div>
    </Link>
  );
}

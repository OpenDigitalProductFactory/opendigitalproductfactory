import { queryMcpServers } from "@/lib/actions/mcp-services";
import { ServiceCard } from "@/components/platform/ServiceCard";
import Link from "next/link";

export default async function ServicesPage() {
  const [activeServers, unconfigured] = await Promise.all([
    queryMcpServers({}),
    queryMcpServers({ status: "unconfigured" }),
  ]);

  const registered = activeServers.filter((s) => s.status !== "unconfigured");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">External Services</h1>
          <p className="text-muted-foreground text-sm">
            {registered.length} registered MCP service{registered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/platform/services/activate"
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
        >
          Register New
        </Link>
      </div>

      {unconfigured.length > 0 && (
        <div className="border border-dashed rounded-lg p-4 bg-muted/50">
          <h2 className="text-sm font-semibold mb-2">
            Detected ({unconfigured.length})
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            These MCP servers were detected but not yet configured.
          </p>
          <div className="flex flex-wrap gap-2">
            {unconfigured.map((s) => (
              <Link
                key={s.id}
                href={`/platform/services/activate?serverId=${s.id}`}
                className="px-3 py-1.5 rounded border text-sm hover:bg-muted"
              >
                {s.name} — Configure
              </Link>
            ))}
          </div>
        </div>
      )}

      {registered.length === 0 ? (
        <p className="text-muted-foreground text-sm py-12 text-center">
          No registered services yet. Browse the{" "}
          <Link href="/platform/integrations" className="text-primary hover:underline">
            Integrations Catalog
          </Link>{" "}
          to find services to activate.
        </p>
      ) : (
        <>
          {Object.entries(
            registered.reduce<Record<string, typeof registered>>((groups, server) => {
              const cat = server.category ?? "uncategorized";
              (groups[cat] ??= []).push(server);
              return groups;
            }, {})
          ).sort(([a], [b]) => a.localeCompare(b)).map(([category, servers]) => (
            <div key={category} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground capitalize">{category}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {servers.map((server) => (
                  <ServiceCard key={server.id} server={server as never} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

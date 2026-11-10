// apps/web/app/(shell)/platform/tools/services/[serverId]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getMcpServerDetail, deactivateMcpServer } from "@/lib/actions/mcp-services";
import { HealthCheckButton } from "@/components/platform/HealthCheckButton";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { LocalTime } from "@/components/ui/LocalTime";
import { McpToolReviewList, type McpToolReviewRow } from "@/components/platform/McpToolReviewList";
import { DISCOVERED_TOOL_REASON_TEXT, sanitizeModelVisibleToolText } from "@/lib/tak/mcp-tool-policy";
import { knownGrantKeys } from "@/lib/tak/agent-grants";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";

const HEALTH_LABELS: Record<string, { text: string; className: string }> = {
  healthy: { text: "Healthy", className: "text-[var(--dpf-success)]" },
  degraded: { text: "Degraded", className: "text-[var(--dpf-warning)]" },
  unreachable: { text: "Unreachable", className: "text-[var(--dpf-error)]" },
  unknown: { text: "Unknown", className: "text-[var(--dpf-muted)]" },
};

export default async function ToolsServiceDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const server = await getMcpServerDetail(serverId);
  if (!server) notFound();

  const session = await auth();
  const locale = await getLocaleContext();
  const canWrite = !!session?.user && can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_provider_connections",
  );

  const health = HEALTH_LABELS[server.healthStatus] ?? { text: "Unknown", className: "text-[var(--dpf-muted)]" };

  // BI-8B7B2FE9: review rows show the sanitized text a coworker would read.
  const reviewRows: McpToolReviewRow[] = server.tools.map((tool) => {
    const now = sanitizeModelVisibleToolText(tool.description, tool.inputSchema);
    const approved = tool.contentChanged && tool.approvedInputSchema !== null
      ? sanitizeModelVisibleToolText(tool.approvedDescription, tool.approvedInputSchema)
      : null;
    return {
      id: tool.id,
      toolName: tool.toolName,
      policyClass: tool.review.policyClass,
      reasonText: tool.review.reason ? DISCOVERED_TOOL_REASON_TEXT[tool.review.reason] : null,
      contentDigest: tool.contentDigest,
      contentChanged: tool.contentChanged,
      description: now.description,
      inputSchemaText: JSON.stringify(now.inputSchema, null, 2),
      approvedDescription: approved ? approved.description : null,
      approvedInputSchemaText: approved ? JSON.stringify(approved.inputSchema, null, 2) : null,
      grantKey: tool.policyGrantKey,
      effect: tool.policyEffect,
    };
  });

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/platform/tools/services" className="text-xs text-muted-foreground hover:underline">
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
            <p>Last checked: <LocalTime value={server.lastHealthCheck} /></p>
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
          <p className="text-sm text-[var(--dpf-muted)]">No tools discovered yet.</p>
        ) : (
          <MessagesProvider locale={locale.language} messages={{ mcpTools: namespaceMessages(locale.language, "mcpTools") }}>
            <McpToolReviewList tools={reviewRows} canReview={canWrite} grantOptions={knownGrantKeys()} />
          </MessagesProvider>
        )}
      </section>

      {/* Activation Metadata */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Metadata</h2>
        <div className="border rounded-lg p-4 text-sm space-y-1">
          {server.activatedBy && <p>Activated by: {server.activatedBy}</p>}
          {server.activatedAt && <p>Activated: <LocalTime value={server.activatedAt} /></p>}
          {server.integration && (
            <p>Catalog entry: <Link href="/platform/tools/catalog" className="text-primary hover:underline">{server.integration.name}</Link></p>
          )}
          {server.deactivatedAt && <p className="text-destructive">Deactivated: <LocalTime value={server.deactivatedAt} /></p>}
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

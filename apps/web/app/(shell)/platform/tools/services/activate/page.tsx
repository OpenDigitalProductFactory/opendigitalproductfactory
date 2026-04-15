// apps/web/app/(shell)/platform/tools/services/activate/page.tsx
import { prisma } from "@dpf/db";
import { ServiceActivationForm } from "@/components/platform/ServiceActivationForm";
import Link from "next/link";

type SearchParams = Promise<{ integrationId?: string; serverId?: string }>;

export default async function ToolsActivateServicePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { integrationId, serverId } = await searchParams;

  let prefillName: string | undefined;
  let prefillCategory: string | undefined;
  let prefillServerId: string | undefined;

  if (integrationId) {
    const integration = await prisma.mcpIntegration.findUnique({
      where: { id: integrationId },
      select: { name: true, slug: true, category: true },
    });
    if (integration) {
      prefillName = integration.name;
      prefillCategory = integration.category;
      prefillServerId = integration.slug;
    }
  }

  if (serverId) {
    const server = await prisma.mcpServer.findUnique({
      where: { id: serverId },
      select: { name: true, serverId: true },
    });
    if (server) {
      prefillName = server.name;
      prefillServerId = server.serverId;
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <Link href="/platform/tools/services" className="text-xs text-muted-foreground hover:underline">
        &larr; Services
      </Link>
      <h1 className="text-2xl font-bold mt-2">
        {integrationId ? "Activate Integration" : "Register MCP Service"}
      </h1>
      <p className="text-muted-foreground text-sm mt-1 mb-6">
        {integrationId
          ? "Provide connection details for this catalog integration."
          : "Manually register an MCP server with connection details."}
      </p>

      <ServiceActivationForm
        {...(integrationId ? { integrationId } : {})}
        {...(prefillName ? { prefillName } : {})}
        {...(prefillCategory ? { prefillCategory } : {})}
        {...(prefillServerId ? { prefillServerId } : {})}
      />
    </div>
  );
}

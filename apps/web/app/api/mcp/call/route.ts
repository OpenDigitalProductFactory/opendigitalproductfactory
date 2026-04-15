import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
// mcp-tools is imported dynamically to avoid NFT whole-project tracing (fs/child_process operations)

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { name?: string; arguments?: Record<string, unknown> };
  if (!body.name) {
    return Response.json({ error: "Missing tool name" }, { status: 400 });
  }

  const { PLATFORM_TOOLS, executeTool } = await import(/* turbopackIgnore: true */ "../../../../lib/mcp-tools");

  const tool = PLATFORM_TOOLS.find((t) => t.name === body.name);
  if (!tool) {
    return Response.json({ error: `Unknown tool: ${body.name}` }, { status: 404 });
  }

  if (
    tool.requiredCapability &&
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      tool.requiredCapability,
    )
  ) {
    return Response.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  const result = await executeTool(body.name, body.arguments ?? {}, session.user.id);
  return Response.json(result);
}

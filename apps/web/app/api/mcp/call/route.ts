import { auth } from "@/lib/auth";

// Lazy-load mcp-governed-execute (and through it, mcp-tools) to avoid bundling
// child_process at module init. Uses a normal dynamic import so Turbopack
// resolves @/lib correctly.
const getGovernedExecute = () => import("@/lib/mcp-governed-execute");

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name?: string;
    arguments?: Record<string, unknown>;
    agentId?: string;
    threadId?: string;
    routeContext?: string;
  };
  if (!body.name) {
    return Response.json({ error: "Missing tool name" }, { status: 400 });
  }

  const { governedExecuteTool } = await getGovernedExecute();

  const result = await governedExecuteTool({
    toolName: body.name,
    rawParams: body.arguments ?? {},
    userId: session.user.id,
    userContext: {
      platformRole: session.user.platformRole,
      isSuperuser: session.user.isSuperuser,
    },
    context: {
      agentId: body.agentId,
      threadId: body.threadId,
      routeContext: body.routeContext,
    },
    source: "rest",
  });

  // Map governance rejections to HTTP status codes for REST callers that key
  // off status. The body still carries the structured ToolResult for clients
  // that prefer the JSON shape.
  if (result.governance?.rejected === "unknown_tool") {
    return Response.json(result, { status: 404 });
  }
  if (
    result.governance?.rejected === "forbidden_capability" ||
    result.governance?.rejected === "forbidden_grant"
  ) {
    return Response.json(result, { status: 403 });
  }

  return Response.json(result);
}

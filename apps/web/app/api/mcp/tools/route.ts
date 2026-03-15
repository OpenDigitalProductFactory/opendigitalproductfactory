import { auth } from "@/lib/auth";
import { getAvailableTools } from "@/lib/mcp-tools";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tools = getAvailableTools({
    platformRole: session.user.platformRole,
    isSuperuser: session.user.isSuperuser,
  });

  return Response.json({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  });
}

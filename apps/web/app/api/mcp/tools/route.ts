import { auth } from "@/lib/auth";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { getAvailableTools } = await import("@/lib/mcp-tools");
  const tools = await getAvailableTools({
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

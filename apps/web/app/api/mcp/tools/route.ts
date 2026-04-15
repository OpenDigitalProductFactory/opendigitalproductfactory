import { auth } from "@/lib/auth";
// mcp-tools is imported dynamically to avoid NFT whole-project tracing

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { getAvailableTools } = await import(/* turbopackIgnore: true */ "../../../../lib/mcp-tools");
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

/**
 * GET /api/diagnostics/probe
 *
 * Live integration test: sends a real (minimal) inference call through
 * each coworker route to verify the full runtime chain works.
 *
 * Tests: agent resolution, prompt assembly, routing, provider auth,
 * model response, tool capability, and rate tracking.
 *
 * Costs real tokens (~14 tiny calls). Takes 30-120s depending on providers.
 * Requires admin auth.
 *
 * Query params:
 *   ?routes=build,ops       — test only specific routes (comma-separated)
 *   ?includeTools=true       — also test tool-using inference (Build Studio path)
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@dpf/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type ProbeResult = {
  route: string;
  agentId: string;
  agentName: string;
  status: "pass" | "fail" | "warn";
  message: string;
  providerId?: string;
  modelId?: string;
  inputTokens?: number;
  outputTokens?: number;
  downgraded?: boolean;
  toolsStripped?: boolean;
  durationMs: number;
  error?: string;
};

// Minimal routes to probe — covers all coworker paths
const PROBE_ROUTES: Array<{ route: string; probe: string }> = [
  { route: "/workspace", probe: "What is the current status of the platform?" },
  { route: "/portfolio", probe: "Summarize portfolio health in one sentence." },
  { route: "/inventory", probe: "How many products are in production stage?" },
  { route: "/ops", probe: "What is the top backlog item?" },
  { route: "/build", probe: "What build phase are we in?" },
  { route: "/employee", probe: "How many active employees are there?" },
  { route: "/customer", probe: "Summarize customer pipeline status." },
  { route: "/compliance", probe: "What is the current compliance posture?" },
  { route: "/platform", probe: "Which AI providers are active?" },
  { route: "/admin", probe: "What admin tasks are pending?" },
  { route: "/storefront", probe: "Is the storefront configured?" },
  { route: "/ea", probe: "What EA elements exist?" },
  { route: "/docs", probe: "What documentation exists?" },
  { route: "/setup", probe: "Is initial setup complete?" },
];

export async function GET(request: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperuser: true },
  });
  if (!user?.isSuperuser) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // Parse query params
  const searchParams = request.nextUrl.searchParams;
  const routeFilter = searchParams.get("routes")?.split(",").map(r =>
    r.startsWith("/") ? r : `/${r}`,
  );
  const includeTools = searchParams.get("includeTools") === "true";

  const routesToTest = routeFilter
    ? PROBE_ROUTES.filter(r => routeFilter.some(f => r.route.startsWith(f)))
    : PROBE_ROUTES;

  if (routesToTest.length === 0) {
    return NextResponse.json({
      error: `No matching routes. Available: ${PROBE_ROUTES.map(r => r.route).join(", ")}`,
    }, { status: 400 });
  }

  // Import dependencies
  const { resolveAgentForRoute } = await import("@/lib/tak/agent-routing");
  const { routeAndCall } = await import("@/lib/inference/routed-inference");
  const { getAvailableTools, toolsToOpenAIFormat } = await import("@/lib/mcp-tools");

  const results: ProbeResult[] = [];
  const overallStart = Date.now();
  const userContext = { userId: session.user!.id, platformRole: "HR-400", isSuperuser: true };

  // Run probes sequentially to avoid rate-limit cascading
  for (const { route, probe } of routesToTest) {
    const start = Date.now();
    const agent = resolveAgentForRoute(route, userContext);

    try {
      // Build minimal system prompt
      const systemPrompt = `You are ${agent.agentName}. Reply in one short sentence. Do not use tools.`;
      const messages = [{ role: "user" as const, content: probe }];

      const result = await routeAndCall(messages, systemPrompt, agent.sensitivity, {
        taskType: "conversation",
        persistDecision: false,
        requireTools: false,
        effort: "low",
      });

      const probeResult: ProbeResult = {
        route,
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: result.downgraded ? "warn" : "pass",
        message: result.content.slice(0, 200),
        providerId: result.providerId,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        downgraded: result.downgraded,
        toolsStripped: result.toolsStripped,
        durationMs: Date.now() - start,
      };

      if (result.downgraded && result.downgradeMessage) {
        probeResult.message = `[DOWNGRADED: ${result.downgradeMessage}] ${result.content.slice(0, 150)}`;
      }

      results.push(probeResult);
    } catch (err) {
      results.push({
        route,
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: "fail",
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.constructor.name : "Unknown",
      });
    }
  }

  // Optional: tool-using probe for Build Studio path
  if (includeTools) {
    const start = Date.now();
    const buildAgent = resolveAgentForRoute("/build", userContext);
    try {
      const tools = await getAvailableTools(userContext, { mode: "act", agentId: buildAgent.agentId });
      const openAiTools = toolsToOpenAIFormat(tools);

      const systemPrompt = `You are ${buildAgent.agentName}. The user wants to test tool availability. Call the list_sandbox_files tool to verify sandbox access. If you cannot use tools, say so.`;
      const messages = [{ role: "user" as const, content: "List sandbox files to verify tool access." }];

      const result = await routeAndCall(messages, systemPrompt, "internal", {
        taskType: "agentic",
        tools: openAiTools,
        persistDecision: false,
        requireTools: true,
        effort: "low",
      });

      results.push({
        route: "/build (with tools)",
        agentId: buildAgent.agentId,
        agentName: "Build Studio (tool probe)",
        status: result.toolsStripped ? "fail" : result.toolCalls.length > 0 ? "pass" : "warn",
        message: result.toolsStripped
          ? "Tools were stripped — no tool-capable model available for Build Studio"
          : result.toolCalls.length > 0
            ? `Tool call: ${result.toolCalls[0]!.name} — tools working`
            : `Model responded without using tools: ${result.content.slice(0, 100)}`,
        providerId: result.providerId,
        modelId: result.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        downgraded: result.downgraded,
        toolsStripped: result.toolsStripped,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      results.push({
        route: "/build (with tools)",
        agentId: buildAgent.agentId,
        agentName: "Build Studio (tool probe)",
        status: "fail",
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.constructor.name : "Unknown",
      });
    }
  }

  // Summary
  const passed = results.filter(r => r.status === "pass").length;
  const failed = results.filter(r => r.status === "fail").length;
  const warnings = results.filter(r => r.status === "warn").length;
  const totalMs = Date.now() - overallStart;
  const totalTokens = results.reduce((sum, r) => sum + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);

  return NextResponse.json({
    status: failed > 0 ? "fail" : warnings > 0 ? "warn" : "pass",
    summary: `${passed} pass, ${failed} fail, ${warnings} warn — ${totalMs}ms, ${totalTokens} tokens`,
    results,
    timestamp: new Date().toISOString(),
  });
}

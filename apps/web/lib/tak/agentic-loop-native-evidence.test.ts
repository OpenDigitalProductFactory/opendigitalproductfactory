// BI-5B920631: a coworker chat turn on a native-MCP adapter (Claude CLI,
// codex-cli) runs its platform tools inside the CLI session. The server records
// each call as a ToolExecution row (executionMode "internal-mcp-session", this
// taskRunId) and the adapter returns prose with no parsed toolCalls.
//
// Observed 2026-11-14 on the COO (/coworker-decisions/review): the loop folded
// those rows only under a terminal-tool or read-evidence policy, so an ordinary
// live-data turn saw zero executions and INV-1 replaced a tool-backed answer
// with "The request is unfinished". The non-acting bridge likewise passed
// toolCallCount 0, so an acting tool-action turn would be failed over.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string; taskRunId: string | null; toolName: string; parameters: Record<string, unknown>;
  result: Record<string, unknown>; success: boolean; executionMode: string; createdAt: Date;
};
const table = vi.hoisted(() => ({ rows: [] as Row[] }));

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: {
    create: vi.fn(),
    findMany: vi.fn(async (args?: { where?: { taskRunId?: string; executionMode?: string; createdAt?: { gte?: Date } } }) => {
      const where = args?.where ?? {};
      return table.rows.filter((row) =>
        (where.taskRunId === undefined || row.taskRunId === where.taskRunId)
        && (where.executionMode === undefined || row.executionMode === where.executionMode)
        && (where.createdAt?.gte === undefined || row.createdAt.getTime() >= where.createdAt.gte.getTime()));
    }),
    findFirst: vi.fn(async () => null),
  },
  routeDecisionLog: { updateMany: vi.fn() },
  platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []), executeTool: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/observability/heartbeat", () => ({
  heartbeat: vi.fn(async () => true),
  withHeartbeatTicker: vi.fn(async (_taskRunId: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("@/lib/routing/record-non-acting-failure", () => ({ recordNonActingFailure: vi.fn(async () => undefined) }));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { recordNonActingFailure } from "@/lib/routing/record-non-acting-failure";
import { runAgenticLoop } from "./agentic-loop";
import { classifyEvidenceRequirement, INV5_UNVERIFIED_MESSAGE } from "./evidence-requirement";
import { resolveRouteContext } from "./route-context-map";

const TASK_RUN_ID = "TR-CHAT-native-evidence";
const ROUTE = "/coworker-decisions/review";
const ASK = "Work the decision queue: list the open decision reviews, check the live state of each subject, tell me which are moot and should be closed, and give me your recommendation on the rest so I can rule on them here.";
const ANSWER = "Three open reviews. DI-12FD5B8BDE8E and DI-BD8CB44CBFDC are moot: their subject BI-F63200A8 is done. "
  + "DI-AB432BFF8956 needs your ruling; I recommend option 1.";

const cliProse = (content: string, providerId = "anthropic-sub") => ({
  content, truncated: false, toolCalls: [], inputTokens: 1200, outputTokens: 300,
  providerId, modelId: "claude-haiku-4-5-20251001", downgraded: false,
  downgradeMessage: null, downgradeReason: null, toolsStripped: false, routeDecision: {},
});

let seq = 0;
const nativeRead = (toolName: string): Row => ({
  id: `te-${++seq}`, taskRunId: TASK_RUN_ID, toolName, parameters: {},
  // Reader rows are auditClass=metrics_only and persist result {}.
  result: {}, success: true, executionMode: "internal-mcp-session", createdAt: new Date(),
});

const toolNames = ["list_open_decision_reviews", "get_backlog_item"];
const params = {
  chatHistory: [{ role: "user" as const, content: ASK }],
  systemPrompt: "You are the COO.",
  sensitivity: "internal" as const,
  tools: toolNames.map((name) => ({ name, description: name, inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: false })),
  toolsForProvider: toolNames.map((name) => ({ type: "function", function: { name, parameters: {} } })),
  userId: "user-1", agentId: "coo", threadId: "thread-coo", routeContext: ROUTE,
  interactionMode: "chat" as const, taskRunId: TASK_RUN_ID,
};

beforeEach(() => {
  vi.clearAllMocks();
  table.rows = [];
  seq = 0;
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: false,
    groups: [{ platformRole: { roleId: "admin" } }] } as never);
});

describe("BI-5B920631 native-MCP executions count for live-data evidence", () => {
  it("the decision-queue ask on this route owes live evidence (precondition)", () => {
    const requirement = classifyEvidenceRequirement({
      routeContext: ROUTE, domainTools: resolveRouteContext(ROUTE).domainTools, message: ASK,
    });
    expect(requirement.required).toBe(true);
  });

  it("keeps a chat answer whose tools ran natively instead of declaring it unfinished", async () => {
    vi.mocked(routeAndCall).mockImplementation(async () => {
      table.rows.push(nativeRead("list_open_decision_reviews"), nativeRead("get_backlog_item"));
      return cliProse(ANSWER) as never;
    });
    const result = await runAgenticLoop({ ...params, taskType: "status-query" });
    expect(result.content).not.toBe(INV5_UNVERIFIED_MESSAGE);
    expect(result.content).toContain("DI-AB432BFF8956");
  });

  it("still withholds a live-data answer when nothing ran", async () => {
    vi.mocked(routeAndCall).mockResolvedValue(cliProse(ANSWER) as never);
    const result = await runAgenticLoop({ ...params, taskType: "status-query" });
    expect(result.content).not.toContain("DI-AB432BFF8956");
  });

  it("does not count a tool-action turn that acted natively as non-acting", async () => {
    vi.mocked(routeAndCall).mockImplementation(async () => {
      table.rows.push(nativeRead("list_open_decision_reviews"));
      return cliProse(ANSWER) as never;
    });
    await runAgenticLoop({ ...params, taskType: "tool-action" });
    expect(recordNonActingFailure).not.toHaveBeenCalled();
    expect(routeAndCall).toHaveBeenCalledTimes(1);
  });
});

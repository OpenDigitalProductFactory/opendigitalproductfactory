// BI-2E479619 (and BI-907D6878 AC-1): a Claude CLI turn executes the platform
// tools itself through its --mcp-config session. The server records each call
// as a ToolExecution row (executionMode "internal-mcp-session", this taskRunId),
// but the adapter drops mcp__dpf__* calls from its parsed toolCalls, so today the
// loop judges the turn with zero tool records and calls a reviewer that read the
// artifact and minted a receipt "prose without the required writer".
//
// These tests stub only the ToolExecution reader (prisma.toolExecution.findMany,
// a filtered in-memory table) and the routed inference. They pin behaviour, not
// the shape of the fix.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string; taskRunId: string | null; threadId: string | null; toolName: string;
  parameters: Record<string, unknown>; result: Record<string, unknown>;
  success: boolean; executionMode: string; createdAt: Date;
};
const table = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
    const c = condition as Record<string, unknown>;
    if ("in" in c) return (c["in"] as unknown[]).includes(value);
    if ("not" in c) return value !== c["not"];
    const t = value instanceof Date ? value.getTime() : Number.NaN;
    const at = (k: string) => (c[k] instanceof Date ? (c[k] as Date).getTime() : Date.parse(String(c[k])));
    if ("gte" in c && !(t >= at("gte"))) return false;
    if ("gt" in c && !(t > at("gt"))) return false;
    if ("lte" in c && !(t <= at("lte"))) return false;
    if ("lt" in c && !(t < at("lt"))) return false;
    return true;
  }
  return value === condition;
}
function findRows(args?: { where?: Record<string, unknown>; orderBy?: unknown }) {
  const where = args?.where ?? {};
  return table.rows
    .filter((row) => Object.entries(where).every(([key, condition]) => matches((row as Record<string, unknown>)[key], condition)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: {
    create: vi.fn(),
    findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args)),
    findFirst: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args).at(-1) ?? null),
  },
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
vi.mock("./terminal-tool-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./terminal-tool-policy")>();
  return { ...actual, resolveTerminalTextExit: vi.fn(actual.resolveTerminalTextExit) };
});

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { resolveTerminalTextExit } from "./terminal-tool-policy";
import { runAgenticLoop } from "./agentic-loop";

const TASK_RUN_ID = "TR-MCP-NATIVE-6C272F7C1DAE";
const THREAD_ID = "thread-native-review";
const writer = "record_initiative_design_review";
const reader = "read_source_at_version";
const RECEIPT_ID = "initiative-628e7bbd-ced2-4f4a-b2fc-0d82d36e42ae";

// What the CLI adapter returns today for a native-MCP turn: the narration only.
const cliProse = (content: string) => ({
  content, truncated: false, toolCalls: [], inputTokens: 1200, outputTokens: 300,
  providerId: "anthropic-sub", modelId: "claude-opus-4-6", downgraded: false,
  downgradeMessage: null, downgradeReason: null, toolsStripped: false, routeDecision: {},
});

let seq = 0;
function nativeRow(toolName: string, result: Record<string, unknown>, success: boolean, patch: Partial<Row> = {}): Row {
  seq += 1;
  return {
    id: `te-${seq}`, taskRunId: TASK_RUN_ID, threadId: THREAD_ID, toolName,
    parameters: toolName === reader
      ? { repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", path: "docs/spec.md", version: "a".repeat(40), expectedBlobId: "b".repeat(40) }
      : { itemId: "BI-C8EC05C9", gate: "design-spec", decision: "pass" },
    // Live reader rows are auditClass=metrics_only and persist result {}.
    result, success, executionMode: "internal-mcp-session", createdAt: new Date(), ...patch,
  };
}
const nativeRead = (patch: Partial<Row> = {}) => nativeRow(reader, {}, true, patch);
const nativeWriterSuccess = () => nativeRow(writer, {
  success: true, entityId: RECEIPT_ID, message: "design-spec receipt recorded for BI-C8EC05C9.",
  data: { receiptId: RECEIPT_ID },
}, true);
const nativeWriterRefused = () => nativeRow(writer, {
  success: false, error: "CANONICAL_DESIGN_REQUIRED", message: "AC-CHAR has a malformed objective link.",
}, false);

const params = {
  chatHistory: [{ role: "user" as const, content: "Review the bound design and record the governed assessment." }],
  systemPrompt: "Read the immutable evidence, then record your independent assessment.",
  sensitivity: "internal" as const,
  tools: [reader, writer].map((name) => ({ name, description: name, inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: name === writer })),
  toolsForProvider: [reader, writer].map((name) => ({ type: "function", function: { name, parameters: {} } })),
  userId: "user-1", agentId: "AGT-WS-REVIEW", threadId: THREAD_ID, routeContext: "/platform/build",
  taskType: "external-mcp", interactionMode: "autonomous" as const, taskRunId: TASK_RUN_ID,
  terminalToolPolicy: { writerToolName: writer, readerToolNames: [reader],
    minimumSuccessfulReaderCalls: 1, maximumReaderCalls: 6 },
};

beforeEach(() => {
  vi.clearAllMocks();
  table.rows = [];
  seq = 0;
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: false,
    groups: [{ platformRole: { roleId: "developer" } }] } as never);
  vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "unexpected loop-side dispatch" });
});

describe("BI-2E479619 native-MCP tool calls are visible to the terminal-writer policy", () => {
  it("AC-1: a CLI turn whose only tool calls were native reaches resolveTerminalTextExit with those calls in its records", async () => {
    // Rows that must NOT be folded in: an earlier attempt on the same TaskRun
    // (before this turn started) and a concurrent reviewer's run.
    table.rows.push(
      nativeRead({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }),
      nativeRead({ taskRunId: "TR-MCP-OTHER-9B1B37904AC1", threadId: "thread-other" }),
    );
    vi.mocked(routeAndCall).mockImplementation(async () => {
      // The CLI executes these through /api/mcp/v1 during the turn.
      table.rows.push(nativeRead(), nativeRead(), nativeWriterSuccess());
      return cliProse("I reviewed the design and recorded a pass.") as never;
    });

    await runAgenticLoop(params);

    const firstExit = vi.mocked(resolveTerminalTextExit).mock.calls[0];
    expect(firstExit, "resolveTerminalTextExit was never reached").toBeDefined();
    const records = firstExit![1];
    expect(records.map((record) => record.name)).toEqual([reader, reader, writer]);
    expect(records.at(-1)).toMatchObject({ name: writer, result: { success: true, data: { receiptId: RECEIPT_ID } } });
  });

  it("AC-1: native reads with no writer still reach the policy as reader records", async () => {
    vi.mocked(routeAndCall).mockImplementation(async () => {
      if (vi.mocked(routeAndCall).mock.calls.length === 1) table.rows.push(nativeRead(), nativeRead());
      return cliProse("The design looks sound overall.") as never;
    });

    await runAgenticLoop(params);

    const records = vi.mocked(resolveTerminalTextExit).mock.calls[0]![1];
    expect(records.map((record) => record.name)).toEqual([reader, reader]);
  });

  it("AC-2: a successful native writer ends the run as complete, with the native calls in executedTools", async () => {
    vi.mocked(routeAndCall).mockImplementation(async () => {
      if (vi.mocked(routeAndCall).mock.calls.length === 1) table.rows.push(nativeRead(), nativeRead(), nativeRead(), nativeWriterSuccess());
      return cliProse("Recorded design-spec pass.") as never;
    });

    const outcome = await runAgenticLoop(params);

    expect(outcome.failure).toBeUndefined();
    expect(outcome.content).not.toContain("did not honor the required writer tool-call contract");
    expect(outcome.content).not.toContain("No receipt was created");
    expect(outcome.executedTools.map((tool) => tool.name)).toEqual([reader, reader, reader, writer]);
  });

  it("does not dispatch another CLI turn (which could mint a second receipt) after a successful native writer", async () => {
    vi.mocked(routeAndCall).mockImplementation(async () => {
      if (vi.mocked(routeAndCall).mock.calls.length === 1) table.rows.push(nativeRead(), nativeWriterSuccess());
      return cliProse("Recorded design-spec pass.") as never;
    });

    await runAgenticLoop(params);

    expect(routeAndCall).toHaveBeenCalledTimes(1);
    expect(governedExecuteTool).not.toHaveBeenCalled();
  });

  it("keeps a refused native writer not-complete (the ...9B1B37904AC1 shape)", async () => {
    vi.mocked(routeAndCall).mockImplementation(async () => {
      if (vi.mocked(routeAndCall).mock.calls.length === 1) table.rows.push(nativeRead(), nativeWriterRefused());
      return cliProse("The writer refused the packet.") as never;
    });

    const outcome = await runAgenticLoop(params);

    expect(outcome.failure?.kind).toBe("terminal-writer-missing");
    expect(outcome.executedTools.some((tool) => tool.name === writer && tool.result.success)).toBe(false);
  });
});

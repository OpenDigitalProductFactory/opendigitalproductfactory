import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: { create: vi.fn() }, platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []) }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop } from "./agentic-loop";

const writer = "record_initiative_design_review";
const reader = "read_source_at_version";
const reply = (toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) => ({
  content: "Continuing the review.", truncated: false, toolCalls, inputTokens: 10, outputTokens: 20,
  providerId: "local", modelId: "review-model", downgraded: false,
  downgradeMessage: null, toolsStripped: false, routeDecision: {},
});

describe("canonical design writer refusal stops the reviewer (BI-93A0E9A7)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: true,
      groups: [{ platformRole: { roleId: "ceo" } }] } as never);
  });

  it("ends on the writer refusal and does not run a later conflicting reader", async () => {
    vi.mocked(governedExecuteTool).mockImplementation(async ({ toolName }: { toolName: string }) => {
      if (toolName === writer) return {
        success: false,
        error: "CANONICAL_DESIGN_REQUIRED",
        message: "The artifact has no marked objective statements.",
      };
      return { success: false, error: "terminal_reader_identity_conflict", message: "Reader identity does not match the bound source." };
    });
    vi.mocked(routeAndCall)
      .mockResolvedValueOnce(reply([{ id: "write-1", name: writer, arguments: { decision: "pass" } }]) as never)
      .mockResolvedValue(reply([{ id: "read-1", name: reader, arguments: { version: "f".repeat(40), path: "docs/other.md" } }]) as never);

    const outcome = await runAgenticLoop({
      chatHistory: [{ role: "user", content: "Review the bound design." }],
      systemPrompt: "Record your independent assessment.",
      sensitivity: "internal",
      tools: [reader, writer].map((name) => ({
        name, description: name, inputSchema: {}, requiredCapability: null,
        executionMode: "immediate" as const, sideEffect: name === writer,
      })),
      toolsForProvider: [reader, writer].map((name) => ({ type: "function", function: { name, parameters: {} } })),
      userId: "user-1", agentId: "reviewer", threadId: "thread-1", routeContext: "/review",
      taskType: "external-mcp", interactionMode: "autonomous",
      terminalToolPolicy: {
        writerToolName: writer,
        readerToolNames: [reader],
        minimumSuccessfulReaderCalls: 1,
        maximumReaderCalls: 6,
        terminalPhase: "writer-only" as const,
        persistedEvidenceAvailable: true,
        immutableReaderArguments: {
          repositoryFullName: "org/repo",
          path: "docs/superpowers/specs/design.md",
          version: "a".repeat(40),
          expectedBlobId: "b".repeat(40),
        },
      },
    });

    expect(routeAndCall).toHaveBeenCalledTimes(1);
    expect(governedExecuteTool).toHaveBeenCalledTimes(1);
    expect(vi.mocked(governedExecuteTool).mock.calls[0]?.[0].toolName).toBe(writer);
    expect(outcome.failure?.kind).toBe("terminal-writer-missing");
    expect(outcome.content).toContain("CANONICAL_DESIGN_REQUIRED");
    expect(outcome.content).toContain("The artifact has no marked objective statements.");
    expect(outcome.content).not.toContain("terminal_reader_identity_conflict");
    expect(outcome.executedTools.map((tool) => tool.name)).toEqual([writer]);
  });
});

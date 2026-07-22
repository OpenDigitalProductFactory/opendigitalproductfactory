import { beforeEach, describe, expect, it, vi } from "vitest";

// Locks the BI-744D583B seam gate: executeAutonomousAgenticLoop grounds the
// AUTONOMOUS path in profession corpus, but NOT the chat path (chat injects the
// corpus upstream in agent-coworker and passes interactionMode "chat" — grounding
// here would double-inject). The grounding logic itself is unit-tested in
// profession-grounding.test.ts; this test only verifies the gate + handoff.

vi.mock("@dpf/db", () => {
  const prisma = {
    agent: { findFirst: vi.fn(async () => null) },
    taskRun: { create: vi.fn(), findFirst: vi.fn() },
  };
  return { prisma };
});
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/inference/inference-admission", () => ({
  withInferenceOrigin: (_origin: string, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({
  resolveCoworkerReviewPattern: vi.fn(async () => "none"),
}));
vi.mock("@/lib/tak/coworker-inline-review", () => ({ reviewCoworkerDraft: vi.fn() }));
vi.mock("@/lib/tak/reflection-triggers", () => ({ processRuntimeIssueReflection: vi.fn() }));
vi.mock("@/lib/tak/profession-grounding", () => ({
  groundPromptWithProfessionCorpus: vi.fn(async () => ({ systemPrompt: "GROUNDED", grounded: true })),
  defaultProfessionGroundingDeps: {},
}));

async function callLoop(interactionMode?: "chat" | "autonomous") {
  const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");
  await executeAutonomousAgenticLoop({
    systemPrompt: "BASE",
    chatHistory: [{ role: "user", content: "Do the build task." }],
    sensitivity: "internal",
    tools: [],
    toolsForProvider: [],
    userId: "user-1",
    routeContext: "build",
    agentId: "build-qa-engineer",
    threadId: "thread-1",
    ...(interactionMode ? { interactionMode } : {}),
  });
}

describe("executeAutonomousAgenticLoop — profession-corpus grounding gate", () => {
  beforeEach(async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockReset();
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "ok", executedTools: [] } as never);
    const grounding = await import("@/lib/tak/profession-grounding");
    vi.mocked(grounding.groundPromptWithProfessionCorpus).mockClear();
  });

  it("grounds the autonomous path and forwards the grounded prompt to the loop", async () => {
    await callLoop(); // default interactionMode → autonomous
    const grounding = await import("@/lib/tak/profession-grounding");
    const agentic = await import("@/lib/tak/agentic-loop");
    expect(grounding.groundPromptWithProfessionCorpus).toHaveBeenCalledTimes(1);
    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "GROUNDED" }),
    );
  });

  it("does NOT ground the chat path (chat injects upstream — no double-injection)", async () => {
    await callLoop("chat");
    const grounding = await import("@/lib/tak/profession-grounding");
    const agentic = await import("@/lib/tak/agentic-loop");
    expect(grounding.groundPromptWithProfessionCorpus).not.toHaveBeenCalled();
    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: "BASE" }),
    );
  });
});

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
vi.mock("@/lib/coworker/authorized-surface-prompt-grounding", () => ({
  groundPromptWithAuthorizedSurface: vi.fn(async ({ systemPrompt }: { systemPrompt: string }) => ({
    systemPrompt: `${systemPrompt}\n\nSURFACE GROUNDED`,
    grounded: true,
    instructionBlock: "SURFACE GROUNDED",
    sessionId: "surface-session-1",
    guidanceHighlights: [
      "For SNMP choose SNMP (Generic), enter Target IP or Hostname and the write-only Community String, then use Save & Test.",
    ],
  })),
  enforceAuthorizedSurfaceGuidanceCoverage: vi.fn((content: string, highlights: string[]) =>
    highlights.every((highlight) => content.includes(highlight))
      ? content
      : `${content}\n\nAUTHORIZED SURFACE DETAILS\n${highlights.map((highlight) => `- ${highlight}`).join("\n")}`,
  ),
  isAuthorizedSurfaceGuidanceRequest: vi.fn((content: string) => /how should i setup/i.test(content)),
  closeAuthorizedSurfacePromptGrounding: vi.fn(async () => undefined),
}));

async function callLoop(interactionMode?: "chat" | "autonomous", content = "Do the build task.") {
  const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");
  return executeAutonomousAgenticLoop({
    systemPrompt: "BASE",
    chatHistory: [{ role: "user", content }],
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
    const surfaceGrounding = await import("@/lib/coworker/authorized-surface-prompt-grounding");
    vi.mocked(surfaceGrounding.groundPromptWithAuthorizedSurface).mockClear();
    vi.mocked(surfaceGrounding.closeAuthorizedSurfacePromptGrounding).mockClear();
  });

  it("prehydrates the authorized surface at the shared chat and autonomous seam", async () => {
    await callLoop("chat");
    await callLoop("autonomous");

    const surfaceGrounding = await import("@/lib/coworker/authorized-surface-prompt-grounding");
    const agentic = await import("@/lib/tak/agentic-loop");
    expect(surfaceGrounding.groundPromptWithAuthorizedSurface).toHaveBeenCalledTimes(2);
    expect(surfaceGrounding.groundPromptWithAuthorizedSurface).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        context: expect.objectContaining({
          delegatingUserId: "user-1",
          actingAgentId: "build-qa-engineer",
          mode: "browser",
          route: "build",
        }),
        authorizedToolNames: expect.any(Set),
      }),
    );
    expect(surfaceGrounding.groundPromptWithAuthorizedSurface).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ context: expect.objectContaining({ mode: "background" }) }),
    );
    expect(agentic.runAgenticLoop).toHaveBeenLastCalledWith(
      expect.objectContaining({ systemPrompt: expect.stringContaining("SURFACE GROUNDED") }),
    );
    expect(surfaceGrounding.closeAuthorizedSurfacePromptGrounding).toHaveBeenCalledTimes(2);
  });

  it("routes prehydrated read-only surface guidance without tool schemas or a tool-use floor", async () => {
    const result = await callLoop("chat", "how should I setup this smtp discovery?");

    const agentic = await import("@/lib/tak/agentic-loop");
    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        toolsForProvider: undefined,
        allowToolFreeInference: true,
        systemPrompt: expect.stringContaining("SURFACE GROUNDED"),
      }),
    );
    expect(result.authoritativeSurfaceEvidence).toBe(true);
    expect(result.content).toContain("SNMP (Generic)");
    expect(result.content).toContain("Target IP or Hostname");
    expect(result.content).toContain("Community String");
    expect(result.content).toContain("Save & Test");
  });

  it("grounds the autonomous path and forwards the grounded prompt to the loop", async () => {
    await callLoop(); // default interactionMode → autonomous
    const grounding = await import("@/lib/tak/profession-grounding");
    const agentic = await import("@/lib/tak/agentic-loop");
    expect(grounding.groundPromptWithProfessionCorpus).toHaveBeenCalledTimes(1);
    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: expect.stringContaining("GROUNDED") }),
    );
  });

  it("does NOT ground the chat path (chat injects upstream — no double-injection)", async () => {
    await callLoop("chat");
    const grounding = await import("@/lib/tak/profession-grounding");
    const agentic = await import("@/lib/tak/agentic-loop");
    expect(grounding.groundPromptWithProfessionCorpus).not.toHaveBeenCalled();
    expect(agentic.runAgenticLoop).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: expect.stringContaining("BASE") }),
    );
  });
});


describe("grounded prompt blocks are declared as INSTRUCTION, not payload (BI-D9D661ED)", () => {
  beforeEach(async () => {
    const agentic = await import("@/lib/tak/agentic-loop");
    vi.mocked(agentic.runAgenticLoop).mockReset();
    vi.mocked(agentic.runAgenticLoop).mockResolvedValue({ content: "ok", executedTools: [] } as never);
  });

  it("declares the authorized-surface block as an instruction span", async () => {
    // The provenance design lists AUTHORIZED_SURFACE_PROMPT as instruction, but
    // it is appended HERE — after the caller computed its spans from the
    // persona — so it landed in the data remainder and was screened as payload.
    await callLoop("autonomous");

    const agentic = await import("@/lib/tak/agentic-loop");
    const spans = vi.mocked(agentic.runAgenticLoop).mock.calls[0]![0]!
      .systemPromptInstructionSpans;
    expect(spans).toContain("SURFACE GROUNDED");
  });

  it("does NOT declare the profession corpus as instruction", async () => {
    // The corpus is retrieved content that can carry real values, so the
    // ratified design classifies it as DATA. Labelling it would open an egress
    // path for anything the corpus happens to contain.
    await callLoop("autonomous");

    const agentic = await import("@/lib/tak/agentic-loop");
    const spans = vi.mocked(agentic.runAgenticLoop).mock.calls[0]![0]!
      .systemPromptInstructionSpans;
    expect(spans).not.toContain("GROUNDED");
    expect(spans).toEqual(["SURFACE GROUNDED"]);
  });

  it("keeps the caller's own persona spans alongside the grounded ones", async () => {
    const { executeAutonomousAgenticLoop } = await import("./autonomous-work-run");
    await executeAutonomousAgenticLoop({
      systemPrompt: "PERSONA",
      systemPromptInstructionSpans: ["PERSONA"],
      chatHistory: [{ role: "user", content: "Do the build task." }],
      sensitivity: "internal",
      tools: [],
      toolsForProvider: [],
      userId: "user-1",
      routeContext: "build",
      agentId: "build-qa-engineer",
      threadId: "thread-1",
      interactionMode: "autonomous",
    });

    const agentic = await import("@/lib/tak/agentic-loop");
    const spans = vi.mocked(agentic.runAgenticLoop).mock.calls.at(-1)![0]!
      .systemPromptInstructionSpans;
    expect(spans).toContain("PERSONA");
    expect(spans!.length).toBeGreaterThan(1);
  });

  it("adds no spans on the chat path, which grounds its corpus upstream", async () => {
    await callLoop("chat");

    const agentic = await import("@/lib/tak/agentic-loop");
    const spans = vi.mocked(agentic.runAgenticLoop).mock.calls.at(-1)![0]!
      .systemPromptInstructionSpans;
    // Chat skips profession grounding, so only the surface block is appended.
    expect(spans).toEqual(["SURFACE GROUNDED"]);
  });
});

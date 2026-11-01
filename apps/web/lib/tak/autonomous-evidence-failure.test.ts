import { expect, it, vi } from "vitest";
const effects = vi.hoisted(() => ({ review: vi.fn(), loop: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("./agentic-loop", () => ({ runAgenticLoop: effects.loop }));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({ resolveCoworkerReviewPattern: vi.fn(async () => "review") }));
vi.mock("./coworker-inline-review", () => ({ reviewCoworkerDraft: effects.review }));
vi.mock("./profession-grounding", () => ({ groundPromptWithProfessionCorpus: vi.fn(async ({ systemPrompt }) => ({ systemPrompt, grounded: false })), defaultProfessionGroundingDeps: {} }));
vi.mock("@/lib/coworker/authorized-surface-prompt-grounding", () => ({
  groundPromptWithAuthorizedSurface: vi.fn(async ({ systemPrompt }) => ({ systemPrompt, grounded: false })),
  isAuthorizedSurfaceGuidanceRequest: () => false, closeAuthorizedSurfacePromptGrounding: vi.fn(),
}));
vi.mock("./reflection-triggers", () => ({ processRuntimeIssueReflection: vi.fn() }));
vi.mock("./pattern-observer-service", () => ({ observeWorkPatternsAfterRun: vi.fn(async () => ({ skippedReason: "missing-task-run" })) }));
import { executeAutonomousAgenticLoop } from "./autonomous-work-run";

it("keeps the bounded evidence failure rather than asking another model to polish it", async () => {
  effects.loop.mockResolvedValue({ content: "The request is unfinished.", executedTools: [],
    failure: { kind: "evidence-unavailable", message: "The request is unfinished." } });
  const result = await executeAutonomousAgenticLoop({ systemPrompt: "Read live records.", chatHistory: [{ role: "user", content: "Check pending approvals." }],
    sensitivity: "internal", tools: [], toolsForProvider: [], userId: "human", agentId: "coo", threadId: "thread", routeContext: "/workspace/inbox" });
  expect(result.failure?.kind).toBe("evidence-unavailable");
  expect(result.content).toBe("The request is unfinished.");
  expect(effects.review).not.toHaveBeenCalled();
});

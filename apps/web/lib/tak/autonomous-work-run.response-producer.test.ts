import { beforeEach, describe, expect, it, vi } from "vitest";
import { createResponseProducer } from "../routing/response-producer";
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/inference/inference-admission", () => ({ withInferenceOrigin: vi.fn(async (_origin, run) => run()) }));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({ resolveCoworkerReviewPattern: vi.fn() }));
vi.mock("@/lib/tak/coworker-inline-review", () => ({ reviewCoworkerDraft: vi.fn() }));
vi.mock("@/lib/coworker/authorized-surface-prompt-grounding", () => ({
  groundPromptWithAuthorizedSurface: vi.fn(async ({ systemPrompt }) => ({ systemPrompt, grounded: false })),
  closeAuthorizedSurfacePromptGrounding: vi.fn(), isAuthorizedSurfaceGuidanceRequest: vi.fn(() => false),
}));
vi.mock("@/lib/tak/reflection-triggers", () => ({ processRuntimeIssueReflection: vi.fn() }));
vi.mock("@/lib/tak/pattern-observer-service", () => ({ observeWorkPatternsAfterRun: vi.fn(async () => ({ skippedReason: "missing-task-run" })) }));
import { runAgenticLoop } from "@/lib/tak/agentic-loop";
import { resolveCoworkerReviewPattern } from "@/lib/golden-triangle/coworker-review";
import { reviewCoworkerDraft } from "@/lib/tak/coworker-inline-review";
import { executeAutonomousAgenticLoop } from "./autonomous-work-run";
const content = "The original provider answer is complete and useful for this task.";
const producer = createResponseProducer({ attemptId: "original-attempt", providerId: "openai", modelId: "actual", content });
const input = { systemPrompt: "You are helpful.", chatHistory: [{ role: "user" as const, content: "Review the proposed approach." }], sensitivity: "internal" as const,
  tools: [], userId: "user-1", routeContext: "/inventory", agentId: "architect", threadId: "thread-1", agentMessageId: "assistant-id", interactionMode: "chat" as const };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runAgenticLoop).mockResolvedValue({ content, providerId: "openai", modelId: "actual", responseProducer: producer,
    downgraded: false, downgradeMessage: null, totalInputTokens: 10, totalOutputTokens: 10, executedTools: [], proposal: null });
  vi.mocked(resolveCoworkerReviewPattern).mockResolvedValue("review" as never);
});
describe("post-review response producer", () => {
  it("retains the actual producer when review leaves the answer unchanged", async () => {
    vi.mocked(reviewCoworkerDraft).mockResolvedValue({ revised: false, content } as never);
    const result = await executeAutonomousAgenticLoop(input);
    expect(result.responseProducer).toEqual(producer);
    expect(runAgenticLoop).toHaveBeenCalledWith(expect.objectContaining({ agentMessageId: "assistant-id", threadId: "thread-1" }));
  });
  it("clears the original producer when inline review rewrites the saved answer", async () => {
    vi.mocked(reviewCoworkerDraft).mockResolvedValue({ revised: true, content: "An independently revised answer with different recommendations." } as never);
    const result = await executeAutonomousAgenticLoop(input);
    expect(result.content).toContain("independently revised");
    expect(result.responseProducer).toBeUndefined();
  });
  it("preserves the original answer and producer if optional review fails", async () => {
    vi.mocked(reviewCoworkerDraft).mockRejectedValue(new Error("review unavailable"));
    const result = await executeAutonomousAgenticLoop(input);
    expect(result.content).toBe(content);
    expect(result.responseProducer).toEqual(producer);
  });
});

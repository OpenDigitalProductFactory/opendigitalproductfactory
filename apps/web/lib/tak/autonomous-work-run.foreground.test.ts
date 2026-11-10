import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), human: vi.fn(), thread: vi.fn(), message: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: mocks.run }, agentThread: { findUnique: mocks.thread }, agentMessage: { findFirst: mocks.message } } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/platform-runtime/work-admission", () => ({ admitRuntimeGuardedWork: vi.fn() }));
vi.mock("@/lib/tak/agentic-loop", () => ({ runAgenticLoop: vi.fn() }));
vi.mock("@/lib/inference/inference-admission", () => ({ withInferenceOrigin: vi.fn(async (_origin, run) => run()) }));
vi.mock("@/lib/golden-triangle/coworker-review", () => ({ resolveCoworkerReviewPattern: vi.fn(async () => null) }));
vi.mock("@/lib/tak/coworker-inline-review", () => ({ reviewCoworkerDraft: vi.fn() }));
vi.mock("@/lib/coworker/authorized-surface-prompt-grounding", () => ({
  groundPromptWithAuthorizedSurface: vi.fn(async ({ systemPrompt }) => ({ systemPrompt, grounded: false })),
  closeAuthorizedSurfacePromptGrounding: vi.fn(), isAuthorizedSurfaceGuidanceRequest: vi.fn(() => false),
}));
vi.mock("@/lib/tak/reflection-triggers", () => ({ processRuntimeIssueReflection: vi.fn() }));
vi.mock("@/lib/tak/pattern-observer-service", () => ({ observeWorkPatternsAfterRun: vi.fn(async () => ({ processed: 1 })) }));
vi.mock("@/lib/tak/pattern-observer/observer", () => ({ observeCoworkerPatterns: vi.fn() }));
import { runAgenticLoop } from "./agentic-loop";
import { processRuntimeIssueReflection } from "./reflection-triggers";
import { observeWorkPatternsAfterRun } from "./pattern-observer-service";
import { observeCoworkerPatterns } from "./pattern-observer/observer";
import { withForegroundWork } from "../agent/foreground-work-context";
import { executeAutonomousAgenticLoop } from "./autonomous-work-run";

const input = { systemPrompt: "Synthetic request.", chatHistory: [{ role: "user" as const, content: "Return the synthetic checklist." }],
  sensitivity: "internal" as const, tools: [], userId: "owner", routeContext: "/workspace", agentId: "coo", threadId: "thread", taskRunId: "fixture" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.run.mockResolvedValue({ userId: "owner", threadId: "thread", initiatingAgentId: "coo", source: "coworker", status: "working", archivedAt: null,
    progressPayload: { dispatch: { claimedAt: "original" } }, a2aMetadata: { trigger: "interactive", requestDigest: "a".repeat(64),
      foregroundRequest: { schemaVersion: 1, userMessageId: "message", deadlineAt: new Date(Date.now() + 60_000).toISOString() } } });
  mocks.human.mockResolvedValue({ platformRole: "employee", isSuperuser: false });
  mocks.thread.mockResolvedValue({ userId: "owner" });
  mocks.message.mockResolvedValue({ id: "message" });
  vi.mocked(runAgenticLoop).mockResolvedValue({ content: "Synthetic checklist.", executedTools: [] } as never);
});
const settleHooks = () => new Promise<void>(resolve => setImmediate(resolve));
describe("retained foreground post-run work", () => {
  it("returns the requested result without starting unfenced reflection or observation work", async () => {
    const result = await withForegroundWork("fixture", () => executeAutonomousAgenticLoop(input));
    await settleHooks();
    expect(result.content).toBe("Synthetic checklist.");
    expect(runAgenticLoop).toHaveBeenCalledTimes(1);
    expect(processRuntimeIssueReflection).not.toHaveBeenCalled();
    expect(observeWorkPatternsAfterRun).not.toHaveBeenCalled();
    expect(observeCoworkerPatterns).not.toHaveBeenCalled();
  });
  it("preserves the existing hooks outside the retained foreground context", async () => {
    await executeAutonomousAgenticLoop(input);
    await settleHooks();
    expect(processRuntimeIssueReflection).toHaveBeenCalledTimes(1);
    expect(observeWorkPatternsAfterRun).toHaveBeenCalledTimes(1);
    expect(observeCoworkerPatterns).toHaveBeenCalledTimes(1);
  });
});

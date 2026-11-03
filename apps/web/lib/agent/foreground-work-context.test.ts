import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), human: vi.fn(), thread: vi.fn(), message: vi.fn(), session: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: mocks.run }, agentThread: { findUnique: mocks.thread }, agentMessage: { findFirst: mocks.message } } }));
vi.mock("@/lib/govern/current-user-context", () => ({ currentUserContext: mocks.human }));
vi.mock("@/lib/actions/shared/guards", () => ({ requireUser: mocks.session }));
import { assertForegroundAgent, requireForegroundUser, withForegroundWork } from "./foreground-work-context";
import { assertGovernedInferenceAuthority, currentGovernedInferenceDeadline } from "@/lib/routing/governed-inference-deadline";

describe("foreground worker identity boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.run.mockResolvedValue({ userId: "owner", threadId: "thread", initiatingAgentId: "coo", source: "coworker", status: "working", progressPayload: { dispatch: { claimedAt: "original" } }, a2aMetadata: { trigger: "interactive", requestDigest: "a".repeat(64), foregroundRequest: { schemaVersion: 1, userMessageId: "message", deadlineAt: new Date(Date.now() + 60_000).toISOString() } } });
    mocks.human.mockResolvedValue({ platformRole: "employee", isSuperuser: false });
    mocks.thread.mockResolvedValue({ userId: "owner" });
    mocks.message.mockResolvedValue({ id: "message" });
    mocks.session.mockResolvedValue({ id: "session-owner" });
  });
  afterEach(() => vi.useRealTimers());

  it("does not start a turn when authority preparation crosses its original deadline", async () => {
    vi.useFakeTimers();
    const row = await mocks.run();
    mocks.human.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.parse(row.a2aMetadata.foregroundRequest.deadlineAt) + 1);
      return { platformRole: "employee", isSuperuser: false };
    });
    const turn = vi.fn();
    await expect(withForegroundWork("TR-one", turn)).rejects.toThrow(/deadline/);
    expect(turn).not.toHaveBeenCalled();
  });

  it("cancels provider work at the immutable deadline and refuses later admission", async () => {
    vi.useFakeTimers();
    await withForegroundWork("TR-one", async () => {
      const parent = currentGovernedInferenceDeadline();
      expect(parent).toBeDefined();
      await assertGovernedInferenceAuthority();
      const providerStopped = vi.fn();
      parent!.signal.addEventListener("abort", providerStopped, { once: true });
      await vi.advanceTimersByTimeAsync(60_001);
      expect(providerStopped).toHaveBeenCalledOnce();
      await expect(assertGovernedInferenceAuthority()).rejects.toThrow(/deadline/);
    });
  });

  it.each(["generation", "digest"])("rechecks captured %s at the real provider admission choke point", async (change) => {
    const row = await mocks.run();
    await withForegroundWork("TR-one", async () => {
      mocks.run.mockResolvedValue(change === "generation"
        ? { ...row, progressPayload: { dispatch: { claimedAt: "replacement" } } }
        : { ...row, a2aMetadata: { ...row.a2aMetadata, requestDigest: "b".repeat(64) } });
      await expect(assertGovernedInferenceAuthority()).rejects.toThrow(/authority/);
    });
  });
  it("uses the persisted job owner and clears worker identity after the callback", async () => {
    expect(await withForegroundWork("TR-one", requireForegroundUser)).toEqual({ id: "owner", platformRole: "employee", isSuperuser: false });
    expect((await requireForegroundUser()).id).toBe("session-owner");
  });
  it("refuses cancellation before any worker callback executes", async () => {
    const row = await mocks.run();
    mocks.run.mockResolvedValue({ ...row, status: "canceled" });
    const effect = vi.fn();
    await expect(withForegroundWork("TR-one", effect)).rejects.toThrow("not admissible");
    expect(effect).not.toHaveBeenCalled();
  });
  it("rechecks revocation after queue entry before the turn resolves authority", async () => {
    await expect(withForegroundWork("TR-one", async () => {
      mocks.human.mockResolvedValue(null);
      return requireForegroundUser();
    })).rejects.toThrow("no longer valid");
  });
  it("refuses a changed thread owner or missing exact message binding", async () => {
    mocks.thread.mockResolvedValue({ userId: "different-owner" });
    await expect(withForegroundWork("TR-one", requireForegroundUser)).rejects.toThrow("no longer valid");
    mocks.thread.mockResolvedValue({ userId: "owner" });
    mocks.message.mockResolvedValue(null);
    await expect(withForegroundWork("TR-one", requireForegroundUser)).rejects.toThrow("no longer valid");
  });
  it("refuses a different coworker and a replacement execution generation", async () => {
    const row = { ...(await mocks.run()), initiatingAgentId: "coo", progressPayload: { dispatch: { claimedAt: "original" } } };
    mocks.run.mockResolvedValue(row);
    await withForegroundWork("TR-one", async () => {
      expect(() => assertForegroundAgent("coo")).not.toThrow();
      expect(() => assertForegroundAgent("finance")).toThrow("coworker changed");
      mocks.run.mockResolvedValue({ ...row, progressPayload: { dispatch: { claimedAt: "replacement" } } });
      await expect(requireForegroundUser()).rejects.toThrow("superseded");
    });
  });
});

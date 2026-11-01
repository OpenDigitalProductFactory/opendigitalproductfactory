import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), update: vi.fn(), list: vi.fn(), message: vi.fn(), createMessage: vi.fn(), patchMessage: vi.fn(), execute: vi.fn(), context: vi.fn(), wake: vi.fn(), emit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: { taskRun: { findUnique: mocks.load, updateMany: mocks.update, findMany: mocks.list }, agentMessage: { findFirst: mocks.message, upsert: mocks.createMessage, updateMany: mocks.patchMessage } } }));
vi.mock("./foreground-work-context", () => ({ withForegroundWork: mocks.context }));
vi.mock("@/lib/actions/agent-coworker", () => ({ sendMessage: mocks.execute }));
vi.mock("@/lib/jobs", () => ({ jobs: { send: mocks.wake } }));
vi.mock("@/lib/agent-event-bus", () => ({ agentEventBus: { clearCancel: vi.fn(), markActive: vi.fn(), markIdle: vi.fn(), emit: mocks.emit } }));
import { foregroundRequestDigest } from "./foreground-request-digest";
import { executeForegroundWork, reconcileForegroundWork } from "./foreground-work-worker";

describe("retained foreground worker", () => {
  let row: any;
  beforeEach(() => {
    vi.clearAllMocks();
    row = { id: "row", initiatingAgentId: "coo", taskRunId: "TR-one", userId: "owner", threadId: "thread", source: "coworker", status: "submitted", routeContext: "/workspace/mailroom", startedAt: new Date(), updatedAt: new Date(), progressPayload: null,
      a2aMetadata: { trigger: "interactive", requestDigest: "a".repeat(64), foregroundRequest: { schemaVersion: 1, userMessageId: "request", coworkerMode: "advise", deadlineAt: new Date(Date.now() + 3600000).toISOString() } } };
    row.a2aMetadata.requestDigest = foregroundRequestDigest({ userId: "owner", agentId: "coo", threadId: "thread", userMessageId: "request", routeContext: "/workspace/mailroom", content: "Prepare the business checklist", coworkerMode: "advise", extras: {}, deadlineAt: row.a2aMetadata.foregroundRequest.deadlineAt });
    mocks.load.mockImplementation(async () => structuredClone(row));
    mocks.update.mockImplementation(async ({ where, data }) => {
      if (where.status !== row.status || (where.updatedAt && +where.updatedAt !== +row.updatedAt)
        || (where.progressPayload && where.progressPayload.equals !== row.progressPayload?.dispatch?.claimedAt)) return { count: 0 };
      row = { ...row, ...data, updatedAt: new Date(+row.updatedAt + 1) };
      return { count: 1 };
    });
    mocks.message.mockResolvedValue({ id: "request", content: "Prepare the business checklist" });
    mocks.patchMessage.mockResolvedValue({ count: 1 });
    mocks.context.mockImplementation(async (_id, callback) => callback());
    mocks.execute.mockResolvedValue({ agentMessage: { id: "answer", role: "assistant" } });
    mocks.list.mockResolvedValue([]);
  });
  it("claims duplicate queue deliveries only once and binds output to the original request", async () => {
    await Promise.all([executeForegroundWork("TR-one"), executeForegroundWork("TR-one")]);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ acceptedUserMessageId: "request", content: "Prepare the business checklist", coworkerMode: "advise" }));
    expect(row.status).toBe("completed");
    expect(row.progressPayload.resultMessageId).toBe("answer");
  });
  it("retains a capacity wait and resumes the same job after its due time", async () => {
    mocks.execute.mockResolvedValueOnce({ agentMessage: { id: "wait", role: "system" }, resourceWait: "capacity" });
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "capacity-wait" });
    expect(row.status).toBe("input-required");
    expect(row.progressPayload.resourceWait.attempt).toBe(1);
    await executeForegroundWork("TR-one");
    expect(mocks.execute).toHaveBeenCalledOnce();
    row.progressPayload.resourceWait.nextAttemptAt = new Date(Date.now() - 1).toISOString();
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "responded" });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(mocks.context.mock.calls.every(([id]) => id === "TR-one")).toBe(true);
  });
  it("does not replay an uncertain execution, including after another queue delivery", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("lost response after possible effect"));
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "execution-uncertain" });
    expect(row.progressPayload.foregroundOutcome).toBe("execution-uncertain");
    await executeForegroundWork("TR-one");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("keeps an approval proposal pending without marking it complete or uncertain", async () => {
    mocks.execute.mockResolvedValueOnce({ agentMessage: { id: "approval", role: "assistant" }, pendingApproval: true });
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "approval-required" });
    expect(row.status).toBe("input-required");
    expect(row.completedAt).toBeUndefined();
    expect(row.progressPayload.foregroundOutcome).toBe("approval-required");
    expect(row.progressPayload.executionUncertainty).toBeUndefined();
    await executeForegroundWork("TR-one");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("holds uncertainty even if another writer resets the request to submitted", async () => {
    row.progressPayload = { executionUncertainty: { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" } };
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "blocked" });
    expect(row.progressPayload.executionUncertainty).toBeDefined();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("records an interrupted expired worker without dispatching another execution", async () => {
    row.status = "working";
    mocks.list.mockResolvedValueOnce([structuredClone(row)]).mockResolvedValueOnce([]);
    await reconcileForegroundWork();
    expect(row.status).toBe("input-required");
    expect(row.progressPayload.executionUncertainty.kind).toBe("execution-uncertain");
    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ threadId: "thread", taskRunId: "TR-one", role: "system" }) }));
    expect(mocks.wake).not.toHaveBeenCalled();
  });
  it("cannot overwrite cancellation while an executor is settling", async () => {
    mocks.execute.mockImplementationOnce(async () => {
      row.status = "canceled";
      return { agentMessage: { id: "late-answer", role: "assistant" } };
    });
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "superseded" });
    expect(row.status).toBe("canceled");
    expect(mocks.emit).not.toHaveBeenCalledWith("thread", expect.objectContaining({ agentMessageId: "late-answer" }));
  });
  it("does not infer when its original recovery window is over", async () => {
    row.a2aMetadata.foregroundRequest.deadlineAt = new Date(Date.now() - 1).toISOString();
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "blocked" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("blocks altered mode or deadline instead of widening a retained request", async () => {
    row.a2aMetadata.foregroundRequest.coworkerMode = "act";
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "blocked" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("stops at the existing capacity retry bound", async () => {
    row.status = "input-required";
    row.progressPayload = { resourceWait: { schemaVersion: 1, kind: "provider-capacity", failureKind: "busy", resumeMode: "same-taskrun", attempt: 5, observedAt: new Date().toISOString(), nextAttemptAt: new Date(Date.now() - 1).toISOString() } };
    expect(await executeForegroundWork("TR-one")).toEqual({ kind: "blocked" });
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(row.progressPayload.resourceWait).toBeUndefined();
  });
  it("checks current authority before calling the coworker", async () => {
    mocks.context.mockRejectedValueOnce(new Error("user disabled"));
    await executeForegroundWork("TR-one");
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(row.status).toBe("input-required");
  });
  it("does not execute canceled jobs or borrow external-MCP authority", async () => {
    row.status = "canceled";
    await executeForegroundWork("TR-one");
    row.status = "submitted";
    row.a2aMetadata.trigger = "external-mcp";
    await executeForegroundWork("TR-one");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("recovers lost advisory wakes from retained due rows without replaying blocked jobs", async () => {
    mocks.list.mockResolvedValue([
      { taskRunId: "TR-new", status: "submitted", progressPayload: null },
      { taskRunId: "TR-blocked", status: "input-required", progressPayload: { foregroundOutcome: "execution-uncertain" } },
    ]);
    await reconcileForegroundWork();
    expect(mocks.wake).toHaveBeenCalledExactlyOnceWith({ name: "agent/foreground-work.run", data: { taskRunId: "TR-new" } });
  });
});

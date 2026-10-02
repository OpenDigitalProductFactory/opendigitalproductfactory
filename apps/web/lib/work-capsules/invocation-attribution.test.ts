import { describe, expect, it } from "vitest";
import { projectInvocationAttribution } from "./invocation-attribution";

describe("workroom invocation attribution", () => {
  it("keeps an external executor and its session visible", () => {
    expect(projectInvocationAttribution({ executorKind: "codex-desktop", executorRef: "session-1", source: "external-adoption" })).toMatchObject({ executor: "codex-desktop", invocation: expect.stringContaining("session-1") });
  });
  it("identifies native execution from recorded activity, not a title", () => {
    expect(projectInvocationAttribution({ activities: [{ kind: "concierge-sweep" }] })).toMatchObject({ executor: "dpf-native", invocation: expect.stringContaining("concierge-sweep") });
    expect(projectInvocationAttribution({ title: "Decision governance" })).toMatchObject({ executor: "Executor not recorded" });
  });
  it("does not attribute an external executor's session to old native activity", () => {
    expect(projectInvocationAttribution({ executorKind: "codex-desktop", executorRef: "session-2", activities: [{ kind: "concierge-sweep" }] })).toEqual({ executor: "codex-desktop", invocation: "session-2" });
  });
  it("does not call scheduled dispatch A2A or manual", () => {
    const result = projectInvocationAttribution({ source: "manual", workspaceState: { workroomDrive: { action: "dispatch_agent", taskId: "task-1", stageKey: "read" } } }, { agentId: "customer-advisor" });
    expect(result.invocation).toContain("Scheduled");
    expect(result.executor).toBe("customer-advisor");
    expect(result.invocation).toContain("customer-advisor");
    expect(result.invocation).toContain("read");
    expect(result.invocation).not.toMatch(/A2A|manual/);
  });
  it("shows recorded caller, callee and parent for A2A", () => {
    expect(projectInvocationAttribution({ taskRun: { taskRunId: "TR-child", initiatingAgentId: "caller", currentAgentId: "callee", parentTaskRunId: "parent" } }).invocation).toBe("A2A: caller → callee · TR-child · parent parent");
  });
  it("does not invent delegation when a run has only one agent", () => {
    expect(projectInvocationAttribution({ taskRun: { taskRunId: "TR-1", initiatingAgentId: "same", currentAgentId: "same" } }).invocation).not.toContain("A2A");
  });
  it("distinguishes a draft without invocation evidence from missing history", () => {
    expect(projectInvocationAttribution({ status: "draft" }).invocation).toBe("No invocation recorded");
    expect(projectInvocationAttribution({ status: "working" }).invocation).toContain("history");
  });
  it("does not expose arbitrary payloads", () => {
    expect(JSON.stringify(projectInvocationAttribution({ workspaceState: { secret: "private-data" }, taskRun: { taskRunId: "TR-1", a2aMetadata: { secret: "private-data" } } }))).not.toContain("private-data");
  });
});

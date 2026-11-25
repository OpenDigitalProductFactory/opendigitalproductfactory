import { afterEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findEnvelope: vi.fn(), writeDecision: vi.fn(), findPark: vi.fn(), writeOutcome: vi.fn(),
  execute: vi.fn(), resumeTask: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "owner", isSuperuser: true } }) }));
vi.mock("@dpf/db", () => ({ prisma: {
  coworkerActionEnvelope: { findUnique: m.findEnvelope, findFirst: m.findEnvelope, updateMany: m.writeDecision },
  toolExecution: { findFirst: m.findPark, create: m.writeOutcome },
} }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: m.execute }));
vi.mock("@/lib/coworker/approved-task-run", () => ({ runApprovedTaskRequest: m.resumeTask }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [] }));

import { S5_REHEARSAL_APPROVAL_ACTION } from "@/lib/workroom-runtime/s5-rehearsal-approval-action";
import { POST } from "./route";

afterEach(() => vi.restoreAllMocks());

describe("the rehearsal Inbox decision", () => {
  it("records the owner's decision without a send or a launch", async () => {
    const send = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected provider send"));
    const envelope = {
      id: "envelope-fixture", status: "proposed", resolvedAt: null, expiresAt: new Date(Date.now() + 60_000),
      delegatingUserId: "owner", coworkerAgentId: "agent-fixture", threadId: "thread-fixture",
      manifestActionId: S5_REHEARSAL_APPROVAL_ACTION, taskRunId: null,
      approvalBindingFingerprint: "exact-binding-fixture",
      argsJson: { approvalBinding: { taskRunId: null, routeContext: "/build", chainId: null } },
    };
    m.findEnvelope.mockImplementation(async () => envelope);
    m.writeDecision.mockImplementation(async ({ data }) => {
      Object.assign(envelope, data);
      return { count: 1 };
    });
    m.findPark.mockRejectedValue(new Error("decision must not enter replay lookup"));
    const response = await POST(new Request("http://localhost/approve", { method: "POST" }), {
      params: Promise.resolve({ envelopeId: envelope.id }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, execution: { status: "not-run", reason: "decision-only" } });
    expect(m.writeDecision).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: expect.objectContaining({ status: "proposed", resolvedAt: null }),
      data: expect.objectContaining({ status: "approved", argsJson: expect.objectContaining({ humanApproval: expect.any(Object) }) }),
    }));
    expect(envelope.resolvedAt).toBeNull();
    expect(m.findPark).not.toHaveBeenCalled();
    expect(m.execute).not.toHaveBeenCalled();
    expect(m.resumeTask).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(m.writeOutcome).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      data: expect.objectContaining({ executionMode: "approval-outcome",
        result: { status: "not-run", reason: "decision-only" } }),
    }));
  });
});

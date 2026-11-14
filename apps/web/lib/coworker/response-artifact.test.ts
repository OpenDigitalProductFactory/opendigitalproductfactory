import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PortalContextEnvelope } from "@/lib/portal-context";

const effects = vi.hoisted(() => ({ artifact: vi.fn(), room: vi.fn(), backlog: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: {} }));
vi.mock("@/lib/tak/task-records", () => ({ createTaskArtifact: effects.artifact }));
vi.mock("@/lib/work-capsules/work-capsule-store", () => ({ recordWorkCapsuleEvidence: effects.room }));
vi.mock("@/lib/portal-context/evidence-recording", () => ({ recordPortalContextBacklogEvidence: effects.backlog }));
import { persistCoworkerResponseArtifact } from "./response-artifact";

const content = "Open Finance, then Spend and My Expenses. Choose New Expense Claim and save a draft to keep editing before review.";
function fixture() {
  return {
    taskRunId: "TR-CHAT-fixture",
    acceptedMessage: { id: "message-1", role: "assistant", content, agentId: "agent-1" },
    deliveryOutcome: "responded" as "responded" | "blocked" | "capacity-wait",
    routeContext: "/finance", threadId: "thread-1", agentId: "agent-1", agentName: "Finance",
    providerId: "fixture", modelId: "fixture", userId: "user-1",
    portalContext: { user: { principalId: "principal-1" }, work: {
      capsule: { capsuleId: "WC-fixture" }, backlogItem: { backlogItemId: "BI-fixture" },
    } } as unknown as PortalContextEnvelope,
  };
}

describe("accepted coworker response evidence", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["blocked", "capacity-wait"] as const)("does not record %s as a successful response", async deliveryOutcome => {
    const input = fixture();
    input.deliveryOutcome = deliveryOutcome;
    input.acceptedMessage = { ...input.acceptedMessage, role: "system", agentId: "" };
    await persistCoworkerResponseArtifact(input);
    expect(effects.artifact).not.toHaveBeenCalled();
    expect(effects.room).not.toHaveBeenCalled();
    expect(effects.backlog).not.toHaveBeenCalled();
  });

  it("requires an accepted assistant message even when a caller says responded", async () => {
    const input = fixture();
    input.acceptedMessage.role = "system";
    await persistCoworkerResponseArtifact(input);
    expect(effects.artifact).not.toHaveBeenCalled();
    expect(effects.room).not.toHaveBeenCalled();
    expect(effects.backlog).not.toHaveBeenCalled();
  });

  it("does not turn an assistant capacity notice into completion evidence", async () => {
    await persistCoworkerResponseArtifact({ ...fixture(), deliveryOutcome: "capacity-wait" });
    expect(effects.artifact).not.toHaveBeenCalled();
    expect(effects.room).not.toHaveBeenCalled();
    expect(effects.backlog).not.toHaveBeenCalled();
  });

  it("preserves genuine accepted responses and binds evidence to their message", async () => {
    await persistCoworkerResponseArtifact(fixture());
    expect(effects.artifact).toHaveBeenCalledWith(expect.objectContaining({
      taskRunId: "TR-CHAT-fixture", metadata: expect.objectContaining({
        deliveryState: "responded", acceptedMessageId: "message-1",
      }),
    }));
    expect(effects.room).toHaveBeenCalledOnce();
    expect(effects.backlog).toHaveBeenCalledOnce();
  });
});

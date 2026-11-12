import { describe, expect, it } from "vitest";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import {
  createOptimisticUserMessage,
  failOptimisticMessage,
  reconcileOptimisticMessage,
  retryOptimisticMessage,
  acknowledgeRetainedMessage,
  pendingCoworkerLabel,
} from "./agent-message-state";

function makeUserMessage(id: string, content: string): AgentMessageRow {
  return {
    id,
    role: "user",
    content,
    agentId: null,
    routeContext: "/ops",
    createdAt: "2026-03-14T12:00:00.000Z",
  };
}

describe("agent-message-state", () => {
  const pending = { agentName: "Finance Specialist", clearing: false, status: null, tool: null, elapsedSeconds: 0, acknowledged: true };
  it.each([0, 5, 30, 180])("does not infer execution from an acknowledgement or %ss of waiting", elapsedSeconds => {
    const label = pendingCoworkerLabel({ ...pending, elapsedSeconds });
    expect(label).not.toMatch(/thinking|working/i);
    expect(label).toContain("saved");
  });
  it("does not claim a request was saved before server acknowledgement", () => {
    expect(pendingCoworkerLabel({ ...pending, acknowledged: false, elapsedSeconds: 180 })).not.toMatch(/saved|thinking|working/i);
  });
  it("preserves actual server status and tool progress", () => {
    expect(pendingCoworkerLabel({ ...pending, status: "Checking the saved receipt", tool: "read_receipt" })).toBe("Checking the saved receipt");
    expect(pendingCoworkerLabel({ ...pending, tool: "read_receipt" })).toContain("using read receipt");
  });
  it("keeps conversation clearing distinct from execution progress", () => {
    expect(pendingCoworkerLabel({ ...pending, clearing: true, status: "A stale update" })).toBe("Clearing conversation");
  });
  it("creates an optimistic user message in sending state", () => {
    const optimistic = createOptimisticUserMessage("Please update the epic", "/ops");

    expect(optimistic.deliveryState).toBe("sending");
    expect(optimistic.role).toBe("user");
    expect(optimistic.content).toBe("Please update the epic");
  });

  it("marks an optimistic message as failed", () => {
    const optimistic = createOptimisticUserMessage("Please update the epic", "/ops");

    const failed = failOptimisticMessage(optimistic);

    expect(failed.deliveryState).toBe("failed");
    expect(failed.content).toBe("Please update the epic");
  });

  it("reconciles an optimistic message with the server-confirmed user message", () => {
    const optimistic = createOptimisticUserMessage("Please update the epic", "/ops");
    const confirmed = makeUserMessage("server-user-1", "Please update the epic");

    const reconciled = reconcileOptimisticMessage(optimistic, confirmed);

    expect(reconciled.id).toBe("server-user-1");
    expect(reconciled.deliveryState).toBe("sent");
  });

  it("returns a retryable optimistic message to sending state", () => {
    const optimistic = failOptimisticMessage(createOptimisticUserMessage("Please update the epic", "/ops"));

    const retried = retryOptimisticMessage(optimistic);

    expect(retried.deliveryState).toBe("sending");
    expect(retried.content).toBe("Please update the epic");
  });
  it("settles message delivery and retains the stored receipt only once", () => {
    const optimistic = createOptimisticUserMessage("Prepare the checklist", "/workspace");
    const receipt = { id: "foreground-receipt-TR-one", role: "system", content: "Your request is saved.", createdAt: "2026-10-29T00:00:00Z" };
    const once = acknowledgeRetainedMessage([optimistic], optimistic.id, receipt);
    expect(once[0].deliveryState).toBe("sent");
    expect(once[1].content).toBe("Your request is saved.");
    expect(acknowledgeRetainedMessage(once, optimistic.id, receipt)).toHaveLength(2);
    expect(acknowledgeRetainedMessage([optimistic], optimistic.id, { ...receipt, role: "assistant" })).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import type { AgentMessageRow } from "@/lib/agent-coworker-types";
import {
  createOptimisticUserMessage,
  failOptimisticMessage,
  reconcileOptimisticMessage,
  retryOptimisticMessage,
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
});

import { describe, expect, it } from "vitest";
import { selectVisibleTelemetry, serializeMessage } from "./agent-coworker-data";

const assistantMsg = {
  id: "m1",
  role: "assistant",
  content: "Proposed `add customer contact` for your approval.",
  agentId: "customer-advisor",
  routeContext: "/customer",
  createdAt: new Date("2026-07-12T00:00:00Z"),
};

describe("serializeMessage — proposal join (BI-867263F4)", () => {
  it("attaches a joined proposal so its Approve/Reject card renders (incl. on reload)", () => {
    const row = serializeMessage(assistantMsg, {
      proposalId: "prop-1",
      actionType: "add_customer_contact",
      parameters: { name: "Dan Warfield" },
      status: "proposed",
      resultEntityId: null,
      resultError: null,
    });
    expect(row.proposal).toEqual({
      proposalId: "prop-1",
      actionType: "add_customer_contact",
      parameters: { name: "Dan Warfield" },
      status: "proposed",
    });
  });

  it("leaves proposal undefined when the message has none", () => {
    expect(serializeMessage(assistantMsg, null).proposal).toBeUndefined();
  });
});

const baseRow = {
  providerId: "anthropic",
  modelId: "claude-opus-4-7",
  adapterKind: "anthropic-api",
};

describe("selectVisibleTelemetry", () => {
  it("returns an empty map when no rows are provided", () => {
    expect(selectVisibleTelemetry([])).toEqual(new Map());
  });

  it("skips telemetry rows without an agentMessageId", () => {
    const out = selectVisibleTelemetry([
      {
        ...baseRow,
        agentMessageId: null,
        executionMode: "single",
        startedAt: new Date("2026-05-22T12:00:00Z"),
      },
    ]);
    expect(out.size).toBe(0);
  });

  it("keeps single-mode rows and drops shadow-alt / race-loser", () => {
    const out = selectVisibleTelemetry([
      {
        ...baseRow,
        agentMessageId: "msg-a",
        executionMode: "single",
        startedAt: new Date("2026-05-22T12:00:00Z"),
      },
      {
        ...baseRow,
        agentMessageId: "msg-b",
        executionMode: "shadow-alt",
        startedAt: new Date("2026-05-22T12:00:00Z"),
      },
      {
        ...baseRow,
        agentMessageId: "msg-c",
        executionMode: "race-loser",
        startedAt: new Date("2026-05-22T12:00:00Z"),
      },
    ]);
    expect([...out.keys()].sort()).toEqual(["msg-a"]);
  });

  it("when multiple visible rows exist for one message, picks the most recent", () => {
    const out = selectVisibleTelemetry([
      {
        ...baseRow,
        agentMessageId: "msg-x",
        executionMode: "single",
        startedAt: new Date("2026-05-22T12:00:00Z"),
        modelId: "old-model",
      },
      {
        ...baseRow,
        agentMessageId: "msg-x",
        executionMode: "single",
        startedAt: new Date("2026-05-22T12:05:00Z"),
        modelId: "new-model",
      },
    ]);
    expect(out.get("msg-x")?.modelId).toBe("new-model");
  });

  it("treats race-primary and shadow-primary as user-visible", () => {
    const out = selectVisibleTelemetry([
      {
        ...baseRow,
        agentMessageId: "msg-race",
        executionMode: "race-primary",
        startedAt: new Date("2026-05-22T12:00:00Z"),
      },
      {
        ...baseRow,
        agentMessageId: "msg-shadow",
        executionMode: "shadow-primary",
        startedAt: new Date("2026-05-22T12:00:00Z"),
      },
    ]);
    expect([...out.keys()].sort()).toEqual(["msg-race", "msg-shadow"]);
  });
});

// Approval convergence A3 (BI-C8EC05C9, spec D2 S1): the message carries the
// LIST of approval requests raised for it (by chatMessageId). No envelope has a
// chatMessageId yet, so every message serialises exactly as before.
describe("serializeMessage — inline approval requests", () => {
  const request = {
    envelopeId: "ENV-1", toolName: "contribute_to_hive", status: "proposed",
    expiresAt: "2026-07-12T00:15:00.000Z", rationale: "This action is defined as a proposal, so a person decides it.",
  };

  it("attaches every request raised for the message, in order", () => {
    const row = serializeMessage(assistantMsg, null, undefined, [request, { ...request, envelopeId: "ENV-2" }]);
    expect(row.approvalRequests?.map((r) => r.envelopeId)).toEqual(["ENV-1", "ENV-2"]);
  });

  it("adds nothing when there are none (parity with today)", () => {
    expect(serializeMessage(assistantMsg, null, undefined, [])).toEqual(serializeMessage(assistantMsg, null));
    expect(serializeMessage(assistantMsg, null)).not.toHaveProperty("approvalRequests");
  });
});

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

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

  it("a still-proposed row carrying a refusal reason renders as no longer runnable (PR-C review finding 5)", () => {
    const reason = "create_backlog_item rejected: not admitted to that room";
    const row = serializeMessage(assistantMsg, {
      proposalId: "prop-1", actionType: "create_backlog_item", parameters: {},
      status: "proposed", resultEntityId: null, resultError: reason,
    });
    expect(row.proposal).toEqual({
      proposalId: "prop-1", actionType: "create_backlog_item", parameters: {},
      status: "proposed", noLongerRunnable: reason,
    });
  });

  it("a failed row keeps its resultError as before", () => {
    const row = serializeMessage(assistantMsg, {
      proposalId: "prop-1", actionType: "create_backlog_item", parameters: {},
      status: "failed", resultEntityId: null, resultError: "duplicate_title",
    });
    expect(row.proposal).toEqual({
      proposalId: "prop-1", actionType: "create_backlog_item", parameters: {},
      status: "failed", resultError: "duplicate_title",
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
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), rationale: "This action is defined as a proposal, so a person decides it.",
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

describe("serializeMessage — feedback display hint", () => {
  it("exposes only a bounded eligibility hint, never producer identity", () => {
    const row = serializeMessage({ ...assistantMsg, responseAttemptId: "attempt", responseContentDigest: "digest", responseScope: "known_unroomed", responseWorkroomId: null });
    expect(row.responseFeedbackEligible).toBe(true);expect(row).not.toHaveProperty("responseAttemptId");expect(row).not.toHaveProperty("responseContentDigest");
  });
  it.each([null, "workroom"])("does not infer eligibility from incomplete scope %s", responseScope => {
    expect(serializeMessage({ ...assistantMsg, responseAttemptId: "attempt", responseContentDigest: "digest", responseScope, responseWorkroomId: null }).responseFeedbackEligible).toBe(false);
    expect(serializeMessage(assistantMsg).responseFeedbackEligible).toBe(false);
  });
});

describe("selectVisibleTelemetry — exact saved producer", () => {
  const message = { id: "answer", providerId: "anthropic", modelId: "actual-model", responseAttemptId: "saved-attempt" };
  const row = { ...baseRow, id: "saved-attempt", agentMessageId: "answer", modelId: "actual-model", executionMode: "single", startedAt: new Date("2026-10-31T10:00:00Z") };
  const later = { ...row, id: "later-call", modelId: "later-model", startedAt: new Date("2026-10-31T10:01:00Z") };
  it("uses the saved exact producer even when a later visible call exists", () => {
    expect(selectVisibleTelemetry([row, later], [message]).get("answer")?.id).toBe("saved-attempt");
  });
  it("does not substitute a later call while the exact telemetry is missing", () => {
    expect(selectVisibleTelemetry([later], [message]).has("answer")).toBe(false);
  });
  it.each([
    { executionMode: "shadow-alt" }, { executionMode: "race-loser" },
    { providerId: "different-provider" }, { modelId: "different-model" }, { agentMessageId: "other-answer" },
  ])("rejects a mismatched or non-visible exact row %j", mismatch => {
    expect(selectVisibleTelemetry([{ ...row, ...mismatch }, later], [message]).has("answer")).toBe(false);
  });
});

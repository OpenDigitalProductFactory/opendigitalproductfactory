import { describe, expect, it, vi } from "vitest";

import {
  buildProposalToolResult,
  divertToolCallToProposal,
  interceptToolCallAsProposal,
  shouldProposeToolCall,
  type ProposalPersistence,
} from "./propose-interception";

describe("shouldProposeToolCall", () => {
  it("diverts side-effecting non-artifact tools under a propose boundary", () => {
    expect(shouldProposeToolCall({ sideEffect: true }, true)).toBe(true);
  });

  it("never diverts when the propose boundary is inactive (act runs directly)", () => {
    expect(shouldProposeToolCall({ sideEffect: true }, false)).toBe(false);
  });

  it("lets curated artifacts run directly — they are the safe self-task writes", () => {
    expect(shouldProposeToolCall({ sideEffect: true, coworkerArtifact: true }, true)).toBe(false);
  });

  it("leaves read-only tools alone", () => {
    expect(shouldProposeToolCall({ sideEffect: false }, true)).toBe(false);
    expect(shouldProposeToolCall(undefined, true)).toBe(false);
  });

  it("defers proposal-mode tools to the loop's own approval-return path", () => {
    expect(shouldProposeToolCall({ sideEffect: true, executionMode: "proposal" }, true)).toBe(false);
  });
});

describe("buildProposalToolResult", () => {
  it("tells the model the action is pending approval and not to retry", () => {
    const result = buildProposalToolResult("add_customer_contact", "prop-1");
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("prop-1");
    expect(result.message).toMatch(/add customer contact/);
    expect(result.message).toMatch(/approv/i);
    expect(result.message).toMatch(/do not retry/i);
    expect(result.data).toEqual({ proposalId: "prop-1", status: "proposed" });
  });
});

describe("divertToolCallToProposal", () => {
  it("persists a proposal whose actionType is the tool name and parameters are the args", async () => {
    const createAssistantMessage = vi.fn(async () => ({ id: "msg-1" }));
    const createProposal = vi.fn(async (input: { proposalId: string }) => ({ proposalId: input.proposalId }));
    const persistence: ProposalPersistence = { createAssistantMessage, createProposal };

    const result = await divertToolCallToProposal({
      persistence,
      toolName: "add_customer_contact",
      args: { name: "Dan Warfield", role: "primary" },
      agentId: "customer-advisor",
      threadId: "thread-1",
      routeContext: "/customer",
      taskRunId: "run-1",
    });

    expect(createAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thread-1", agentId: "customer-advisor", taskRunId: "run-1" }),
    );
    expect(createProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        messageId: "msg-1",
        actionType: "add_customer_contact",
        parameters: { name: "Dan Warfield", role: "primary" },
        taskRunId: "run-1",
      }),
    );
    expect(result.success).toBe(true);
    expect(result.data?.status).toBe("proposed");
    // The proposalId round-trips from the persistence layer into the result.
    const createdId = createProposal.mock.calls[0][0].proposalId;
    expect(result.entityId).toBe(createdId);
  });
});

describe("interceptToolCallAsProposal: a room cadence's declared writes run (BI-C1781121)", () => {
  const sideEffect = { sideEffect: true } as const;
  const call = {
    toolDef: sideEffect,
    proposeSideEffects: true,
    toolName: "record_execution_evidence",
    args: { itemId: "BI-1" },
    agentId: "AGT-WS-PORTFOLIO",
    threadId: "thread-1",
    routeContext: "/ops/workrooms",
    taskRunId: "TR-SCHED-1234ABCD",
  };
  function persistence() {
    return {
      createAssistantMessage: vi.fn(async () => ({ id: "msg-1" })),
      createProposal: vi.fn(async (input: { proposalId: string }) => ({ proposalId: input.proposalId })),
    };
  }

  it("does not divert a write the run's room mandate declares for this agent", async () => {
    const store = persistence();
    const resolveMandatedTools = vi.fn(async () => ["record_execution_evidence", "record_workroom_evidence"]);
    const result = await interceptToolCallAsProposal(call, { persistence: store, resolveMandatedTools });
    expect(result).toBeNull();
    expect(resolveMandatedTools).toHaveBeenCalledWith({ taskRunId: "TR-SCHED-1234ABCD", agentId: "AGT-WS-PORTFOLIO" });
    expect(store.createProposal).not.toHaveBeenCalled();
  });

  it("still diverts every write the mandate does not declare", async () => {
    const store = persistence();
    const result = await interceptToolCallAsProposal(
      { ...call, toolName: "update_backlog_item_status" },
      { persistence: store, resolveMandatedTools: async () => ["record_execution_evidence"] },
    );
    expect(result?.data?.status).toBe("proposed");
    expect(store.createProposal).toHaveBeenCalledTimes(1);
  });

  it("diverts when the mandate cannot be read (fail closed)", async () => {
    const store = persistence();
    const result = await interceptToolCallAsProposal(call, {
      persistence: store,
      resolveMandatedTools: async () => { throw new Error("db down"); },
    });
    expect(result?.data?.status).toBe("proposed");
  });

  it("never consults the mandate outside a propose boundary", async () => {
    const resolveMandatedTools = vi.fn(async () => []);
    expect(await interceptToolCallAsProposal({ ...call, proposeSideEffects: false }, { persistence: persistence(), resolveMandatedTools })).toBeNull();
    expect(resolveMandatedTools).not.toHaveBeenCalled();
  });
});

// Approval convergence A1 characterisation (BI-C8EC05C9), creation site S2.
// PR-B keeps the predicate, the assistant message and fail-closed; its named
// deltas are the envelope id in place of the proposal id and the expiry
// wording. Everything else here must stay green.
describe("S2 — propose-interception as it stands (characterisation)", () => {
  const call = {
    toolDef: { sideEffect: true } as const,
    proposeSideEffects: true,
    toolName: "run_discovery_triage",
    args: { scope: "daily" },
    agentId: "AGT-OPS",
    threadId: "scheduled:thread-1",
    routeContext: "/platform/ops",
    taskRunId: "TR-SCHED-AAAA1111",
  };
  const noMandate = async () => [] as string[];

  it("words the synthetic result exactly", () => {
    expect(buildProposalToolResult("run_discovery_triage", "prop-x")).toEqual({
      success: true,
      entityId: "prop-x",
      message:
        `Proposed "run discovery triage" for the owner's approval instead of running it now ` +
        `(this coworker is set to propose, not act). It will run exactly as proposed ` +
        `once approved from the Needs-you inbox. Do not retry it — continue with any ` +
        `remaining read-only work and summarize what you proposed.`,
      data: { proposalId: "prop-x", status: "proposed" },
    });
  });

  it("writes the 'Proposed `X` for your approval.' assistant message and a prop- row bound to the run", async () => {
    const createAssistantMessage = vi.fn(async () => ({ id: "msg-9" }));
    const createProposal = vi.fn(async (input: { proposalId: string }) => ({ proposalId: input.proposalId }));
    const result = await interceptToolCallAsProposal(call, {
      persistence: { createAssistantMessage, createProposal },
      resolveMandatedTools: noMandate,
    });

    expect(createAssistantMessage).toHaveBeenCalledWith({
      threadId: "scheduled:thread-1",
      agentId: "AGT-OPS",
      routeContext: "/platform/ops",
      content: "Proposed `run discovery triage` for your approval.",
      taskRunId: "TR-SCHED-AAAA1111",
    });
    expect(createProposal).toHaveBeenCalledWith({
      proposalId: expect.stringMatching(/^prop-[0-9a-f-]{36}$/),
      threadId: "scheduled:thread-1",
      messageId: "msg-9",
      taskRunId: "TR-SCHED-AAAA1111",
      agentId: "AGT-OPS",
      actionType: "run_discovery_triage",
      parameters: { scope: "daily" },
    });
    expect(result?.success).toBe(true);
    expect(result?.entityId).toBe(createProposal.mock.calls[0][0].proposalId);
  });

  it("fails closed when the proposal cannot be persisted: not run, success false", async () => {
    const result = await interceptToolCallAsProposal(call, {
      persistence: {
        createAssistantMessage: async () => ({ id: "msg-1" }),
        createProposal: async () => { throw new Error("db down"); },
      },
      resolveMandatedTools: noMandate,
    });
    expect(result).toEqual({
      success: false,
      error: "propose_divert_failed",
      message: "Could not queue `run_discovery_triage` for approval; it was not run. Continue without it.",
    });
  });

  it("never diverts a proposal-mode, artifact or read tool, even under the boundary", async () => {
    const store = { createAssistantMessage: vi.fn(), createProposal: vi.fn() };
    for (const toolDef of [
      { sideEffect: true, executionMode: "proposal" as const },
      { sideEffect: true, coworkerArtifact: true },
      { sideEffect: false },
    ]) {
      expect(await interceptToolCallAsProposal({ ...call, toolDef }, { persistence: store, resolveMandatedTools: noMandate })).toBeNull();
    }
    expect(store.createProposal).not.toHaveBeenCalled();
  });
});

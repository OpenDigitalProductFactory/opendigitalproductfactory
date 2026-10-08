import { describe, expect, it, vi } from "vitest";

import {
  buildProposalToolResult,
  interceptToolCallAsProposal,
  shouldProposeToolCall,
  toolTakesSecretInput,
  type ProposeBoundaryExecute,
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

// PR-B (BI-7BCC87BB; spec D2 S2, AC-RAISE, AC-BOUNDARY): a call under a
// propose boundary goes to the governed executor with the boundary set, and
// the monitor raises the approval request. The named deltas against the A1
// characterisation: the synthetic result carries the envelope id and its
// expiry instead of a proposal id, and a refusal is a not-run success: false.
const PENDING = {
  success: false,
  error: "approval_required",
  message: "run_discovery_triage is waiting for a person to approve it.",
  data: { envelopeId: "env-1", expiresAt: "2026-10-14T08:00:00.000Z" },
  governance: { rejected: "approval_required" },
} as const;

function messages() {
  return { createAssistantMessage: vi.fn(async () => ({ id: "msg-1" })) };
}

describe("buildProposalToolResult", () => {
  it("tells the model the action is pending approval, until when, and not to retry", () => {
    const result = buildProposalToolResult("add_customer_contact", "env-1", "2026-10-14T08:00:00.000Z");
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("env-1");
    expect(result.message).toMatch(/add customer contact/);
    expect(result.message).toMatch(/approv/i);
    expect(result.message).toMatch(/do not retry/i);
    expect(result.message).toContain("approval request env-1");
    expect(result.message).toContain("2026-10-14T08:00:00.000Z");
    expect(result.message).toMatch(/expired unanswered and can be asked again/);
    expect(result.data).toEqual({ envelopeId: "env-1", expiresAt: "2026-10-14T08:00:00.000Z", status: "proposed" });
  });
});

describe("toolTakesSecretInput", () => {
  it("finds a writeOnly input anywhere in the schema", () => {
    expect(toolTakesSecretInput({ inputSchema: { type: "object", properties: { token: { type: "string", writeOnly: true } } } })).toBe(true);
    expect(toolTakesSecretInput({ inputSchema: { type: "object", properties: { name: { type: "string" } } } })).toBe(false);
    expect(toolTakesSecretInput({})).toBe(false);
  });
});

describe("interceptToolCallAsProposal: a room cadence's declared writes run (BI-C1781121)", () => {
  const call = {
    toolDef: { sideEffect: true } as const,
    proposeSideEffects: true,
    toolName: "record_execution_evidence",
    args: { itemId: "BI-1" },
    agentId: "AGT-WS-PORTFOLIO",
    threadId: "thread-1",
    routeContext: "/ops/workrooms",
    taskRunId: "TR-SCHED-1234ABCD",
  };

  it("does not divert a write the run's room mandate declares for this agent", async () => {
    const execute = vi.fn<ProposeBoundaryExecute>(async () => PENDING);
    const resolveMandatedTools = vi.fn(async () => ["record_execution_evidence", "record_workroom_evidence"]);
    const result = await interceptToolCallAsProposal({ ...call, execute }, { persistence: messages(), resolveMandatedTools });
    expect(result).toBeNull();
    expect(resolveMandatedTools).toHaveBeenCalledWith({ taskRunId: "TR-SCHED-1234ABCD", agentId: "AGT-WS-PORTFOLIO" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("still diverts every write the mandate does not declare", async () => {
    const execute = vi.fn<ProposeBoundaryExecute>(async () => PENDING);
    const result = await interceptToolCallAsProposal(
      { ...call, toolName: "update_backlog_item_status", execute },
      { persistence: messages(), resolveMandatedTools: async () => ["record_execution_evidence"] },
    );
    expect(result?.data?.status).toBe("proposed");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("diverts when the mandate cannot be read (fail closed)", async () => {
    const result = await interceptToolCallAsProposal({ ...call, execute: async () => PENDING }, {
      persistence: messages(),
      resolveMandatedTools: async () => { throw new Error("db down"); },
    });
    expect(result?.data?.status).toBe("proposed");
  });

  it("never consults the mandate outside a propose boundary", async () => {
    const resolveMandatedTools = vi.fn(async () => []);
    expect(await interceptToolCallAsProposal(
      { ...call, proposeSideEffects: false, execute: async () => PENDING },
      { persistence: messages(), resolveMandatedTools },
    )).toBeNull();
    expect(resolveMandatedTools).not.toHaveBeenCalled();
  });
});

describe("S2 — propose-interception raises an approval request through the monitor", () => {
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

  it("calls the governed executor with the propose boundary and the platform completing the approval", async () => {
    const execute = vi.fn<ProposeBoundaryExecute>(async () => PENDING);
    await interceptToolCallAsProposal({ ...call, execute }, { persistence: messages(), resolveMandatedTools: noMandate });
    expect(execute).toHaveBeenCalledWith({ proposeBoundary: true, approvalCompletion: "platform" });
  });

  it("approval required: the synthetic success with the envelope id and expiry, and the 'Proposed `X`' message", async () => {
    const store = messages();
    const result = await interceptToolCallAsProposal({ ...call, execute: async () => PENDING }, { persistence: store, resolveMandatedTools: noMandate });

    expect(store.createAssistantMessage).toHaveBeenCalledWith({
      threadId: "scheduled:thread-1",
      agentId: "AGT-OPS",
      routeContext: "/platform/ops",
      content: "Proposed `run discovery triage` for your approval.",
      taskRunId: "TR-SCHED-AAAA1111",
    });
    expect(result).toEqual(buildProposalToolResult("run_discovery_triage", "env-1", "2026-10-14T08:00:00.000Z"));
  });

  it("allow: an approval for this exact call already existed, so the tool ran — its real result, no new message", async () => {
    const store = messages();
    const ran = { success: true, message: "Triage ran.", entityId: "RUN-1" };
    const result = await interceptToolCallAsProposal({ ...call, execute: async () => ran }, { persistence: store, resolveMandatedTools: noMandate });
    expect(result).toEqual(ran);
    expect(store.createAssistantMessage).not.toHaveBeenCalled();
  });

  it("settled: the recorded outcome of the identical approved call", async () => {
    const recorded = { success: true, message: "run_discovery_triage already ran once after a person approved it.", governance: { approvalReplayOf: "env-0" } };
    const result = await interceptToolCallAsProposal({ ...call, execute: async () => recorded }, { persistence: messages(), resolveMandatedTools: noMandate });
    expect(result).toEqual(recorded);
  });

  it("a refusal (grant or identity, waiver W2) is a not-run success: false and raises nothing", async () => {
    const store = messages();
    const refused = { success: false, error: "authority_denied", message: "run_discovery_triage rejected: the coworker lacks the grant." };
    const result = await interceptToolCallAsProposal({ ...call, execute: async () => refused }, { persistence: store, resolveMandatedTools: noMandate });
    expect(result).toMatchObject({ success: false, error: "authority_denied" });
    expect(result?.message).toMatch(/it was not run/i);
    expect(store.createAssistantMessage).not.toHaveBeenCalled();
  });

  it("refuses a tool that takes a secret, without calling the executor (waiver W5)", async () => {
    const execute = vi.fn<ProposeBoundaryExecute>(async () => PENDING);
    const toolDef = { sideEffect: true, inputSchema: { type: "object", properties: { password: { type: "string", writeOnly: true } } } };
    const result = await interceptToolCallAsProposal(
      { ...call, toolName: "configure_gateway_scan", toolDef, execute },
      { persistence: messages(), resolveMandatedTools: noMandate },
    );
    expect(execute).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: false,
      error: "propose_secret_refused",
      message: "configure_gateway_scan needs a secret and cannot be queued for approval; it was not run. Ask the owner to run it themselves.",
    });
  });

  it("fails closed when the executor throws: not run, success false", async () => {
    const result = await interceptToolCallAsProposal(
      { ...call, execute: async () => { throw new Error("db down"); } },
      { persistence: messages(), resolveMandatedTools: noMandate },
    );
    expect(result).toEqual({
      success: false,
      error: "propose_divert_failed",
      message: "Could not queue `run_discovery_triage` for approval; it was not run. Continue without it.",
    });
  });

  it("never diverts a proposal-mode, artifact or read tool, even under the boundary", async () => {
    const execute = vi.fn<ProposeBoundaryExecute>(async () => PENDING);
    for (const toolDef of [
      { sideEffect: true, executionMode: "proposal" as const },
      { sideEffect: true, coworkerArtifact: true },
      { sideEffect: false },
    ]) {
      expect(await interceptToolCallAsProposal({ ...call, toolDef, execute }, { persistence: messages(), resolveMandatedTools: noMandate })).toBeNull();
    }
    expect(execute).not.toHaveBeenCalled();
  });
});

// BI-5B34D277 — an approval the gate reserved and the executor then refused
// before the tool ran must not be stranded.
//
// enforceCoworkerToolAuthority reserves the approved envelope (a compare-and-set
// on `resolvedAt`) and governedExecuteTool finalises it only after the tool ran.
// Every refusal in between returned with the envelope still `approved` and
// `resolvedAt` set, so the resolver kept finding it, the next reserve lost the
// compare-and-set, and every retry read "the approval was already used by
// another run of this exact request" until the envelope expired (up to 7 days).
//
// The envelope store here is in memory, but finalisation and the settled-outcome
// lookup are the REAL functions from authority-approval-envelope.ts over a fake
// db, and the reserve is the same compare-and-set the gate runs against Prisma.
//
// Two outcomes, decided by the refusal's existing disposition
// (governed-rejection-disposition.ts):
//   • a settled no ("refused": hook_denied, alignment_denied,
//     precondition_denied) finalises the envelope `failed` with the refusal as
//     the recorded outcome, and a retry gets that outcome back
//     (AC-RESERVED-REFUSAL-FINALISED, AC-NO-STRANDED-RETRY);
//   • no answer reached ("inconclusive": receipt_reservation_failed, the
//     approved task could not be resumed, an exception before the tool ran) or
//     an input the caller can obtain ("awaiting-input": permit_required)
//     releases the reservation, because nothing ran and the person's approval
//     still stands — the retry runs the call once (AC-RESERVED-REFUSAL-RELEASED,
//     AC-NO-STRANDED-RETRY).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  finalizeAuthorityApprovalEnvelope,
  findApprovedAuthorityEnvelope,
  findExecutedAuthorityOutcome,
} from "./coworker/authority-approval-envelope";
import {
  buildCoworkerApprovalBinding,
  fingerprintCoworkerApprovalBinding,
  type CoworkerAuthorityInput,
} from "./govern/authority/coworker-authority-decision";
import { setBindingEnforcementOverrideForTests } from "./gpp/binding-enforcement";
import { GPP_BINDINGS, setGppBindingsOverrideForTests, type GppBinding } from "./gpp/bindings";
import type { GppPermitStore, PermitRow } from "./gpp/permit-store";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import type { ToolResult } from "./mcp-tool-types";

const USER = { platformRole: "ceo", isSuperuser: true };
const TOOL = "create_digital_product";
const ARGS = { name: "Kiosk", description: "Retail kiosk" };
/** The precondition ordering gate only governs this tool (consequential-tool-policy.ts PRECONDITION_TOOL_NAMES). */
const PRECONDITION_TOOL = { name: "transition_employee_status", capability: "manage_user_lifecycle", args: { employeeId: "EMP-MISSING", newStatus: "active" } };
let tool = { name: TOOL, capability: "manage_platform", args: ARGS as Record<string, unknown> };
const ENVELOPE_ID = "ENV-APPROVED";
const ALREADY_USED = "already used by another run";

type Row = Record<string, unknown> & { id: string };
type Envelope = {
  id: string; status: string; resolvedAt: Date | null; expiresAt: Date;
  createdAt: Date; argsJson: unknown; approvalBindingFingerprint: string;
};

const resolveActor = async (args: { context?: { agentId?: string }; userId: string }) => ({
  principalId: "PRN-COWORKER", gaid: "GAID-COWORKER", actorKind: "coworker" as const,
  actorRef: args.context?.agentId ?? args.userId,
});

const alignment = (verdict: "approve" | "decline") => async () => ({
  verdict, interactionId: `DI-${verdict}`, rationale: `${verdict} from WWWD`, policyVersion: "wwwd:v1",
  alignment: {
    verdict,
    criteria: {
      status: "complete" as const,
      criteria: { market: "retail", segment: "retail", product: "kiosks", motion: "direct", geography: "us", customerType: "smb" },
      evidence: [], missing: [],
    },
    checks: [], veto: null,
  },
});

function authorityInput(task: CoworkerAuthorityInput["task"] = null): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1", principalAliases: [], population: "workforce",
      platformRole: "HR-000", isSuperuser: true, employeeId: "EMP-1",
      managerScope: { directReportIds: [], indirectReportIds: [] }, teamIds: [],
      accountScope: { accountIds: [], contactIds: [], partnerAccountIds: [] },
      sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      authentication: { source: "session", methods: ["mfa"], contextClassReference: null },
      actingHumanUserId: "user-1", actingAgentId: "AGT-100",
      delegationGrantIds: [], grantedCapabilities: [tool.capability],
    },
    action: {
      toolName: tool.name, requiredCapability: tool.capability, agentGrantAllowed: true,
      sideEffect: true, executionMode: "immediate", routeContext: "/portfolio",
      approvalPolicy: "all", consequence: "authority",
    },
    subject: { kind: "platform", id: "dpf" }, delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: { sensitivity: "internal", maskingRequired: false, maskingSatisfied: true, decisionVersionsCurrent: true },
    task, rawParams: tool.args,
  };
}

let envelope: Envelope;
let audits: Row[];
let execute: ReturnType<typeof vi.fn>;
let envelopeCreate: ReturnType<typeof vi.fn>;
let finalize: ReturnType<typeof vi.fn>;
let base: CoworkerAuthorityInput;

/** Just enough of Prisma's where-matching for the three real envelope functions. */
function matches(value: unknown, cond: unknown): boolean {
  if (cond && typeof cond === "object" && !(cond instanceof Date)) {
    const c = cond as Record<string, unknown>;
    if ("in" in c) return (c.in as unknown[]).includes(value);
    if ("not" in c) return value !== c.not;
    if ("gt" in c) return value instanceof Date && value.getTime() > (c.gt as Date).getTime();
    if ("lte" in c) return value instanceof Date && value.getTime() <= (c.lte as Date).getTime();
  }
  return value === cond;
}
function where(row: Record<string, unknown>, w: Record<string, unknown>): boolean {
  return Object.entries(w).every(([key, cond]) => matches(row[key], cond));
}

const fakeDb = {
  coworkerActionEnvelope: {
    findFirst: async (args: { where: Record<string, unknown> }) => (where(envelope, args.where) ? { ...envelope } : null),
    create: async () => { throw new Error("not used"); },
    updateMany: async (args: { where: Record<string, unknown>; data: Partial<Envelope> }) => {
      if (!where(envelope, args.where)) return { count: 0 };
      Object.assign(envelope, args.data);
      return { count: 1 };
    },
  },
  taskRun: { updateMany: async () => ({ count: 0 }) },
  agentThread: { upsert: async () => ({ id: "thr" }) },
  toolExecution: {
    findFirst: async (args: { where: Record<string, unknown> }) => [...audits].reverse().find((row) => where(row, args.where)) ?? null,
    findMany: async (args: { where: Record<string, unknown> }) => [...audits].reverse().filter((row) => where(row, args.where)),
  },
};

function install(overrides: Parameters<typeof _setGovernanceForTests>[0] = {}): void {
  _setGovernanceForTests({
    executeTool: execute as never,
    resolveAgentGrants: async () => ["portfolio_write"],
    isAllowedByGrants: () => true,
    toolPreflight: async () => null,
    resolveCoworkerAuthorityInput: async () => ({
      ...base,
      approval: await findApprovedAuthorityEnvelope(buildCoworkerApprovalBinding(base), new Date(), fakeDb as never),
    }),
    authorizationDecisionCreate: async () => ({}),
    authorityApprovalEnvelopeCreate: envelopeCreate as never,
    authorityApprovalTaskResume: async () => undefined,
    authorityApprovalEnvelopeFinalize: finalize as never,
    policyAuthorityProjectionAttempt: async () => ({ outcome: "not-authorized" }),
    // The gate's own compare-and-set (coworker-tool-authority-gate.ts reserveApprovedEnvelope).
    policyAuthorityEnvelopeReserve: async (id) => {
      const result = await fakeDb.coworkerActionEnvelope.updateMany({
        where: { id, status: "approved", resolvedAt: null }, data: { resolvedAt: new Date() },
      });
      return result.count === 1;
    },
    authorityExecutedOutcome: (binding) => findExecutedAuthorityOutcome(binding, new Date(), fakeDb as never),
    toolExecutionCreate: async (data) => {
      const row = { ...data, id: `exec-${audits.length + 1}` };
      audits.push(row);
      return { id: row.id };
    },
    toolExecutionUpdate: async (id, data) => { Object.assign(audits.find((row) => row.id === id) ?? {}, data); },
    toolExecutionReceiptCreate: async () => ({ id: "receipt-1" }),
    toolExecutionReceiptUpdate: async () => undefined,
    gaidActorResolver: resolveActor,
    alignmentGate: alignment("approve"),
    ...overrides,
  });
}

function call(context: Record<string, unknown> = {}) {
  return governedExecuteTool({
    toolName: tool.name, rawParams: tool.args, userId: "user-1", userContext: USER,
    context: { agentId: "AGT-100", threadId: "thread-1", ...context }, source: "external-jsonrpc",
  });
}

function seed(task: CoworkerAuthorityInput["task"] = null): void {
  base = authorityInput(task);
  const binding = buildCoworkerApprovalBinding(base);
  envelope = {
    id: ENVELOPE_ID, status: "approved", resolvedAt: null,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdAt: new Date(Date.now() - 60_000),
    argsJson: { approvalBinding: binding }, approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding),
  };
}

async function recordedOutcome() {
  return findExecutedAuthorityOutcome(buildCoworkerApprovalBinding(base), new Date(), fakeDb as never);
}

beforeEach(() => {
  tool = { name: TOOL, capability: "manage_platform", args: ARGS };
  audits = [];
  execute = vi.fn(async (): Promise<ToolResult> => ({ success: true, message: "created", entityId: "DP-1" }));
  envelopeCreate = vi.fn(async () => ({ id: "ENV-NEW", status: "proposed", expiresAt: new Date(Date.now() + 60_000) }));
  finalize = vi.fn((id: string, success: boolean) => finalizeAuthorityApprovalEnvelope(id, success, fakeDb as never));
  seed();
  install();
});

afterEach(() => {
  _setGovernanceForTests({});
  setBindingEnforcementOverrideForTests(null);
  setGppBindingsOverrideForTests(null);
  vi.unstubAllEnvs();
});

describe("BI-5B34D277 control: the paths that already finalise", () => {
  it("an approved run that succeeds finalises the envelope executed, exactly once", async () => {
    const result = await call();
    expect(result.success).toBe(true);
    expect(envelope.status).toBe("executed");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("a tool handler that throws is caught as tool_threw and finalised failed, exactly once", async () => {
    execute.mockRejectedValueOnce(new Error("handler blew up"));
    const result = await call();
    expect(result).toMatchObject({ success: false, error: "tool_threw" });
    expect(envelope.status).toBe("failed");
    expect(finalize).toHaveBeenCalledTimes(1);
    const retry = await call();
    expect(retry).toMatchObject({ success: false, error: "approval_outcome_failed" });
    expect(retry.message).not.toContain(ALREADY_USED);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("BI-5B34D277: a settled refusal after reservation finalises the approval failed", () => {
  const settledRefusals: Array<[string, string, () => void]> = [
    ["a pre-tool hook denies", "hook_denied", () => install({
      lifecycleHooks: [{ id: "deny-all", onPreToolUse: async () => ({ decision: "deny" as const, reason: "blocked by hook" }) }],
    })],
    ["the WWWD alignment gate declines", "alignment_denied", () => install({ alignmentGate: alignment("decline") })],
    ["the precondition ordering gate declines", "precondition_denied", () => {
      tool = { ...PRECONDITION_TOOL };
      seed();
      install({
      preconditionGate: async () => ({
        verdict: "decline" as const, rationale: "prerequisite missing",
        checks: [{ key: "employee-identity", coherent: true, satisfied: false, evidenceRefs: ["ea:value-stream:onboarding:identity", "prisma:model:EmployeeProfile#employeeId"] }],
      }),
      });
    }],
  ];

  it.each(settledRefusals)("AC-RESERVED-REFUSAL-FINALISED: %s", async (_label, refusal, arrange) => {
    arrange();
    const result = await call();

    expect(result).toMatchObject({ success: false, error: refusal });
    expect(execute).not.toHaveBeenCalled();
    expect({ status: envelope.status, resolved: envelope.resolvedAt !== null }).toEqual({ status: "failed", resolved: true });
    expect(await recordedOutcome()).toMatchObject({
      envelopeId: ENVELOPE_ID, status: "failed", result: expect.objectContaining({ error: refusal }),
    });
  });

  it.each(settledRefusals)("AC-NO-STRANDED-RETRY: %s, then the retry gets the recorded outcome", async (_label, refusal, arrange) => {
    arrange();
    await call();
    const retry = await call();

    expect(retry.message).not.toContain(ALREADY_USED);
    expect(retry).toMatchObject({
      success: false, error: "approval_outcome_failed",
      data: { envelopeId: ENVELOPE_ID, recordedError: refusal },
    });
    expect(execute).not.toHaveBeenCalled();
    expect(envelopeCreate).not.toHaveBeenCalled();
  });
});

/** A human-checkpoint binding promoted to enforcement in this file only. */
const CHECKPOINT: GppBinding = {
  bindingId: "fixture-checkpoint-admit", version: 1, gateKey: "coworker-authority-escalation", authority: "wwwd",
  resolver: { module: "lib/govern/authority/coworker-tool-authority-gate", exportName: "enforceCoworkerToolAuthority" },
  admission: "approved-envelope", tools: [TOOL], toolPredicate: (tool) => tool.consequential, reason: "oai",
};
function enforceCheckpoint(): void {
  vi.stubEnv("DPF_GPP_PERMIT_SECRET", "test-permit-secret-0123456789abcdef");
  vi.stubEnv("DPF_GPP_PERMIT_KEY_ID", "k1");
  vi.stubEnv("DPF_GPP_ENFORCEMENT", "");
  setGppBindingsOverrideForTests([CHECKPOINT, ...GPP_BINDINGS]);
  setBindingEnforcementOverrideForTests({
    [CHECKPOINT.bindingId]: { mode: "enforced", decisionId: "DI-0123456789AB", ratifiedAt: "2026-10-01", evidenceRef: "test", lineage: "sealed-required" },
  });
  const permits: PermitRow[] = [];
  const store: GppPermitStore = {
    createPermit: async (claims, signature) => {
      const row: PermitRow = { ...claims, id: `row-${permits.length + 1}`, useCount: 0, revokedAt: null, keyId: signature?.keyId ?? null, mac: signature?.mac ?? null };
      permits.push(row);
      return row;
    },
    findPermitByPermitId: async (permitId) => permits.find((row) => row.permitId === permitId) ?? null,
    consumePermit: async () => true,
    createObservation: async () => undefined,
    findLineage: async () => ({ found: true, sealed: true }),
  };
  install({ gppPermitStore: store });
}

describe("BI-5B34D277: a refusal that reached no verdict releases the reservation", () => {
  it("AC-RESERVED-REFUSAL-RELEASED + AC-NO-STRANDED-RETRY: receipt_reservation_failed", async () => {
    let ledgerDown = true;
    install({
      toolExecutionReceiptCreate: async () => {
        if (ledgerDown) throw new Error("ledger unavailable");
        return { id: "receipt-1" };
      },
    });
    const refused = await call();
    expect(refused).toMatchObject({ success: false, error: "receipt_reservation_failed" });
    expect({ status: envelope.status, resolvedAt: envelope.resolvedAt }).toEqual({ status: "approved", resolvedAt: null });

    ledgerDown = false;
    const retry = await call();
    expect(retry.message ?? "").not.toContain(ALREADY_USED);
    expect(retry.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(envelope.status).toBe("executed");
  });

  it("AC-RESERVED-REFUSAL-RELEASED + AC-NO-STRANDED-RETRY: the approved task could not be resumed", async () => {
    seed({ taskRunId: "TASK-1", parentTaskRunId: null });
    let resumeDown = true;
    install({
      authorityApprovalTaskResume: async () => { if (resumeDown) throw new Error("task store unavailable"); },
    });
    const refused = await call({ taskRunId: "TASK-1" });
    expect(refused).toMatchObject({ success: false, error: "authority_evidence_unavailable" });
    expect(refused.message).toContain("could not be resumed");
    expect({ status: envelope.status, resolvedAt: envelope.resolvedAt }).toEqual({ status: "approved", resolvedAt: null });

    resumeDown = false;
    const retry = await call({ taskRunId: "TASK-1" });
    expect(retry.message ?? "").not.toContain(ALREADY_USED);
    expect(retry.success).toBe(true);
    expect(envelope.status).toBe("executed");
  });

  it("AC-RESERVED-REFUSAL-RELEASED + AC-NO-STRANDED-RETRY: an enforced binding refuses with permit_required", async () => {
    enforceCheckpoint();
    const refused = await call({ permitHandle: "GPM-00000000-0000-4000-8000-000000000000" });
    expect(refused).toMatchObject({ success: false, error: "permit_required" });
    expect({ status: envelope.status, resolvedAt: envelope.resolvedAt }).toEqual({ status: "approved", resolvedAt: null });

    const retry = await call();
    expect(retry.message ?? "").not.toContain(ALREADY_USED);
    expect(retry.success).toBe(true);
    expect(envelope.status).toBe("executed");
  });

  it("AC-RESERVED-REFUSAL-RELEASED + AC-NO-STRANDED-RETRY: a pre-tool hook throws before the tool runs", async () => {
    let hookBroken = true;
    install({
      lifecycleHooks: [{ id: "flaky", onPreToolUse: async () => { if (hookBroken) throw new Error("hook store unavailable"); } }],
    });
    await expect(call()).rejects.toThrow("hook store unavailable");
    expect({ status: envelope.status, resolvedAt: envelope.resolvedAt }).toEqual({ status: "approved", resolvedAt: null });

    hookBroken = false;
    const retry = await call();
    expect(retry.message ?? "").not.toContain(ALREADY_USED);
    expect(retry.success).toBe(true);
    expect(envelope.status).toBe("executed");
  });
});

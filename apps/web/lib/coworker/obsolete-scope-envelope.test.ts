import { describe, expect, it, vi } from "vitest";
import { fingerprintCoworkerApprovalBinding, fingerprintCoworkerInput } from "@/lib/govern/authority/coworker-authority-decision";
import { settleObsoleteScopeReleaseEnvelopes, type ObsoleteScopeDb } from "./obsolete-scope-envelope";
import { commandPayloadBinding } from "@/lib/work-capsules/command-receipts";

const now = new Date("2026-11-01T12:50:00Z");
function fixture(toolName = "release_workroom_scope", commandId: string | undefined = undefined) {
  const target = { kind: "path", value: "package.json", intent: "edit", recordedByPrincipalId: "human-row",
    releaseEpoch: "00000000-0000-4000-8000-000000000001" };
  const params = { capsuleId: "WC-ORIGINAL", expectedRoomId: "original-room", claims: [target], ...(commandId ? { commandId } : {}) };
  const binding = { actingHumanUserId: "person", actingAgentId: "assistant", chainId: null, taskRunId: null,
    toolName, subject: { kind: "platform" as const, id: "dpf" }, routeContext: null,
    sensitivity: "internal" as const, inputFingerprint: fingerprintCoworkerInput(params), decisionVersionFingerprint: "recorded-policy" };
  const row = { id: "proposal", status: "proposed", resolvedAt: null as Date | null, taskRunId: null as string | null,
    manifestActionId: toolName, delegatingUserId: "person", coworkerAgentId: "assistant", authorityDecisionId: "AUTH-original",
    argsJson: { approvalBinding: binding }, inputFingerprint: binding.inputFingerprint,
    approvalBindingFingerprint: fingerprintCoworkerApprovalBinding(binding), createdAt: now };
  const box = { row, room: { id: "original-room", capsuleId: "WC-ORIGINAL", scopeClaims: [] as unknown[] },
    calls: [{ id: "parked-call", envelopeId: "proposal" as string | null, toolName, userId: "person", agentId: "assistant",
      taskRunId: null as string | null, success: false, parameters: params,
      result: { success: false, error: "approval_required", data: { envelopeId: "proposal" } } }],
    issuance: [{ id: "issued", workCapsuleId: "original-room", kind: "scope-claimed", recordedById: "person" as string | null,
      recordedByAgentId: "assistant" as string | null, payload: { added: [{ ...target, recordedAt: now.toISOString() }], refreshed: [] }, recordedAt: now }],
    decision: { decisionId: "AUTH-original", actorType: "ai-coworker", actorRef: "assistant", humanContextRef: "person",
      agentContextRef: "assistant", organizationId: null, actionKey: toolName, objectRef: "platform:dpf", decision: "require-approval",
      rationale: { chainId: null, taskRunId: null, subjectKind: "platform", authorityOrganizationScope: null }, routeContext: null },
    aliases: [{ aliasType: "user", aliasValue: "person", issuer: "", principalId: "human-row",
      principal: { id: "human-row", kind: "human", status: "active", sensitivityClearance: ["public", "internal", "confidential"] } },
    { aliasType: "agent", aliasValue: "assistant", issuer: "", principalId: "agent-row",
      principal: { id: "agent-row", kind: "agent", status: "active", sensitivityClearance: ["public", "internal", "confidential"] } }],
    agent: { agentId: "assistant", status: "active", archived: false, sensitivity: "internal",
      governanceProfile: { hitlPolicy: "proposal_for_external_writes" } },
    receipt: null as unknown, audit: [] as any[], auditFails: false, loseRace: false };
  const tx: any = {
    $queryRaw: vi.fn(async () => [{ id: "original-room" }]), $executeRaw: vi.fn(async () => 1),
    coworkerActionEnvelope: {
      findMany: vi.fn(async ({ where, take }: any) => box.row.status === "proposed" && box.row.taskRunId === null
        && box.row.resolvedAt === null && (!where.id || box.row.id > where.id.gt) ? [structuredClone(box.row)].slice(0, take) : []),
      findUnique: vi.fn(async () => structuredClone(box.row)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (box.loseRace) box.row.status = "approved";
        if (box.row.status !== where.status || box.row.resolvedAt !== null) return { count: 0 };
        Object.assign(box.row, data); return { count: 1 };
      }),
    },
    toolExecution: { findMany: vi.fn(async () => structuredClone(box.calls)) },
    workroom: { findUnique: vi.fn(async () => structuredClone(box.room)) },
    workroomActivity: { findMany: vi.fn(async () => structuredClone(box.issuance)),
      findFirst: vi.fn(async () => box.receipt), create: vi.fn(async ({ data }: any) => {
        if (box.auditFails) throw Error("audit unavailable"); box.audit.push(data); return { id: "cancel-audit" };
      }) },
    authorizationDecisionLog: { findUnique: vi.fn(async () => structuredClone(box.decision)) },
    principalAlias: { findMany: vi.fn(async () => structuredClone(box.aliases)) },
    user: { findUnique: vi.fn(async () => ({ isActive: true, isSuperuser: true, groups: [], automationExpiresAt: null })) },
    agent: { findUnique: vi.fn(async () => structuredClone(box.agent)) },
  };
  const db: any = { ...tx, $transaction: vi.fn(async (run: (client: unknown) => Promise<unknown>) => {
    const previous = structuredClone(box.row), auditCount = box.audit.length;
    try { return await run(tx); } catch (error) { box.row = previous; box.audit.length = auditCount; throw error; }
  }) };
  return { box, tx, db: db as ObsoleteScopeDb, target, params, binding };
}

describe("proof-based unused scope proposal retirement", () => {
  it.each(["release_workroom_scope", "release_capsule_scope"])("withdraws %s without invoking a release or publishing a command receipt", async tool => {
    const f = fixture(tool);
    const result = await settleObsoleteScopeReleaseEnvelopes(f.db, now);
    expect(result).toMatchObject({ scanned: 1, cancelled: 1, inconclusive: 0 });
    expect(f.box.row.status).toBe("cancelled");
    expect(f.box.audit).toHaveLength(1);
    expect(f.box.audit[0]).toMatchObject({ workCapsuleId: "original-room", kind: "action" });
    expect(f.box.audit[0]).toMatchObject({ recordedById: null, recordedByAgentId: null, payload: { source: "concierge-sweep" } });
    expect(f.box.audit[0].payload).not.toHaveProperty("claims");
    expect(f.box.audit[0].kind).not.toBe("command-accepted");
  });
  it("uses a keyed command's original transaction exactly once", async () => {
    const f = fixture("release_workroom_scope", "original-command");
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 1 });
    expect(f.db.$transaction).toHaveBeenCalledOnce();
  });
  it("correlates a reraised parked record through its canonical result link", async () => {
    const f = fixture(); f.box.calls[0].envelopeId = null;
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 1 });
  });
  it.each(["binding", "actor", "task", "ledger", "overflow", "creator", "copy", "refresh", "duplicate-issuance", "owner", "always", "unknown-policy", "current", "impossible-epoch", "restored-room"])(
    "leaves %s proof failures untouched", async failure => {
      const f = fixture();
      if (failure === "binding") f.box.row.approvalBindingFingerprint = "forged";
      if (failure === "actor") f.box.calls[0].agentId = "foreign";
      if (failure === "task") f.box.calls[0].taskRunId = "TR-running";
      if (failure === "ledger") f.box.calls = [];
      if (failure === "overflow") f.box.calls = Array.from({ length: 26 }, () => structuredClone(f.box.calls[0]));
      if (failure === "creator") f.box.decision.decision = "allow";
      if (failure === "copy") f.box.issuance[0].recordedById = null;
      if (failure === "refresh") { f.box.issuance[0].payload.refreshed = f.box.issuance[0].payload.added as never[]; f.box.issuance[0].payload.added = []; }
      if (failure === "duplicate-issuance") f.box.issuance.push(structuredClone(f.box.issuance[0]));
      if (failure === "owner") f.box.aliases[0].principal.id = "different-owner";
      if (failure === "always") f.box.agent.governanceProfile.hitlPolicy = "always";
      if (failure === "unknown-policy") f.box.agent.governanceProfile.hitlPolicy = "unrecognized-policy";
      if (failure === "current") f.box.room.scopeClaims = [{ ...f.target, recordedAt: now.toISOString() }];
      if (failure === "impossible-epoch") f.box.room.scopeClaims = [{ ...f.target, intent: "read", recordedAt: now.toISOString() }];
      if (failure === "restored-room") f.box.room.id = "different-room";
      expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 0 });
      expect(f.box.row.status).toBe("proposed"); expect(f.box.audit).toHaveLength(0);
    });
  it("preserves a settled command and never calls it never-executed", async () => {
    const f = fixture("release_workroom_scope", "original-command");
    const { commandId: _commandId, ...payload } = f.params;
    f.box.receipt = { kind: "command-accepted", payload: { commandType: "release-scope", target: { kind: "workroom", id: "WC-ORIGINAL" },
      payloadBinding: commandPayloadBinding(payload), result: { success: true } } };
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 0, inconclusive: 1 });
    expect(f.box.row.status).toBe("proposed"); expect(f.box.audit).toHaveLength(0);
  });
  it("loses to a human decision without claiming a cancellation audit", async () => {
    const f = fixture(); f.box.loseRace = true;
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 0 });
    expect(f.box.row.status).toBe("approved"); expect(f.box.audit).toHaveLength(0);
  });
  it("rolls back the cancellation when its original-room audit fails", async () => {
    const f = fixture(); f.box.auditFails = true;
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ cancelled: 0, inconclusive: 1 });
    expect(f.box.row.status).toBe("proposed"); expect(f.box.audit).toHaveLength(0);
  });
  it("advances beyond an inconclusive prefix and resets after the final page", async () => {
    const f = fixture();
    const rows = Array.from({ length: 201 }, (_, index) => ({ ...f.box.row, id: `proposal-${String(index).padStart(3, "0")}` }));
    f.tx.coworkerActionEnvelope.findMany.mockImplementation(async ({ where, take }: any) =>
      rows.filter(row => !where.id || row.id > where.id.gt).slice(0, take));
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ scanned: 200, cancelled: 0,
      inconclusive: 200, hasMore: true, nextCursor: "proposal-199" });
    expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now, "proposal-199")).toMatchObject({ scanned: 1,
      hasMore: false, nextCursor: null });
  });
  it("checkpoints work already inspected when the per-pass time allowance ends", async () => {
    const f = fixture();
    f.tx.coworkerActionEnvelope.findMany.mockResolvedValue(Array.from({ length: 3 }, (_, index) => ({ ...f.box.row, id: `p-${index}` })));
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(21_000);
    try {
      expect(await settleObsoleteScopeReleaseEnvelopes(f.db, now)).toMatchObject({ scanned: 1, inconclusive: 1,
        hasMore: true, nextCursor: "p-0" });
    } finally { clock.mockRestore(); }
  });
});

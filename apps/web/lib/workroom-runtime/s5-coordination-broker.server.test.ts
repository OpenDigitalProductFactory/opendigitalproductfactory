import { describe, expect, it, vi } from "vitest";
import { prepareS5ControlCredential, type S5CredentialCarrier } from "@/lib/auth/s5-room-credential.server";
import type { S5AdmissionCeiling } from "./s5-admission.server";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { createS5CoordinationBroker, type S5CoordinationBrokerPorts } from "./s5-coordination-broker.server";
import type { S5ProposalCall, S5ProposalObservation } from "./s5-coordination-proposal.server";
import { createS5CoordinationWireHandler } from "./s5-coordination-wire.server";

const now = new Date("2026-11-25T12:00:00Z");
const end = new Date(now.getTime() + 60_000);
const receiver = { issuer: "fixture-install", audience: "fixture-control", hostRef: "fixture-host", resource: "https://fixture.invalid/s5" };
const locator = { workroomId: "WC-FIXTURE", sessionRef: "session-a", stageAttemptRef: "attempt-a" };
const subject = { principalId: "PRN-FIXTURE", gaid: "gaid:priv:fixture:agent" };
const activity = "s5-route-handoff";
const recipient = { authorityRef: "authority:fixture", destinationRef: "destination:fixture", reservationRef: "reservation:fixture" };
const post = "post_room_message";
const grants = ["work_room_write"];
const admission: S5AdmissionCeiling = { locator, kind: "composed", issuer: receiver.issuer, stageKey: "coordinate", caseKey: "backlog-item:BI-FIXTURE",
  subject, agentId: "AGT-FIXTURE", activityKey: activity, job: { id: "coordination", version: "1" }, bindingRef: "binding-a",
  authorityBindingId: "binding-row", permitRef: "permit-a", grantKeys: grants, operationKeys: [post],
  host: { hostRef: receiver.hostRef, receiverRef: receiver.audience, mode: "read-only-coordination", worktreeRef: null },
  jsi: { kind: "eligible", qualification: { id: "qualification-a", version: 1, statusRevision: 1 }, validUntil: end.getTime(),
    ceiling: { operationKeys: [post], excludedOperationKeys: [], oversight: "review-before-effect" },
    selector: { organizationId: "org-a", installationId: receiver.issuer, subject, job: { id: "coordination", version: "1" },
      activityKey: activity, scheme: { id: "scheme-a", version: "1" }, profileFingerprint: `sha256:${"a".repeat(64)}`,
      scope: { workflow: "coordination", archetype: "fixture", jurisdiction: "US", dataClass: "synthetic", riskClass: "low" } } } };
const { issuer, audience, hostRef } = receiver;
const call: S5ProposalCall = { issuer, audience, hostRef, ...locator, stageKey: admission.stageKey, caseKey: admission.caseKey, recipient,
  operationId: "room-operation:00000000-0000-4000-8000-000000000003", body: "Propose another qualified reviewer." };

function fixture() {
  const record = prepareS5ControlCredential({ admission, receiver, userId: "user-a", now, expiresAt: end })!;
  const id = "token-a";
  const zero: S5CredentialCarrier & { id: string; userId: string } = { ...record.data, id, revokedAt: null };
  const findUnique = vi.fn(async () => zero as typeof zero | null);
  const receipts = new Map<string, { kind: string; payload: unknown }>();
  const create = vi.fn(async (input: unknown) => {
    const { data } = input as { data: { commandKey?: string; kind: string; payload: unknown } };
    if (data.commandKey) receipts.set(data.commandKey, data);
    return { id: "proposal-activity-a" };
  });
  const query = vi.fn(async (sql: TemplateStringsArray) => sql.join("").includes('"McpApiToken"') ? [{ id }] : [{ id: "row-a" }]);
  const tx: ReceiptDb = { $queryRaw: query, $executeRaw: vi.fn(async () => 0), workroomActivity: {
    create, findFirst: async (input: unknown) => receipts.get((input as { where: { commandKey: string } }).where.commandKey) ?? null,
  } };
  const current = { admission, syntheticCaseKey: call.caseKey, recipient, consequenceAllowed: true };
  const readBoundActor = vi.fn(async () => ({ roomRowId: "row-a", userId: "user-a", agentId: admission.agentId }));
  const checkResultAccess = vi.fn(async () => true);
  const lockOwners = vi.fn(async () => true);
  const readPinnedTokenId = vi.fn(async () => id as string | null);
  const readCurrentProposal = vi.fn(async () => current as typeof current | null);
  const getRequiredGrants = vi.fn(() => grants as readonly string[] | undefined);
  const ports: S5CoordinationBrokerPorts = { db: { ...tx, $transaction: (run) => run(tx) }, operationBindingKey: new Uint8Array(32).fill(1),
    tokenStore: () => ({ mcpApiToken: { findUnique } }), lockOwners, readBoundActor, checkResultAccess, readPinnedTokenId, readCurrentProposal, getRequiredGrants, now: () => now };
  return { broker: createS5CoordinationBroker(ports), record, zero, findUnique, create, query, tx, current, readBoundActor, checkResultAccess,
    readPinnedTokenId, readCurrentProposal, lockOwners, getRequiredGrants, context: { receiver, roomBearer: record.plaintext } };
}

describe("S5 coordination proposal dispatch, without client hooks", () => {
  it("joins the v1 wire to the locked broker without routing through general MCP", async () => {
    const f = fixture();
    const { body, recipient, caseKey, ...binding } = call;
    const wire = createS5CoordinationWireHandler({ broker: f.broker, authenticate: async () => ({ ...f.context, payload: {
      ...binding, schemaVersion: "s5-launch.v1", kind: "coordination-broker-call", operation: post, args: { body, recipient, caseKey },
    } }) });
    const result = await wire(new Request(receiver.resource, { method: "POST" }));
    expect(result).toMatchObject({ kind: "settled", receipt: { ...binding, result: { kind: "proposal-recorded", proposalRef: "proposal-activity-a" } } });
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(await wire(new Request(receiver.resource, { method: "POST" }))).toEqual(result);
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("uses the pinned receiver and live issued/current intersection under the Workroom and credential locks", async () => {
    const f = fixture();
    const result = await f.broker.propose(f.context, call);
    expect(result).toEqual({ kind: "proposal-recorded", operationId: call.operationId, proposalRef: "proposal-activity-a" });
    expect(f.query.mock.calls.map(([sql]) => sql.join("")).flatMap(sql => sql.includes('"WorkCapsule"') ? ["room"] : sql.includes('"McpApiToken"') ? ["token"] : [])).toEqual(["room", "token"]);
    expect(f.readCurrentProposal).toHaveBeenCalledWith(f.tx, expect.anything(), call);
    expect(f.create).toHaveBeenCalledTimes(2);
    expect(await f.broker.propose(f.context, call)).toEqual(result);
    expect(f.create).toHaveBeenCalledTimes(2);
  });

  it("rejects incorrect Control identity, absent owner fence, stale pin and missing read permission before effect lookup", async () => {
    const f = fixture();
    expect(await f.broker.propose({ ...f.context, receiver: { ...receiver, audience: "foreign" } }, call)).toEqual({ kind: "held" });
    expect(f.readBoundActor).not.toHaveBeenCalled();
    f.lockOwners.mockResolvedValueOnce(false);
    expect((await f.broker.propose(f.context, call)).kind).not.toBe("proposal-recorded");
    f.readPinnedTokenId.mockResolvedValueOnce("foreign-token");
    expect((await f.broker.propose(f.context, call)).kind).not.toBe("proposal-recorded");
    f.checkResultAccess.mockResolvedValueOnce(false);
    expect((await f.broker.propose(f.context, call)).kind).not.toBe("proposal-recorded");
    expect(f.readCurrentProposal).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it("holds changed authority, ceiling, synthetic case, recipient or business consequence", async () => {
    const f = fixture();
    for (const change of [{ permitRef: "permit-b" }, { stageKey: "other-stage" }, { operationKeys: ["get_workroom"] }, { grantKeys: ["work_room_read"] }]) {
      f.readCurrentProposal.mockResolvedValueOnce({ ...f.current, admission: { ...admission, ...change } });
      expect((await f.broker.propose(f.context, call)).kind).toBe("held");
    }
    f.readCurrentProposal.mockResolvedValueOnce({ ...f.current, syntheticCaseKey: "other-case" });
    expect((await f.broker.propose(f.context, call)).kind).toBe("held");
    f.readCurrentProposal.mockResolvedValueOnce({ ...f.current, consequenceAllowed: false });
    expect((await f.broker.propose(f.context, call)).kind).toBe("held");
    f.getRequiredGrants.mockReturnValueOnce(undefined);
    expect((await f.broker.propose(f.context, call)).kind).toBe("held");
    expect((await f.broker.propose(f.context, { ...call, recipient: { ...recipient, destinationRef: "foreign" } })).kind).toBe("held");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("does not use a revoked or legacy bearer even to replay an exact submit, and only permits separately authorized observation", async () => {
    const f = fixture();
    const original = await f.broker.propose(f.context, call);
    expect(original.kind).toBe("proposal-recorded");
    f.findUnique.mockResolvedValueOnce({ ...f.zero, revokedAt: now });
    expect((await f.broker.propose(f.context, call)).kind).not.toBe("proposal-recorded");
    f.findUnique.mockResolvedValueOnce({ ...f.zero, kind: "workroom_session" });
    expect((await f.broker.propose(f.context, call)).kind).not.toBe("proposal-recorded");
    const { body: _body, recipient: _recipient, caseKey: _caseKey, ...base } = call;
    const observation: S5ProposalObservation = { ...base, operation: post };
    expect(await f.broker.observe(receiver, observation)).toEqual(original);
    f.checkResultAccess.mockResolvedValueOnce(false);
    expect(await f.broker.observe(receiver, observation)).toEqual({ kind: "unknown" });
    expect(f.create).toHaveBeenCalledTimes(2);
  });
});

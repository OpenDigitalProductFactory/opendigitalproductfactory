import { describe, expect, it, vi } from "vitest";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import { createS5QuietProposalBroker, type S5ProposalCall, type S5ProposalPorts } from "./s5-coordination-proposal.server";

const receiver = { issuer: "fixture-install", audience: "fixture-control", hostRef: "fixture-host" };
const locator = { workroomId: "WC-FIXTURE", sessionRef: "session-a", stageKey: "coordinate", stageAttemptRef: "attempt-a" };
const actor = { roomRowId: "row-a", agentId: "AGT-FIXTURE", userId: "user-a", receiver };
const recipient = { authorityRef: "authority:fixture", destinationRef: "destination:fixture", reservationRef: "reservation:fixture" };
const call: S5ProposalCall = { ...receiver, ...locator, caseKey: "backlog-item:BI-FIXTURE",
  operationId: "room-operation:00000000-0000-4000-8000-000000000001", body: "Synthetic fixture proposal.", recipient };
const observation = { ...receiver, ...locator, operation: "post_room_message" as const, operationId: call.operationId };

function setup() {
  const records = new Map<string, { kind: string; payload: unknown }>();
  const append = vi.fn(async ({ data }) => {
    if (data.commandKey) records.set(`${data.commandScopeKey}:${data.commandKey}`, { kind: data.kind, payload: data.payload });
    return { id: "activity-a" };
  });
  const findFirst = vi.fn(async ({ where }) => records.get(`${where.commandScopeKey}:${where.commandKey}`) ?? null);
  const tx: ReceiptDb = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "row-a" }]), $executeRaw: vi.fn().mockResolvedValue(0),
    workroomActivity: { create: append, findFirst },
  };
  const db: ReceiptDb = { ...tx, $transaction: (run) => run(tx) };
  const checkResultAccess = vi.fn(async () => true);
  const current = { ...receiver, ...locator, agentId: actor.agentId, caseKey: call.caseKey, recipient,
    mode: "read-only-coordination" as const, operationKeys: ["post_room_message"] };
  const readCurrentProposalAuthority = vi.fn(async () => current as typeof current | null);
  const ports: S5ProposalPorts = { db, checkResultAccess, readCurrentProposalAuthority, operationBindingKey: new Uint8Array(32).fill(1) };
  return { broker: createS5QuietProposalBroker(ports), ports, checkResultAccess, readCurrentProposalAuthority, current, append, findFirst, records };
}

describe("S5 no-wake proposal, without client hooks", () => {
  it("writes a quiet durable activity and a receipt, not an ordinary message or a portable content digest", async () => {
    const f = setup();
    const outcome = await f.broker.submit(actor, call);
    expect(outcome).toEqual({ kind: "proposal-recorded", operationId: call.operationId, proposalRef: "activity-a" });
    expect(f.append).toHaveBeenCalledTimes(2);
    expect(f.append.mock.calls[0]![0].data).toMatchObject({ kind: "s5-route-proposal", workCapsuleId: "row-a", payload: { body: call.body, recipient } });
    expect(f.append.mock.calls[1]![0].data).toMatchObject({ kind: "command-accepted", payload: { result: outcome } });
    expect(JSON.stringify(outcome)).not.toMatch(/requestDigest|payloadBinding|Synthetic fixture proposal/i);
  });

  it.each([
    { body: "@someone" }, { addressedTo: ["coordinator"] }, { roleAlias: "accountable" }, { wake: false },
    { caseKey: "backlog-item:BI-OTHER" }, { recipient: { ...recipient, destinationRef: "foreign" } },
  ])("holds malformed, addressing or foreign calls before writing %j", async (mutation) => {
    const f = setup();
    expect((await f.broker.submit(actor, { ...call, ...mutation })).kind).toBe("held");
    expect(f.append).not.toHaveBeenCalled();
  });

  it("holds when release won before commit, but allows exact historical readback after a prior commit", async () => {
    const before = setup();
    before.readCurrentProposalAuthority.mockResolvedValue(null);
    expect((await before.broker.submit(actor, call)).kind).toBe("held");
    expect(before.append).not.toHaveBeenCalled();

    const after = setup();
    const stored = await after.broker.submit(actor, call);
    after.readCurrentProposalAuthority.mockResolvedValue(null);
    expect(await after.broker.readback(actor, call)).toEqual(stored);
    expect(await after.broker.submit(actor, call)).toEqual(stored);
    expect(after.append).toHaveBeenCalledTimes(2);
    expect(after.readCurrentProposalAuthority).toHaveBeenCalledOnce();
    after.checkResultAccess.mockResolvedValue(false);
    expect((await after.broker.readback(actor, call)).kind).toBe("unknown");
  });

  it("does not authorize resend on lookup miss or conflicting reuse of an operation id", async () => {
    const f = setup();
    expect((await f.broker.readback(actor, call)).kind).toBe("unknown");
    expect(f.append).not.toHaveBeenCalled();
    expect((await f.broker.submit(actor, call)).kind).toBe("proposal-recorded");
    expect((await f.broker.submit(actor, { ...call, body: "changed" })).kind).toBe("unknown");
    expect((await f.broker.submit(actor, { ...call, stageAttemptRef: "attempt-b" })).kind).toBe("unknown");
    expect(f.append).toHaveBeenCalledTimes(2);
  });

  it("recovers only the accepted historical result using the opaque ID and exact authorized attempt", async () => {
    const f = setup();
    expect(await f.broker.observe(actor, observation)).toEqual({ kind: "unknown" });
    expect(f.append).not.toHaveBeenCalled();
    const result = await f.broker.submit(actor, call);
    f.readCurrentProposalAuthority.mockResolvedValue(null);
    expect(await f.broker.observe(actor, observation)).toEqual(result);
    expect(f.readCurrentProposalAuthority).toHaveBeenCalledOnce();
    expect(f.append).toHaveBeenCalledTimes(2);

    for (const changes of [{ sessionRef: "session-b" }, { stageKey: "other-stage" }, { stageAttemptRef: "attempt-b" },
      { workroomId: "WC-OTHER" }, { hostRef: "other-host" }, { audience: "other-control" },
      { operation: "get_workroom" }, { body: call.body }, { requestDigest: "extra" }]) {
      expect(await f.broker.observe(actor, { ...observation, ...changes })).toEqual({ kind: "unknown" });
    }
    expect(await f.broker.observe({ ...actor, agentId: "AGT-OTHER" }, observation)).toEqual({ kind: "unknown" });
    expect(await f.broker.observe({ ...actor, userId: "user-b" }, observation)).toEqual({ kind: "unknown" });
    expect(await f.broker.observe({ ...actor, roomRowId: "row-b" }, observation)).toEqual({ kind: "unknown" });
    f.checkResultAccess.mockResolvedValue(false);
    f.findFirst.mockClear();
    expect(await f.broker.observe(actor, observation)).toEqual({ kind: "unknown" });
    expect(f.findFirst).not.toHaveBeenCalled();
    expect(f.append).toHaveBeenCalledTimes(2);
  });

  it("treats legacy, refused and unsafe receipts as unknown on operation-ID-only observation", async () => {
    const f = setup();
    const result = await f.broker.submit(actor, call);
    const [entry] = f.records.values();
    const payload = entry!.payload as { result: unknown; observationBinding?: unknown };
    payload.result = { ...result, body: call.body };
    expect(await f.broker.observe(actor, observation)).toEqual({ kind: "unknown" });
    payload.result = result;
    entry!.kind = "command-rejected";
    expect(await f.broker.observe(actor, observation)).toEqual({ kind: "unknown" });
    entry!.kind = "command-accepted";
    delete payload.observationBinding;
    expect(await f.broker.observe(actor, observation)).toEqual({ kind: "unknown" });
    expect(f.append).toHaveBeenCalledTimes(2);
  });

  it("holds an unsafe historical result instead of forwarding its extra fields", async () => {
    const f = setup();
    const result = await f.broker.submit(actor, call);
    const [entry] = f.records.values();
    const payload = entry!.payload as { result: unknown };
    payload.result = { ...result, requestDigest: "portable-content-is-forbidden" };
    expect(await f.broker.readback(actor, call)).toEqual({ kind: "unknown" });
    expect(await f.broker.submit(actor, call)).toEqual({ kind: "unknown" });
    expect(f.append).toHaveBeenCalledTimes(2);
  });
});

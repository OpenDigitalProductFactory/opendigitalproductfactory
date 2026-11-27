import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../packages/validators/src/workroom/s5-launch.v1.coordination.fixture.json";
import { createS5RehearsalCoordinationHandlers, type S5RehearsalCoordinationWirePorts } from "./s5-rehearsal-coordination-wire.server";

const { schemaVersion: _version, kind: _kind, args, ...binding } = fixture.brokerCall;
const { issuer, audience, hostRef, operationId } = binding;
const receiver = { issuer, audience, hostRef, resource: "https://preview.invalid/control" };
const roomBearer = "fixture-only-room-credential";
const proposalRef = "activity:fixture-proposal";
const recorded = { kind: "proposal-recorded", operationId, proposalRef } as const;
const settled = { kind: "settled", receipt: { ...fixture.brokerReceipt, result: { kind: "proposal-recorded", proposalRef } } };
const proposalRequest = () => new Request(receiver.resource + "/proposal", { method: "POST" });
const receiptRequest = (init?: RequestInit) => new Request(receiver.resource + "/receipt", init);

function setup() {
  const proposalProof = { receiver, roomBearer, payload: fixture.brokerCall };
  const receiptProof = { receiver, observation: binding };
  const authenticatePreviewProposal = vi.fn<S5RehearsalCoordinationWirePorts["authenticatePreviewProposal"]>().mockResolvedValue(proposalProof);
  const authenticatePreviewReceipt = vi.fn<S5RehearsalCoordinationWirePorts["authenticatePreviewReceipt"]>().mockResolvedValue(receiptProof);
  const proposeRehearsal = vi.fn<S5RehearsalCoordinationWirePorts["broker"]["proposeRehearsal"]>().mockResolvedValue(recorded);
  const observe = vi.fn<S5RehearsalCoordinationWirePorts["broker"]["observe"]>().mockResolvedValue(recorded);
  const handler = createS5RehearsalCoordinationHandlers({ authenticatePreviewProposal, authenticatePreviewReceipt, broker: { proposeRehearsal, observe } });
  return { handler, proposalProof, receiptProof, authenticatePreviewProposal, authenticatePreviewReceipt, proposeRehearsal, observe };
}

describe("S5 protected preview coordination", () => {
  it("dispatches the verified proposal to rehearsal only and returns the canonical receipt", async () => {
    const f = setup();
    const request = proposalRequest();
    const result = await f.handler.propose(request);
    const { operation: _operation, ...invocation } = binding;
    expect(result).toEqual(settled);
    expect(f.authenticatePreviewProposal).toHaveBeenCalledExactlyOnceWith(request);
    expect(f.proposeRehearsal).toHaveBeenCalledExactlyOnceWith({ receiver, roomBearer }, { ...invocation, ...args });
    expect(f.authenticatePreviewReceipt).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(roomBearer);
    expect(JSON.stringify(result)).not.toContain(args.body);
  });

  it("recovers the original receipt after a lost reply without resending or reading a body", async () => {
    const f = setup();
    f.proposeRehearsal.mockRejectedValueOnce(new Error("unconfirmed result"));
    expect(await f.handler.propose(proposalRequest())).toEqual({ kind: "unknown" });
    const request = receiptRequest();
    const json = vi.spyOn(request, "json");
    const text = vi.spyOn(request, "text");
    expect(await f.handler.receipt(request)).toEqual(settled);
    expect(f.authenticatePreviewReceipt).toHaveBeenCalledExactlyOnceWith(request);
    expect(f.observe).toHaveBeenCalledExactlyOnceWith(receiver, binding);
    expect(f.proposeRehearsal).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
  });

  it("does not treat a successful write verifier as independent read authority", async () => {
    const f = setup();
    f.authenticatePreviewReceipt.mockResolvedValue(null);
    expect(await f.handler.receipt(receiptRequest({ headers: { Authorization: `Bearer ${roomBearer}` } }))).toEqual({ kind: "held" });
    expect(f.authenticatePreviewProposal).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.proposeRehearsal).not.toHaveBeenCalled();
  });

  it.each([
    { method: "POST", body: "not a lookup" },
    { method: "GET", headers: new Headers({ "content-length": "10" }) },
    { method: "GET", headers: new Headers({ "transfer-encoding": "chunked" }) },
  ])("refuses body-bearing or wrong-method lookup before authentication", async (init) => {
    const f = setup();
    expect(await f.handler.receipt(receiptRequest(init))).toEqual({ kind: "held" });
    expect(f.authenticatePreviewReceipt).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
    expect(f.proposeRehearsal).not.toHaveBeenCalled();
  });

  it.each([
    { ...binding, body: args.body },
    { ...binding, roomBearer },
    { ...binding, operation: "read_room_messages" },
    { ...binding, hostRef: "different-host" },
  ])("does not observe a malformed or cross-receiver locator", async (observation) => {
    const f = setup();
    f.authenticatePreviewReceipt.mockResolvedValue({ receiver, observation });
    expect(await f.handler.receipt(receiptRequest())).toEqual({ kind: "held" });
    expect(f.observe).not.toHaveBeenCalled();
  });

  it("does not dispatch altered proposal framing", async () => {
    const f = setup();
    f.authenticatePreviewProposal.mockResolvedValue({ ...f.proposalProof, payload: { ...fixture.brokerCall, preview: false } });
    expect(await f.handler.propose(proposalRequest())).toEqual({ kind: "held" });
    expect(f.proposeRehearsal).not.toHaveBeenCalled();
  });

  it.each(["foreign", "stale", "expired", "revoked"])("does not dispatch when owner verification refuses %s authority", async () => {
    const f = setup();
    f.authenticatePreviewProposal.mockResolvedValue(null);
    f.authenticatePreviewReceipt.mockResolvedValue(null);
    expect(await f.handler.propose(proposalRequest())).toEqual({ kind: "held" });
    expect(await f.handler.receipt(receiptRequest())).toEqual({ kind: "held" });
    expect(f.proposeRehearsal).not.toHaveBeenCalled();
    expect(f.observe).not.toHaveBeenCalled();
  });

  it("does not invent a receipt for unknown or mismatched readback", async () => {
    const f = setup();
    f.observe.mockResolvedValueOnce({ kind: "unknown" });
    expect(await f.handler.receipt(receiptRequest())).toEqual({ kind: "unknown" });
    f.observe.mockResolvedValueOnce({ ...recorded, operationId: "room-operation:00000000-0000-4000-8000-000000000004" });
    expect(await f.handler.receipt(receiptRequest())).toEqual({ kind: "unknown" });
    expect(f.proposeRehearsal).not.toHaveBeenCalled();
  });
});

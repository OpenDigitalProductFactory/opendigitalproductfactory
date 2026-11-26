import { describe, expect, it, vi } from "vitest";
import { s5BrokerReceiptSchema } from "@dpf/validators/workroom/s5-launch";
import fixture from "../../../../packages/validators/src/workroom/s5-launch.v1.coordination.fixture.json";
import { createS5CoordinationWireHandler, type S5CoordinationWirePorts } from "./s5-coordination-wire.server";

const incoming = fixture.brokerCall;
const { issuer, audience, hostRef } = incoming;
const receiver = { issuer, audience, hostRef, resource: "https://fixture.invalid/s5" };
const roomBearer = "fixture-only-credential";
const proposalRef = "activity:fixture-proposal";

function setup() {
  const request = new Request(receiver.resource, { method: "POST" });
  const verified = { receiver, roomBearer, payload: incoming };
  const authenticate = vi.fn<S5CoordinationWirePorts["authenticate"]>().mockResolvedValue(verified);
  const propose = vi.fn<S5CoordinationWirePorts["broker"]["propose"]>()
    .mockResolvedValue({ kind: "proposal-recorded", operationId: incoming.operationId, proposalRef });
  return { request, verified, authenticate, propose, handler: createS5CoordinationWireHandler({ authenticate, broker: { propose } }) };
}

describe("S5 Control v1 proposal wire", () => {
  it("uses the canonical v1 fixture and returns only the exact proposal receipt", async () => {
    const f = setup();
    const result = await f.handler(f.request);
    expect(f.authenticate).toHaveBeenCalledExactlyOnceWith(f.request);
    const { workroomId, sessionRef, stageKey, stageAttemptRef, operationId, args } = incoming;
    expect(f.propose).toHaveBeenCalledExactlyOnceWith({ receiver, roomBearer }, {
      issuer, audience, hostRef, workroomId, sessionRef, stageKey, stageAttemptRef, operationId, ...args,
    });
    expect(result).toEqual({ kind: "settled", receipt: { ...fixture.brokerReceipt, result: { kind: "proposal-recorded", proposalRef } } });
    expect(result.kind === "settled" && s5BrokerReceiptSchema.safeParse(result.receipt).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(roomBearer);
    expect(JSON.stringify(result)).not.toContain(incoming.args.body);
  });

  it.each([null, { receiver: { ...receiver, audience: "other-control" }, roomBearer, payload: incoming }])
    ("does not dispatch an unauthenticated or cross-receiver call", async (verified) => {
      const f = setup();
      f.authenticate.mockResolvedValue(verified);
      expect(await f.handler(f.request)).toEqual({ kind: "held" });
      expect(f.propose).not.toHaveBeenCalled();
    });

  it.each([
    { ...incoming, operation: "get_workroom", args: {} },
    { ...incoming, operation: "read_room_messages", args: {} },
    { ...incoming, schemaVersion: "s5-launch.v1.1" },
    { ...incoming, args: { ...incoming.args, addressedTo: ["fixture-member"] } },
    { ...incoming, roomBearer },
  ])("keeps unpublished operations and unbound fields out of the broker", async (payload) => {
    const f = setup();
    f.authenticate.mockResolvedValue({ ...f.verified, payload });
    expect(await f.handler(f.request)).toEqual({ kind: "held" });
    expect(f.propose).not.toHaveBeenCalled();
  });

  it("does not synthesize a settled receipt from a hold, unknown outcome, or wrong operation id", async () => {
    const f = setup();
    f.propose.mockResolvedValueOnce({ kind: "held" });
    expect(await f.handler(f.request)).toEqual({ kind: "held" });
    f.propose.mockResolvedValueOnce({ kind: "unknown" });
    expect(await f.handler(f.request)).toEqual({ kind: "unknown" });
    f.propose.mockResolvedValueOnce({ kind: "proposal-recorded", operationId: "room-operation:00000000-0000-4000-8000-000000000004", proposalRef });
    expect(await f.handler(f.request)).toEqual({ kind: "unknown" });
  });
});

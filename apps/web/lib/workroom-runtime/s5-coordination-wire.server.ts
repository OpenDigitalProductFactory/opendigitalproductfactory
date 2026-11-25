import { s5BrokerCallSchema, s5BrokerReceiptSchema, type S5BrokerReceipt } from "@dpf/validators/workroom/s5-launch";
import type { S5AuthenticatedControl } from "@/lib/auth/s5-room-credential.server";
import type { createS5CoordinationBroker } from "./s5-coordination-broker.server";

export type S5CoordinationWirePorts = {
  /** Server-owned transport proof. Verify the registration, receiver and exact
   * received payload together. The room bearer travels separately from JSON. */
  authenticate: (request: Request) => Promise<{
    receiver: S5AuthenticatedControl;
    roomBearer: string;
    payload: unknown;
  } | null>;
  broker: Pick<ReturnType<typeof createS5CoordinationBroker>, "propose">;
};

type WireOutcome = { kind: "settled"; receipt: S5BrokerReceipt } | { kind: "held" } | { kind: "unknown" };

/** An adapter for the protected Control transport, not a public route or MCP
 * handler. v1 accepts only proposals. The v1.1 successor owns the other methods. */
export function createS5CoordinationWireHandler(ports: S5CoordinationWirePorts) {
  return async (request: Request): Promise<WireOutcome> => {
    try {
      if (request.method !== "POST") return { kind: "held" };
      const verified = await ports.authenticate(request);
      if (!verified) return { kind: "held" };
      const parsed = s5BrokerCallSchema.safeParse(verified.payload);
      if (!parsed.success) return { kind: "held" };
      const call = parsed.data;
      const { receiver, roomBearer } = verified;
      if (call.issuer !== receiver.issuer || call.audience !== receiver.audience || call.hostRef !== receiver.hostRef) return { kind: "held" };
      const { kind: _kind, schemaVersion, operation, args, ...binding } = call;
      const result = await ports.broker.propose({ receiver, roomBearer }, { ...binding, ...args });
      if (result.kind !== "proposal-recorded") return { kind: result.kind };
      if (result.operationId !== call.operationId) return { kind: "unknown" };
      const receipt = s5BrokerReceiptSchema.safeParse({ kind: "coordination-broker-receipt", schemaVersion, operation, ...binding,
        result: { kind: "proposal-recorded", proposalRef: result.proposalRef } });
      // Do not invent a v1 `refused` receipt. A hold is not durable no-effect.
      return receipt.success ? { kind: "settled", receipt: receipt.data } : { kind: "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  };
}

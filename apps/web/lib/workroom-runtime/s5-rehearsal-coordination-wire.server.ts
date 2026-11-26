import { S5_LAUNCH_WIRE_VERSION, s5BrokerReceiptSchema, type S5BrokerReceipt } from "@dpf/validators/workroom/s5-launch";
import type { S5AuthenticatedControl } from "@/lib/auth/s5-room-credential.server";
import type { createS5CoordinationBroker } from "./s5-coordination-broker.server";
import { s5ProposalObservationSchema } from "./s5-coordination-proposal.server";
import { createS5CoordinationWireHandler, type S5CoordinationWirePorts } from "./s5-coordination-wire.server";

export type S5RehearsalCoordinationWirePorts = {
  /** Reviewed transport and current preview owner must bind the unchecked request
   * to the exact proposal action, enrolled attempt, receiver, and payload. */
  authenticatePreviewProposal: S5CoordinationWirePorts["authenticate"];
  /** Separate current lookup authority, bound to the same preview and original
   * receipt locator. Never authenticate with the proposal room credential. */
  authenticatePreviewReceipt: (request: Request) => Promise<{
    receiver: S5AuthenticatedControl;
    observation: unknown;
  } | null>;
  broker: Pick<ReturnType<typeof createS5CoordinationBroker>, "proposeRehearsal" | "observe">;
};

type Outcome = { kind: "settled"; receipt: S5BrokerReceipt } | { kind: "held" } | { kind: "unknown" };

/** S5's receiving handlers only. No route is registered here. The protected
 * preview composition must supply both verified S6 actions before exposure. */
export function createS5RehearsalCoordinationHandlers(ports: S5RehearsalCoordinationWirePorts) {
  const propose = createS5CoordinationWireHandler({
    authenticate: ports.authenticatePreviewProposal,
    broker: { propose: ports.broker.proposeRehearsal },
  });

  async function receipt(request: Request): Promise<Outcome> {
    try {
      const length = request.headers.get("content-length");
      if (request.method !== "GET" || request.body !== null || request.headers.has("transfer-encoding")
        || (length !== null && length !== "0")) return { kind: "held" };
      const verified = await ports.authenticatePreviewReceipt(request);
      if (!verified) return { kind: "held" };
      const parsed = s5ProposalObservationSchema.safeParse(verified.observation);
      if (!parsed.success) return { kind: "held" };
      const observation = parsed.data;
      const { receiver } = verified;
      if (observation.issuer !== receiver.issuer || observation.audience !== receiver.audience
        || observation.hostRef !== receiver.hostRef) return { kind: "held" };

      const result = await ports.broker.observe(receiver, observation);
      if (result.kind !== "proposal-recorded" || result.operationId !== observation.operationId) return { kind: "unknown" };
      const exact = s5BrokerReceiptSchema.safeParse({
        ...observation, kind: "coordination-broker-receipt", schemaVersion: S5_LAUNCH_WIRE_VERSION,
        result: { kind: "proposal-recorded", proposalRef: result.proposalRef },
      });
      return exact.success ? { kind: "settled", receipt: exact.data } : { kind: "unknown" };
    } catch {
      return { kind: "unknown" };
    }
  }

  return { propose, receipt };
}

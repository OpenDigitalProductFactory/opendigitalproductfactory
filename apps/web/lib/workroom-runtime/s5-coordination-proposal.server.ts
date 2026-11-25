import { createHash, createHmac } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { z } from "zod";
import { isRecord } from "@/lib/shared/coerce";
import { lookupReceiptedCommand, observeAcceptedCommand, runReceiptedCommand, type ReceiptDb } from "@/lib/work-capsules/command-receipts";

const ref = z.string().min(1).max(256).regex(/^[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/u);
const receiver = { issuer: ref, audience: ref, hostRef: ref };
const recipient = z.strictObject({ authorityRef: ref, destinationRef: ref, reservationRef: ref });
const operationId = z.string().regex(/^room-operation:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
const operation = "post_room_message";
const exactInvocation = { ...receiver, workroomId: ref, sessionRef: ref, stageKey: ref, stageAttemptRef: ref, operationId };
const proposalObservation = z.strictObject({ ...exactInvocation, operation: z.literal(operation) });
// Internal effect input, after the transport's versioned broker envelope is
// checked. Keep the no-addressing invariant even for future internal callers.
const quietProposal = z.strictObject({
  ...exactInvocation,
  caseKey: ref,
  body: z.string().min(1).max(2_000).regex(/^[^@]+$/u),
  recipient,
});

export type S5ProposalCall = z.infer<typeof quietProposal>;
export type S5ProposalObservation = z.infer<typeof proposalObservation>;
type ControlIdentity = Pick<S5ProposalCall, keyof typeof receiver>;
type ProposalActor = Readonly<{
  roomRowId: string;
  userId: string;
  agentId: string;
  /** Comes from the authenticated Control transport, never the request body. */
  receiver: ControlIdentity;
}>;
type LiveProposalAuthority = Pick<S5ProposalCall, "issuer" | "audience" | "hostRef" | "workroomId" | "sessionRef" | "stageKey" | "stageAttemptRef" | "caseKey" | "recipient"> &
  { mode: "read-only-coordination"; agentId: string; operationKeys: readonly string[] };

export type S5ProposalPorts = {
  db: ReceiptDb;
  /** Installation-owned, domain-separated secret. Never a launch or receipt field. */
  operationBindingKey: Uint8Array | null;
  /** Owner-specific authorization locks, if required, precede the Workroom lock. No network I/O. */
  beforeRoomLock?: (tx: ReceiptDb, actor: ProposalActor, observation: S5ProposalObservation) => Promise<void>;
  /** Read authorization is separate from effect admission, including after release. */
  checkResultAccess: (tx: ReceiptDb, actor: ProposalActor, observation: S5ProposalObservation) => Promise<boolean>;
  /** The owner re-reads all live state under the effect fence. Hold on missing/stale evidence. */
  readCurrentProposalAuthority: (tx: ReceiptDb, actor: ProposalActor, call: S5ProposalCall) => Promise<LiveProposalAuthority | null>;
  /** Protected adapters can require a final clock check with no awaited work before the insert. */
  beforeProposalWrite?: () => boolean;
};

const recordedProposal = z.strictObject({ kind: z.literal("proposal-recorded"), operationId, proposalRef: ref });
type RecordedProposal = z.infer<typeof recordedProposal>;
type ProposalObservationResult = RecordedProposal | { kind: "unknown" };
type ProposalResult = ProposalObservationResult | { kind: "held" };
class ProposalHeld extends Error {}
const denied = (): ProposalResult => ({ kind: "held" });
const unknown = (): { kind: "unknown" } => ({ kind: "unknown" });
const sameControl = (a: ControlIdentity, b: ControlIdentity) => a.issuer === b.issuer && a.audience === b.audience && a.hostRef === b.hostRef;

function exactResult(result: unknown, id: string): ProposalObservationResult {
  const parsed = recordedProposal.safeParse(result);
  return parsed.success && parsed.data.operationId === id ? parsed.data : unknown();
}

function observeCall(call: S5ProposalCall): S5ProposalObservation {
  const { issuer, audience, hostRef, workroomId, sessionRef, stageKey, stageAttemptRef, operationId } = call;
  return { issuer, audience, hostRef, workroomId, sessionRef, stageKey, stageAttemptRef, operation, operationId };
}

/** Appends a Workroom activity and its command receipt, with no room-message
 * insert, outbox, event publisher, notification or provider dependency. */
export function createS5QuietProposalBroker(ports: S5ProposalPorts) {
  const bindingSecret = ports.operationBindingKey ? Buffer.from(ports.operationBindingKey) : null;
  function identity(actor: ProposalActor, observation: S5ProposalObservation) {
    if (!bindingSecret || bindingSecret.length < 32 || !actor.roomRowId || !actor.userId || !actor.agentId || !sameControl(actor.receiver, observation)) return null;
    // Scope is stable for that sender across workrooms and attempts, so reuse of
    // the same random operationId cannot start an effect on another attempt.
    const scope = createHash("sha256").update(canonicalJson([actor.receiver.issuer, actor.receiver.audience])).digest("hex");
    return {
      db: ports.db,
      authorityScopeKey: `s5-proposal:${scope}`,
      commandId: observation.operationId,
      commandType: `s5.${operation}`,
      target: { kind: "workroom", id: observation.workroomId },
      expectedRoomRowId: actor.roomRowId,
      observationBinding: { version: 1 as const, digest: createHmac("sha256", bindingSecret)
        .update(canonicalJson(["s5-proposal-observation.v1", actor.roomRowId, actor.agentId, actor.userId, observation])).digest("hex") },
      beforeRoomLock: ports.beforeRoomLock ? (tx: ReceiptDb) => ports.beforeRoomLock!(tx, actor, observation) : undefined,
      beforeReceiptRead: (tx: ReceiptDb) => ports.checkResultAccess(tx, actor, observation),
    };
  }

  function exactCommand(actor: ProposalActor, call: S5ProposalCall) {
    const command = identity(actor, observeCall(call));
    if (!command || !bindingSecret) return null;
    return {
      ...command,
      // An internal match binding, not an unkeyed commitment to guessable body
      // text. It is never returned to Control or used to infer effect from a miss.
      payloadBinding: { version: 1 as const, digest: createHmac("sha256", bindingSecret)
        .update(canonicalJson(["s5-proposal.v1", actor.roomRowId, actor.agentId, actor.userId, call])).digest("hex") },
    };
  }

  async function submit(actor: ProposalActor, input: S5ProposalCall): Promise<ProposalResult> {
    try {
      const parsed = quietProposal.safeParse(input);
      if (!parsed.success) return denied();
      const call = parsed.data;
      const command = exactCommand(actor, call);
      if (!command) return denied();
      const result = await runReceiptedCommand<RecordedProposal>({
        ...command,
        actor: { userId: actor.userId, agentId: actor.agentId },
        run: async (tx) => {
          const current = await ports.readCurrentProposalAuthority(tx, actor, call);
          if (!current || !sameControl(current, call) || current.mode !== "read-only-coordination" || current.agentId !== actor.agentId
            || current.workroomId !== call.workroomId || current.sessionRef !== call.sessionRef || current.stageKey !== call.stageKey || current.stageAttemptRef !== call.stageAttemptRef
            || current.caseKey !== call.caseKey || !current.operationKeys.includes(operation)
            || canonicalJson(current.recipient) !== canonicalJson(call.recipient)) throw new ProposalHeld();

          if (ports.beforeProposalWrite && ports.beforeProposalWrite() !== true) throw new ProposalHeld();

          const activity = await tx.workroomActivity.create({
            data: {
              kind: "s5-route-proposal", workCapsuleId: actor.roomRowId, summary: "A coordination route was proposed; no recipient was notified.",
              payload: { caseKey: call.caseKey, sessionRef: call.sessionRef, stageAttemptRef: call.stageAttemptRef,
                operationId: call.operationId, body: call.body, recipient: call.recipient },
              recordedById: actor.userId,
              recordedByAgentId: actor.agentId,
            },
            select: { id: true },
          });
          if (!isRecord(activity)) throw new Error("Proposal activity identity unavailable.");
          return recordedProposal.parse({ kind: "proposal-recorded", operationId: call.operationId, proposalRef: activity.id });
        },
      });
      return exactResult(result, call.operationId);
    } catch (error) {
      return error instanceof ProposalHeld ? denied() : unknown();
    }
  }

  async function readback(actor: ProposalActor, input: S5ProposalCall): Promise<ProposalResult> {
    try {
      const parsed = quietProposal.safeParse(input);
      if (!parsed.success) return unknown();
      const command = exactCommand(actor, parsed.data);
      if (!command) return unknown();
      const receipt = await lookupReceiptedCommand<RecordedProposal>(command);
      return receipt.kind === "settled" ? exactResult(receipt.result, parsed.data.operationId) : unknown();
    } catch {
      return unknown();
    }
  }

  async function observe(actor: ProposalActor, input: unknown): Promise<ProposalObservationResult> {
    try {
      const parsed = proposalObservation.safeParse(input);
      if (!parsed.success) return unknown();
      const command = identity(actor, parsed.data);
      if (!command) return unknown();
      return exactResult(await observeAcceptedCommand(command), parsed.data.operationId);
    } catch {
      return unknown();
    }
  }
  return { submit, readback, observe };
}

import {
  narrowS5CredentialForCurrentAdmission, resolveS5ControlCredential, type S5AuthenticatedControl,
} from "@/lib/auth/s5-room-credential.server";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { hashWorkroomSessionBearer, isGeneratedWorkroomSessionBearer, S5_WORKROOM_TOKEN_KIND } from "@/lib/auth/workroom-session-token";
import type { ReceiptDb } from "@/lib/work-capsules/command-receipts";
import type { S5AdmissionCeiling, S5AttemptLocator } from "./s5-admission.server";
import { createS5QuietProposalBroker, type S5ProposalCall, type S5ProposalObservation, type S5ProposalPorts } from "./s5-coordination-proposal.server";

const operation = "post_room_message";
type BoundActor = { roomRowId: string; userId: string; agentId: string };
type Actor = BoundActor & { receiver: S5AuthenticatedControl };
type Issued = NonNullable<Awaited<ReturnType<typeof resolveS5ControlCredential>>>;
type LockedCredential = Issued & { attemptExpiresAt: number };
type AuthenticatedContext = { receiver: S5AuthenticatedControl; roomBearer: string };
type CurrentProposal = {
  admission: S5AdmissionCeiling;
  /** Owner-verified synthetic case and references, never copied from request args. */
  syntheticCaseKey: string;
  recipient: S5ProposalCall["recipient"];
  consequenceAllowed: boolean;
};

export type S5CoordinationBrokerPorts = {
  db: ReceiptDb;
  operationBindingKey: Uint8Array | null;
  tokenStore: (tx: ReceiptDb) => Parameters<typeof resolveS5ControlCredential>[0];
  /** Map an independently authenticated receiver and exact locator to the stored actor.
   * The initial result targets the lock only and is revalidated while locked. */
  readBoundActor: (receiver: S5AuthenticatedControl, locator: S5AttemptLocator) => Promise<BoundActor | null>;
  /** S6/T2 and current qualification owner fences (JSI or rehearsal approval).
   * Missing or unproved locks must hold. No network. */
  lockOwners: (tx: ReceiptDb, actor: Actor, locator: S5AttemptLocator, usage: "propose" | "observe") => Promise<boolean>;
  checkResultAccess: (tx: ReceiptDb, actor: Actor, observation: S5ProposalObservation) => Promise<boolean>;
  /** Read the active attempt's original token/deadline pin under its row lock.
   * Neither an echoed deadline nor a freshly extended permit can replace it. */
  readPinnedAttempt: (tx: ReceiptDb, actor: Actor, locator: S5AttemptLocator) => Promise<{ tokenId: string; expiresAt: number } | null>;
  /** Recompose live authorization and check GPP, exact case and expected recipient
   * from their owners. It must use the locked transaction, never caller-supplied facts. */
  readCurrentProposal: (tx: ReceiptDb, actor: Actor, call: S5ProposalCall) => Promise<CurrentProposal | null>;
  /** Canonical deployed registry grants for this operation. No missing-entry fallback. */
  getRequiredGrants: (name: string) => readonly string[] | undefined;
  now?: () => Date;
};

function locatorOf({ workroomId, sessionRef, stageAttemptRef }: S5AttemptLocator): S5AttemptLocator {
  return { workroomId, sessionRef, stageAttemptRef };
}

function sameReceiver(receiver: S5AuthenticatedControl, input: Pick<S5ProposalCall, "issuer" | "audience" | "hostRef">): boolean {
  return receiver.issuer === input.issuer && receiver.audience === input.audience && receiver.hostRef === input.hostRef;
}

function sameAttempt(issued: Issued, actor: Actor, observation: S5ProposalObservation): boolean {
  const value = issued.ceiling.projection;
  return issued.userId === actor.userId && value.agentId === actor.agentId && value.workroomId === observation.workroomId
    && value.sessionRef === observation.sessionRef && value.stageKey === observation.stageKey && value.stageAttemptRef === observation.stageAttemptRef
    && value.mode === "read-only-coordination" && value.operationKeys.includes(operation);
}

/** Internal Control adapter. It accepts only inputs from the authenticated
 * transport, never generic MCP. Network-facing registrations are separate. */
export function createS5CoordinationBroker(ports: S5CoordinationBrokerPorts) {
  const now = ports.now ?? (() => new Date());

  async function actorFor(receiver: S5AuthenticatedControl, input: S5ProposalCall | S5ProposalObservation): Promise<Actor | null> {
    if (!sameReceiver(receiver, input)) return null;
    const bound = await ports.readBoundActor(receiver, locatorOf(input));
    return bound ? { ...bound, receiver } : null;
  }

  async function lockedCredential(tx: ReceiptDb, actor: Actor, observation: S5ProposalObservation, bearer: string): Promise<LockedCredential | null> {
    if (!tx.$queryRaw || !isGeneratedWorkroomSessionBearer(bearer)) return null;
    // Workroom is already locked. Serialize with synchronous release and with
    // credential-only admin revocation, which need not take the room lock.
    const rows = await tx.$queryRaw`SELECT "id" FROM "McpApiToken"
      WHERE "tokenHash" = ${hashWorkroomSessionBearer(bearer)} AND "kind" = ${S5_WORKROOM_TOKEN_KIND} FOR UPDATE` as Array<{ id: string }>;
    const id = rows.length === 1 ? rows[0]?.id : null;
    if (!id) return null;
    const pin = await ports.readPinnedAttempt(tx, actor, locatorOf(observation));
    const instant = now();
    if (!pin || pin.tokenId !== id || !Number.isSafeInteger(pin.expiresAt) || !(instant.getTime() < pin.expiresAt)) return null;
    const issued = await resolveS5ControlCredential(ports.tokenStore(tx), bearer, actor.receiver, instant);
    return issued?.tokenId === id && sameAttempt(issued, actor, observation) ? { ...issued, attemptExpiresAt: pin.expiresAt } : null;
  }

  function boundBroker(actor: Actor, usage: "propose" | "observe", extra: Pick<S5ProposalPorts, "checkResultAccess" | "readCurrentProposalAuthority" | "beforeProposalWrite">) {
    return createS5QuietProposalBroker({ db: ports.db, operationBindingKey: ports.operationBindingKey, ...extra,
      beforeRoomLock: async (tx, _actor, observation) => {
        if (await ports.lockOwners(tx, actor, locatorOf(observation), usage) !== true) throw new Error("Owner fence unavailable.");
      } });
  }

  async function proposeFor(context: AuthenticatedContext, input: S5ProposalCall, profile: "v1" | "synthetic-rehearsal") {
    try {
      if (!isGeneratedWorkroomSessionBearer(context.roomBearer)) return { kind: "held" } as const;
      const actor = await actorFor(context.receiver, input);
      if (!actor) return { kind: "held" } as const;
      let issued: LockedCredential | null = null;
      let effectDeadline = Number.NaN;
      return await boundBroker(actor, "propose", {
        checkResultAccess: async (tx, _actor, observation) => {
          if (await ports.checkResultAccess(tx, actor, observation) !== true) return false;
          issued = await lockedCredential(tx, actor, observation, context.roomBearer);
          return issued?.ceiling.projection.jsi.kind === (profile === "synthetic-rehearsal" ? "rehearsal-qualification" : "eligible");
        },
        readCurrentProposalAuthority: async (tx, _actor, call) => {
          if (!issued) return null;
          const current = await ports.readCurrentProposal(tx, actor, call);
          if (!current || current.consequenceAllowed !== true || current.syntheticCaseKey !== call.caseKey) return null;
          const { admission } = current;
          if (admission.jsi.kind === "not-applicable" || !Number.isSafeInteger(admission.jsi.validUntil)
            || (profile === "synthetic-rehearsal") !== (admission.jsi.kind === "rehearsal-qualification")) return null;
          if (admission.jsi.kind === "rehearsal-qualification"
            && (admission.jsi.syntheticTarget.caseKey !== call.caseKey
              || canonicalJson(admission.jsi.syntheticTarget.recipient) !== canonicalJson(current.recipient))) return null;
          effectDeadline = Math.min(issued.attemptExpiresAt, issued.ceiling.expiresAt.getTime(), admission.jsi.validUntil);
          const effective = narrowS5CredentialForCurrentAdmission(issued.ceiling, admission, now());
          const required = ports.getRequiredGrants(operation);
          if (!effective?.operationKeys.includes(operation) || !required?.length
            || !required.every(key => effective.grantKeys.includes(key))) return null;
          return { issuer: admission.issuer, audience: admission.host.receiverRef, hostRef: admission.host.hostRef,
            ...admission.locator, stageKey: admission.stageKey, caseKey: admission.caseKey,
            recipient: current.recipient, agentId: admission.agentId, mode: "read-only-coordination", operationKeys: effective.operationKeys };
        },
        beforeProposalWrite: () => now().getTime() < effectDeadline,
      }).submit(actor, input);
    } catch {
      return { kind: "unknown" } as const;
    }
  }

  /** Independent current result access only. There is no effect callback and no
   * bearer fallback. The body-free observation wire is tracked in BI-588688A7. */
  async function observe(receiver: S5AuthenticatedControl, input: S5ProposalObservation) {
    try {
      const actor = await actorFor(receiver, input);
      if (!actor) return { kind: "unknown" } as const;
      return await boundBroker(actor, "observe", {
        checkResultAccess: (tx, _actor, observation) => ports.checkResultAccess(tx, actor, observation),
        readCurrentProposalAuthority: async () => null,
      }).observe(actor, input);
    } catch {
      return { kind: "unknown" } as const;
    }
  }

  return {
    propose: (context: AuthenticatedContext, input: S5ProposalCall) => proposeFor(context, input, "v1"),
    // Unregistered, not reachable from the v1 wire or generic MCP.
    proposeRehearsal: (context: AuthenticatedContext, input: S5ProposalCall) => proposeFor(context, input, "synthetic-rehearsal"),
    observe,
  };
}

/**
 * Deliberation → Work Room verdict sealing (EP-DELIBERATION-ROOMS, BI-F8C5444A).
 *
 * Harmonizes the deliberation/debate pattern onto the Work Room substrate: a
 * finished deliberation becomes a finite `task-node` room whose verdict is sealed
 * as a durable WorkRoomOutcomePacket, referencing the canonical DeliberationOutcome
 * (satisfies raw_chat_not_durable). A real consensus seals `achieved`/
 * `partially-achieved`; no-consensus/insufficient-evidence seals `not-achieved` —
 * the signal an operator reviews (and the alternate close = escalation).
 *
 * Pure module: no DB. The server bridge (deliberation-room-bridge.server.ts)
 * materializes the room and persists the packet as a work-room-outcome-packet
 * message. Design of record:
 * docs/superpowers/specs/2026-08-12-work-room-multi-agent-communication-substrate-design.md §3
 */
import { WORK_ROOM_OUTCOME_MESSAGE_TYPE } from "../work-management/room-cycle-adapter";
import { buildWorkRoomOutcomePacket } from "../work-management/outcome-packet";
import type { WorkRoomOutcomePacket } from "../work-management/room-types";

/** The registry sourceKey a deliberation room projects through (finite, evidence-only). */
export const DELIBERATION_ROOM_SOURCE_KEY = "task-node";

/** Map a deliberation consensus state to a room outcome state. */
export function mapConsensusToOutcomeState(consensusState: string): WorkRoomOutcomePacket["outcomeState"] {
  switch (consensusState) {
    case "consensus":
      return "achieved";
    case "partial-consensus":
      return "partially-achieved";
    default:
      // no-consensus | insufficient-evidence | anything unrecognized → not achieved.
      return "not-achieved";
  }
}

/** True when the verdict did not reach consensus — the escalation / needs-review signal. */
export function verdictNeedsEscalation(consensusState: string): boolean {
  return consensusState !== "consensus" && consensusState !== "partial-consensus";
}

export interface DeliberationRoomSealInput {
  deliberationRunId: string;
  /** The adjudicator TaskNode id — the room's sourceId (sourceType "task-node"). */
  adjudicatorTaskNodeId: string;
  /** Canonical DeliberationOutcome record id — the durable evidence ref. */
  deliberationOutcomeId: string;
  consensusState: string;
  mergedRecommendation: string;
  accountablePrincipalRef: string;
  completedAt: Date | string;
}

export interface StoredDeliberationOutcome {
  kind: typeof WORK_ROOM_OUTCOME_MESSAGE_TYPE;
  version: 1;
  cycleKey: string;
  carrierId: string;
  packet: WorkRoomOutcomePacket;
}

/**
 * Build the sealed outcome packet + the stored-message payload for a deliberation
 * verdict. Pure — throws WorkRoomOutcomePacketError on an invalid packet (e.g. a
 * raw-chat evidence ref), never here.
 */
export function buildDeliberationOutcomeSeal(input: DeliberationRoomSealInput): {
  packet: WorkRoomOutcomePacket;
  storedPayload: StoredDeliberationOutcome;
} {
  const outcomeState = mapConsensusToOutcomeState(input.consensusState);
  const summary =
    input.mergedRecommendation.trim() ||
    `Deliberation ${input.deliberationRunId} reached ${input.consensusState}.`;

  const packet = buildWorkRoomOutcomePacket({
    sourceKey: DELIBERATION_ROOM_SOURCE_KEY,
    outcomeState,
    summary,
    accountablePrincipalRef: input.accountablePrincipalRef,
    completedAt: input.completedAt,
    facts: [
      {
        category: "evidence",
        provenance: "canonical",
        sourceRef: { kind: "evidence", id: input.deliberationOutcomeId },
      },
    ],
  });

  return {
    packet,
    storedPayload: {
      kind: WORK_ROOM_OUTCOME_MESSAGE_TYPE,
      version: 1,
      cycleKey: input.deliberationRunId,
      carrierId: input.adjudicatorTaskNodeId,
      packet,
    },
  };
}

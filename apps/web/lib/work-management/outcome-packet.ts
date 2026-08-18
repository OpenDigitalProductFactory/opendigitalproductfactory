import { dedupeRoomSourceRefs, roomText } from "./room-projection-utils";
import { getWorkCaseSourceEntry } from "./source-registry";
import type {
  WorkroomOutcomePacket,
  WorkroomOutcomePacketCategory,
} from "./room-types";
import type { WorkCaseSourceRef } from "./case-types";

export type WorkroomOutcomeFactProvenance = "canonical" | "raw-chat";

export interface WorkroomOutcomeFact {
  category: WorkroomOutcomePacketCategory;
  sourceRef: WorkCaseSourceRef;
  provenance: WorkroomOutcomeFactProvenance;
}

export interface BuildWorkroomOutcomePacketInput {
  sourceKey: string;
  outcomeState: WorkroomOutcomePacket["outcomeState"];
  summary: string;
  facts: readonly WorkroomOutcomeFact[];
  unresolvedWork?: WorkroomOutcomePacket["unresolvedWork"];
  accountablePrincipalRef: string;
  verifiedByRef?: string | null;
  completedAt: Date | string;
  nextReviewAt?: Date | string | null;
  sourceRefs?: readonly WorkCaseSourceRef[];
}

export type WorkroomOutcomePacketErrorReason =
  | "unknown_source"
  | "missing_summary"
  | "missing_accountable"
  | "invalid_completed_at"
  | "raw_chat_not_durable"
  | "missing_required_category"
  | "invalid_unresolved_disposition";

export class WorkroomOutcomePacketError extends Error {
  constructor(
    readonly reason: WorkroomOutcomePacketErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "WorkroomOutcomePacketError";
  }
}

function iso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new WorkroomOutcomePacketError("invalid_completed_at", "Outcome Packet completion time must be valid.");
  }
  return date.toISOString();
}

function optionalIso(value: Date | string | null | undefined): string | null {
  return value == null ? null : iso(value);
}

function refsFor(
  facts: readonly WorkroomOutcomeFact[],
  category: WorkroomOutcomePacketCategory,
): WorkCaseSourceRef[] {
  return dedupeRoomSourceRefs(
    facts.filter((fact) => fact.category === category).map((fact) => fact.sourceRef),
  );
}

function validateUnresolvedWork(
  unresolvedWork: BuildWorkroomOutcomePacketInput["unresolvedWork"],
): WorkroomOutcomePacket["unresolvedWork"] {
  const allowed = new Set(["carry-over", "new-case", "deferred", "accepted"]);
  return (unresolvedWork ?? []).map((item) => {
    const summary = roomText(item.summary);
    if (!summary || !allowed.has(item.disposition)) {
      throw new WorkroomOutcomePacketError(
        "invalid_unresolved_disposition",
        "Unresolved work needs a summary and a carry-over, new-case, deferred, or accepted disposition.",
      );
    }
    return { ...item, summary };
  });
}

export function buildWorkroomOutcomePacket(
  input: BuildWorkroomOutcomePacketInput,
): WorkroomOutcomePacket {
  const source = getWorkCaseSourceEntry(input.sourceKey);
  if (!source) {
    throw new WorkroomOutcomePacketError("unknown_source", `Work Room source '${input.sourceKey}' is not registered.`);
  }
  const summary = roomText(input.summary);
  if (!summary) {
    throw new WorkroomOutcomePacketError("missing_summary", "Outcome Packet summary is required.");
  }
  const accountablePrincipalRef = roomText(input.accountablePrincipalRef);
  if (!accountablePrincipalRef) {
    throw new WorkroomOutcomePacketError("missing_accountable", "Outcome Packet accountable principal is required.");
  }

  const invalidChat = input.facts.find(
    (fact) => fact.provenance === "raw-chat" && ["decisions", "artifacts", "evidence"].includes(fact.category),
  );
  if (invalidChat) {
    throw new WorkroomOutcomePacketError(
      "raw_chat_not_durable",
      `Raw chat cannot satisfy the '${invalidChat.category}' Outcome Packet field.`,
    );
  }

  const refs = {
    decisions: refsFor(input.facts, "decisions"),
    artifacts: refsFor(input.facts, "artifacts"),
    actions: refsFor(input.facts, "actions"),
    receipts: refsFor(input.facts, "receipts"),
    evidence: refsFor(input.facts, "evidence"),
  };
  for (const category of source.roomProjection.outcomePacket.requiredCategories) {
    if (refs[category].length === 0) {
      throw new WorkroomOutcomePacketError(
        "missing_required_category",
        `${source.displayLabel} Outcome Packets require '${category}'.`,
      );
    }
  }

  const sourceRefs = dedupeRoomSourceRefs([
    ...(input.sourceRefs ?? []),
    ...Object.values(refs).flat(),
  ]);
  const packet: WorkroomOutcomePacket = {
    outcomeState: input.outcomeState,
    summary,
    decisionRefs: refs.decisions,
    artifactRefs: refs.artifacts,
    actionRefs: refs.actions,
    receiptRefs: refs.receipts,
    evidenceRefs: refs.evidence,
    unresolvedWork: validateUnresolvedWork(input.unresolvedWork),
    accountablePrincipalRef,
    verifiedByRef: roomText(input.verifiedByRef),
    completedAt: iso(input.completedAt),
    nextReviewAt: optionalIso(input.nextReviewAt),
    sourceRefs,
  };

  Object.values(refs).forEach(Object.freeze);
  Object.freeze(packet.unresolvedWork);
  Object.freeze(packet.sourceRefs);
  return Object.freeze(packet);
}

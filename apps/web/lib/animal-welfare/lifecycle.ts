export type AnimalCustodyStage =
  | "intake"
  | "legal-hold"
  | "quarantine"
  | "health-assessment"
  | "procedures"
  | "behavior-assessment"
  | "care"
  | "placement-ready"
  | "outcome-recorded";

export type AnimalIntakeType =
  | "stray"
  | "owner-relinquished"
  | "seizure-confiscate"
  | "transfer-in"
  | "born-in-care"
  | "return"
  | "other";

export type AnimalOutcomeType =
  | "adoption"
  | "return-to-owner"
  | "return-to-field"
  | "transfer-out"
  | "died-in-care"
  | "euthanasia"
  | "lost-in-care"
  | "other";

export type CustodyEvent = {
  sequence: number;
  kind: "stage-transition" | "legal-hold-released" | "correction";
  fromStage: AnimalCustodyStage | null;
  toStage: AnimalCustodyStage;
  occurredAt: Date;
  actorPrincipalId: string;
  reason?: string;
};

export type CustodyEpisodeState = {
  animalProfileId: string;
  organizationId: string;
  intakeType: AnimalIntakeType;
  currentStage: AnimalCustodyStage;
  legalHoldActive: boolean;
  version: number;
  openedAt: Date;
  closedAt: Date | null;
  outcomeType: AnimalOutcomeType | null;
  events: CustodyEvent[];
};

export function openCustodyEpisode(input: {
  animalProfileId: string;
  organizationId: string;
  intakeType: AnimalIntakeType;
  occurredAt: Date;
  actorPrincipalId: string;
}): CustodyEpisodeState {
  return {
    animalProfileId: input.animalProfileId,
    organizationId: input.organizationId,
    intakeType: input.intakeType,
    currentStage: "intake",
    legalHoldActive: false,
    version: 1,
    openedAt: input.occurredAt,
    closedAt: null,
    outcomeType: null,
    events: [{
      sequence: 1,
      kind: "stage-transition",
      fromStage: null,
      toStage: "intake",
      occurredAt: input.occurredAt,
      actorPrincipalId: input.actorPrincipalId,
    }],
  };
}

export function advanceCustodyStage(
  episode: CustodyEpisodeState,
  input: { toStage: AnimalCustodyStage; occurredAt: Date; actorPrincipalId: string; reason?: string },
): CustodyEpisodeState {
  if (episode.closedAt) throw new Error("A closed custody episode cannot advance");
  if (episode.legalHoldActive && input.toStage === "placement-ready") {
    throw new Error("An animal on legal hold cannot become placement-ready");
  }
  const legalHoldActive = input.toStage === "legal-hold" ? true : episode.legalHoldActive;
  const version = episode.version + 1;
  return {
    ...episode,
    currentStage: input.toStage,
    legalHoldActive,
    version,
    events: [...episode.events, {
      sequence: version,
      kind: "stage-transition",
      fromStage: episode.currentStage,
      toStage: input.toStage,
      occurredAt: input.occurredAt,
      actorPrincipalId: input.actorPrincipalId,
      reason: input.reason,
    }],
  };
}

export function closeCustodyEpisode(
  episode: CustodyEpisodeState,
  input: { outcomeType: AnimalOutcomeType; occurredAt: Date; actorPrincipalId: string; reason?: string },
): CustodyEpisodeState {
  if (episode.legalHoldActive) throw new Error("An animal on legal hold cannot record an outcome");
  const advanced = advanceCustodyStage(episode, {
    toStage: "outcome-recorded",
    occurredAt: input.occurredAt,
    actorPrincipalId: input.actorPrincipalId,
    reason: input.reason,
  });
  return { ...advanced, closedAt: input.occurredAt, outcomeType: input.outcomeType };
}

export function releaseLegalHold(
  episode: CustodyEpisodeState,
  input: { approvedByHuman: boolean; occurredAt: Date; actorPrincipalId: string; reason: string },
): CustodyEpisodeState {
  if (!input.approvedByHuman) throw new Error("Legal-hold release requires human approval");
  if (!input.reason.trim()) throw new Error("Legal-hold release requires a reason");
  const version = episode.version + 1;
  return {
    ...episode,
    legalHoldActive: false,
    version,
    events: [...episode.events, {
      sequence: version,
      kind: "legal-hold-released",
      fromStage: episode.currentStage,
      toStage: episode.currentStage,
      occurredAt: input.occurredAt,
      actorPrincipalId: input.actorPrincipalId,
      reason: input.reason,
    }],
  };
}

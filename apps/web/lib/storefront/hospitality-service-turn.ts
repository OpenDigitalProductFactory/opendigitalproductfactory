export const HOSPITALITY_SERVICE_TURN_STAGES = [
  "seated",
  "ordered",
  "paid",
  "dirty",
  "closed",
  "cancelled",
] as const;

export type HospitalityServiceTurnStage =
  (typeof HOSPITALITY_SERVICE_TURN_STAGES)[number];

export interface HospitalityServiceTurnFact {
  id: string;
  stage: HospitalityServiceTurnStage;
  version: number;
  startedAt: Date;
  expectedEndAt: Date;
  closedAt: Date | null;
}

export class HospitalityServiceTurnVersionError extends Error {
  readonly code = "HOSPITALITY_SERVICE_TURN_VERSION_CONFLICT";

  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `Hospitality service turn version conflict: expected ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = "HospitalityServiceTurnVersionError";
  }
}

const TERMINAL_STAGES = new Set<HospitalityServiceTurnStage>([
  "closed",
  "cancelled",
]);

const ALLOWED_TRANSITIONS: Record<
  HospitalityServiceTurnStage,
  readonly HospitalityServiceTurnStage[]
> = {
  seated: ["ordered", "cancelled"],
  ordered: ["paid", "cancelled"],
  paid: ["dirty", "closed"],
  dirty: ["closed"],
  closed: [],
  cancelled: [],
};

export function transitionHospitalityServiceTurn(
  current: HospitalityServiceTurnFact,
  input: {
    expectedVersion: number;
    stage: HospitalityServiceTurnStage;
    at: Date;
  },
): HospitalityServiceTurnFact {
  if (current.version !== input.expectedVersion) {
    throw new HospitalityServiceTurnVersionError(
      input.expectedVersion,
      current.version,
    );
  }
  if (
    !(input.at instanceof Date) ||
    !Number.isFinite(input.at.getTime())
  ) {
    throw new TypeError("Hospitality service turn transition time is invalid");
  }
  if (TERMINAL_STAGES.has(current.stage)) {
    throw new Error(
      `Hospitality service turn ${current.id} is terminal (${current.stage})`,
    );
  }
  if (!ALLOWED_TRANSITIONS[current.stage].includes(input.stage)) {
    throw new Error(
      `Invalid hospitality service turn transition ${current.stage} -> ${input.stage}`,
    );
  }

  return {
    ...current,
    stage: input.stage,
    version: current.version + 1,
    closedAt: TERMINAL_STAGES.has(input.stage) ? input.at : null,
  };
}

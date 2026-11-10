// BI-12A083B4 phase 2 — AC-CS-04 and AC-CS-05.
//
// Phase 1 made every drive tick produce a conclusion. That answered the
// question for one room. It did not answer the founder's actual question:
//
//   "If outcomes aren't met, continue or surface what is blocking when you
//    stop so we can address the blockage. This is a recursively repeatable
//    thing until the organization's stated objectives, the very reason for its
//    existence, is met."
//
// The word that matters is RECURSIVELY. A room that concludes cleanly while the
// objective it serves goes unmet, with nobody working on it, is the same
// silence one level up. So the same three legitimate states — the outcome is
// MET, work CONTINUES, or a BLOCKAGE is named with an owner and the observable
// event that clears it — are applied again at the objective, and again at the
// organization, terminating at its stated reason for existing.
//
// No new engine. The objective's own posture already exists
// (`deriveObjectivePosture`), the room's conclusion already exists
// (`resolveDriveConclusion`), and the accountability lineage already exists.
// Nothing evaluated them together, which is why an unmet objective with no work
// against it could sit indefinitely and raise nothing.

import type { ProductObjectivePosture } from "@/lib/product-management/outcomes";

import type { ConclusionKind, DriveConclusion } from "./drive-conclusion";

/**
 * A blockage that has travelled up from where it was found, carrying where
 * that was. Phase 1's blockage shape plus its origin, so an organization-level
 * answer can still point at the room that is actually stuck.
 */
export type RolledBlockage = {
  /** Where this was found: a room capsule id, an objective id, or the organization id. */
  at: string;
  /** Which level `at` names, so a reader knows what kind of thing to open. */
  level: "room" | "objective" | "organization";
  what: string;
  unblockedBy: string;
  ownerPrincipalId: string | null;
  ownerSetupRequired: string | null;
};

/**
 * Which state is furthest from "someone is carrying this".
 *
 * `unconcluded` outranks `blocked` deliberately. A blockage has an owner and a
 * clearing event, so it is being carried by someone. An unconcluded state is
 * the silence this whole epic exists to remove: nobody can even say what is
 * true, so nobody can be waiting on anything.
 */
const SEVERITY: Record<ConclusionKind, number> = {
  unconcluded: 3,
  blocked: 2,
  "in-motion": 1,
  "outcome-met": 0,
};

function worst(kinds: readonly ConclusionKind[]): ConclusionKind {
  let answer: ConclusionKind = "outcome-met";
  for (const kind of kinds) {
    if (SEVERITY[kind] > SEVERITY[answer]) answer = kind;
  }
  return answer;
}

export type RoomContribution = {
  capsuleId: string;
  /**
   * The conclusion the drive recorded on its last tick, or null when this room
   * has never been driven. Null is not benign: a room contributing to an
   * objective that has never concluded anything is exactly the silence phase 1
   * removed one level down.
   */
  conclusion: DriveConclusion | null;
};

export type ObjectiveRollupInput = {
  objectiveId: string;
  title: string;
  /** draft | active | closed | archived, as recorded on the objective. */
  status: string;
  posture: ProductObjectivePosture;
  /** Resolved from the lineage. Null when the organization records no owner. */
  accountablePrincipalId: string | null;
  /** Why there is no owner, when there is none. A modelling defect, surfaced. */
  accountableSetupRequired: string | null;
  rooms: readonly RoomContribution[];
};

export type ObjectiveRollup = {
  objectiveId: string;
  kind: ConclusionKind;
  /**
   * True when this is still something the organization is trying to achieve.
   * A draft objective is not yet in play and a closed or archived one no longer
   * is, so neither can make the organization look unmet.
   */
  inPlay: boolean;
  summary: string;
  blockages: RolledBlockage[];
};

function roomBlockages(rooms: readonly RoomContribution[]): RolledBlockage[] {
  const found: RolledBlockage[] = [];
  for (const room of rooms) {
    const blockage = room.conclusion?.blockage;
    if (!blockage) continue;
    found.push({
      at: room.capsuleId,
      level: "room",
      what: blockage.what,
      unblockedBy: blockage.unblockedBy,
      ownerPrincipalId: blockage.ownerPrincipalId,
      ownerSetupRequired: blockage.ownerSetupRequired,
    });
  }
  return found;
}

/** A room nobody has ever driven states nothing, and must not read as progress. */
function undrivenRooms(rooms: readonly RoomContribution[]): RoomContribution[] {
  return rooms.filter((room) => room.conclusion === null);
}

function postureReason(posture: ProductObjectivePosture): string {
  return posture.availability === "insufficient-evidence" || posture.availability === "incompatible"
    ? posture.reason
    : posture.state;
}

/**
 * Roll one objective up from the rooms that serve it (AC-CS-04).
 *
 * The order of these branches is the whole argument, so it is written out:
 *
 * 1. An objective not yet in play, or already concluded, cannot be an unmet
 *    outcome. It is reported but excluded from what the organization owes.
 * 2. A measure nobody can read is `unconcluded`, never `outcome-met`. Missing
 *    evidence is not evidence of success — the same rule phase 1 applies when
 *    an owner cannot be resolved.
 * 3. An objective on target is met, whatever its rooms are doing.
 * 4. Work in motion means the outcome is being pursued, so it is not a blockage.
 * 5. A room that is stuck makes the objective stuck, and the room's own
 *    blockage travels up rather than being restated.
 * 6. THE NEW CASE. The measure is not met, no work is in motion, and nothing is
 *    blocked. Before this, that state raised nothing at all. It is now a
 *    blockage owned by whoever answers for the objective.
 */
export function rollUpObjective(input: ObjectiveRollupInput): ObjectiveRollup {
  const base = { objectiveId: input.objectiveId, blockages: [] as RolledBlockage[] };

  if (input.status === "draft") {
    return {
      ...base,
      kind: "in-motion",
      inPlay: false,
      summary: `"${input.title}" is still being formed, so it is not yet an outcome anyone owes.`,
    };
  }
  if (input.status === "closed") {
    return {
      ...base,
      kind: "outcome-met",
      inPlay: false,
      summary: `"${input.title}" was closed, so it was concluded deliberately rather than left open.`,
    };
  }
  if (input.status === "archived") {
    return {
      ...base,
      kind: "outcome-met",
      inPlay: false,
      summary: `"${input.title}" was archived, so it was withdrawn deliberately and is no longer pursued.`,
    };
  }

  const carried = roomBlockages(input.rooms);
  const undriven = undrivenRooms(input.rooms);

  // A measure nobody can read cannot be called met, and cannot be called
  // blocked either, because there is no way to know whether anything is wrong.
  if (input.posture.availability === "insufficient-evidence"
    || input.posture.availability === "incompatible") {
    return {
      ...base,
      kind: "unconcluded",
      inPlay: true,
      summary: `Nobody can say whether "${input.title}" is being met (${postureReason(input.posture)}), `
        + "so it cannot be reported as met or as blocked.",
      blockages: [
        ...carried,
        {
          at: input.objectiveId,
          level: "objective",
          what: `"${input.title}" has no readable measure, so its progress cannot be judged.`,
          unblockedBy: unblockingEventFor(input.posture),
          ownerPrincipalId: input.accountablePrincipalId,
          ownerSetupRequired: input.accountableSetupRequired,
        },
      ],
    };
  }

  if (input.posture.availability === "available" && input.posture.state === "on-target") {
    return {
      ...base,
      kind: "outcome-met",
      inPlay: true,
      summary: `"${input.title}" is on target.`,
      // A met objective keeps any room blockage visible. The outcome being
      // reached does not make a stuck room stop being stuck.
      blockages: carried,
    };
  }

  const inMotion = input.rooms.some((room) => room.conclusion?.kind === "in-motion");
  if (inMotion) {
    return {
      ...base,
      kind: "in-motion",
      inPlay: true,
      summary: `"${input.title}" is not met yet and work is in motion for it.`,
      blockages: carried,
    };
  }

  if (carried.length > 0) {
    return {
      ...base,
      kind: worst(input.rooms.map((room) => room.conclusion?.kind ?? "unconcluded")),
      inPlay: true,
      summary: `"${input.title}" is not met and every room serving it is stuck.`,
      blockages: carried,
    };
  }

  if (undriven.length > 0) {
    return {
      ...base,
      kind: "unconcluded",
      inPlay: true,
      summary: `"${input.title}" is not met, and ${undriven.length === 1 ? "the room" : "every room"} `
        + "serving it has never been driven, so nothing has concluded anything about it.",
      blockages: undriven.map((room) => ({
        at: room.capsuleId,
        level: "room" as const,
        what: "This room has never been driven, so it has concluded nothing about the objective it serves.",
        unblockedBy: "the drive records a conclusion for this room",
        ownerPrincipalId: input.accountablePrincipalId,
        ownerSetupRequired: input.accountableSetupRequired,
      })),
    };
  }

  // The case this phase exists for. Unmet, nothing moving, nothing stuck —
  // which used to mean nothing was said at all.
  const what = input.rooms.length === 0
    ? `"${input.title}" is not met and no work is linked to it at all.`
    : `"${input.title}" is not met and no work is in motion for it.`;
  if (!input.accountablePrincipalId) {
    return {
      ...base,
      kind: "unconcluded",
      inPlay: true,
      summary: `${what} No one can be named to carry it, which is a modelling defect rather than a blockage.`,
      blockages: [
        {
          at: input.objectiveId,
          level: "objective",
          what,
          unblockedBy: "work is linked and started against this objective, or its target is revised",
          ownerPrincipalId: null,
          ownerSetupRequired: input.accountableSetupRequired,
        },
      ],
    };
  }
  return {
    ...base,
    kind: "blocked",
    inPlay: true,
    summary: what,
    blockages: [
      {
        at: input.objectiveId,
        level: "objective",
        what,
        unblockedBy: "work is linked and started against this objective, or its target is revised",
        ownerPrincipalId: input.accountablePrincipalId,
        ownerSetupRequired: null,
      },
    ],
  };
}

/** The observable event that would make an unreadable measure readable. */
function unblockingEventFor(posture: ProductObjectivePosture): string {
  if (posture.availability === "insufficient-evidence") {
    if (posture.reason === "baseline-missing") return "a baseline value is recorded on the objective";
    if (posture.reason === "target-missing") return "a target value is recorded on the objective";
    return "an outcome observation is recorded against the objective";
  }
  if (posture.availability === "incompatible") {
    if (posture.reason === "measure-contract-changed") {
      return "an observation is recorded in the objective's current measure and unit";
    }
    return "an observation carrying a value in the objective's measure is recorded";
  }
  return "an outcome observation is recorded against the objective";
}

export type OrganizationRollupInput = {
  organizationId: string;
  /** Why this organization exists, as stated at onboarding. Null when unstated. */
  mission: string | null;
  accountablePrincipalId: string | null;
  accountableSetupRequired: string | null;
  objectives: readonly ObjectiveRollup[];
};

export type OrganizationRollup = {
  organizationId: string;
  kind: ConclusionKind;
  summary: string;
  blockages: RolledBlockage[];
  /** The objectives that count toward the answer, in the order they were given. */
  inPlayObjectiveIds: string[];
};

/**
 * Roll every objective up to the organization's stated reason for existing
 * (AC-CS-04, terminating case).
 *
 * This is where the recursion stops, because there is nothing above it. The
 * founder's sentence ends "until the organization's stated objectives, the very
 * reason for its existence, is met" — so the terminating success condition is
 * literally: every objective in play is met.
 */
export function rollUpOrganization(input: OrganizationRollupInput): OrganizationRollup {
  const inPlay = input.objectives.filter((objective) => objective.inPlay);
  const carried = input.objectives.flatMap((objective) => objective.blockages);

  // An organization that never stated why it exists cannot be reconciled
  // against that statement. This is the deepest version of the same defect: not
  // an unmet outcome, but no stated outcome to be unmet.
  if (!input.mission?.trim()) {
    return {
      organizationId: input.organizationId,
      kind: "unconcluded",
      summary: "This organization records no statement of why it exists, "
        + "so nothing can be reconciled against its purpose.",
      blockages: [
        ...carried,
        {
          at: input.organizationId,
          level: "organization",
          what: "No statement of purpose is recorded for this organization.",
          unblockedBy: "a mission is recorded in the organization's business context",
          ownerPrincipalId: input.accountablePrincipalId,
          ownerSetupRequired: input.accountableSetupRequired,
        },
      ],
      inPlayObjectiveIds: inPlay.map((objective) => objective.objectiveId),
    };
  }

  if (inPlay.length === 0) {
    return {
      organizationId: input.organizationId,
      kind: "unconcluded",
      summary: "This organization states a purpose but has no objective in play, "
        + "so nothing says whether it is meeting it.",
      blockages: [
        ...carried,
        {
          at: input.organizationId,
          level: "organization",
          what: "No active objective expresses the purpose this organization states.",
          unblockedBy: "at least one objective is activated for this organization",
          ownerPrincipalId: input.accountablePrincipalId,
          ownerSetupRequired: input.accountableSetupRequired,
        },
      ],
      inPlayObjectiveIds: [],
    };
  }

  const kind = worst(inPlay.map((objective) => objective.kind));
  return {
    organizationId: input.organizationId,
    kind,
    summary: summariseOrganization(kind, inPlay.length),
    blockages: carried,
    inPlayObjectiveIds: inPlay.map((objective) => objective.objectiveId),
  };
}

function summariseOrganization(kind: ConclusionKind, count: number): string {
  const objectives = count === 1 ? "its one objective in play" : `all ${count} objectives in play`;
  if (kind === "outcome-met") {
    return `This organization is meeting its stated purpose: ${objectives} ${count === 1 ? "is" : "are"} met.`;
  }
  if (kind === "in-motion") return `Work is in motion toward ${objectives}, and none of it is stuck.`;
  if (kind === "blocked") {
    return `This organization is not meeting its stated purpose, and every blockage below it is named and owned.`;
  }
  return "This organization is not meeting its stated purpose, and at least one part of it can conclude nothing at all.";
}

export type OutcomeRollupInput = {
  organizationId: string;
  mission: string | null;
  accountablePrincipalId: string | null;
  accountableSetupRequired: string | null;
  objectives: readonly ObjectiveRollupInput[];
};

export type OutcomeRollup = {
  organization: OrganizationRollup;
  objectives: ObjectiveRollup[];
};

/**
 * One read answering the same question at every level (AC-CS-05).
 *
 * A caller asking "is this organization meeting the reason it exists" and a
 * caller asking "is this objective being carried" get answers in one vocabulary
 * from one function, so the two cannot disagree.
 */
export function resolveOutcomeRollup(input: OutcomeRollupInput): OutcomeRollup {
  const objectives = input.objectives.map(rollUpObjective);
  return {
    organization: rollUpOrganization({
      organizationId: input.organizationId,
      mission: input.mission,
      accountablePrincipalId: input.accountablePrincipalId,
      accountableSetupRequired: input.accountableSetupRequired,
      objectives,
    }),
    objectives,
  };
}

/**
 * Every posture an objective can actually hold, for the conformance walk.
 *
 * Enumerated from `ProductObjectivePosture` itself rather than sampled, so a
 * posture added later fails this walk instead of silently falling through to a
 * default the way the drive's unknown reasons used to.
 */
export function everyObjectivePosture(): ProductObjectivePosture[] {
  const available = (["improving", "regressing", "unchanged", "on-target"] as const).flatMap(
    (state) => (["increase", "decrease", "maintain"] as const).map((direction) => ({
      availability: "available" as const,
      direction,
      state,
      progress: state === "on-target" ? 1 : 0.5,
      latestValue: 1,
    })),
  );
  return [
    ...available,
    { availability: "qualitative", state: "review-needed", latestNarrative: "a narrative" },
    { availability: "insufficient-evidence", state: "unknown", reason: "baseline-missing" },
    { availability: "insufficient-evidence", state: "unknown", reason: "observation-missing" },
    { availability: "insufficient-evidence", state: "unknown", reason: "target-missing" },
    { availability: "incompatible", state: "unknown", reason: "measure-contract-changed" },
    { availability: "incompatible", state: "unknown", reason: "observation-value-missing" },
  ];
}

/** Every objective status the schema allows, for the conformance walk. */
export const OBJECTIVE_STATUSES = ["draft", "active", "closed", "archived"] as const;

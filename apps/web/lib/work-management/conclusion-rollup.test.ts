import { describe, expect, it } from "vitest";

import type { ProductObjectivePosture } from "@/lib/product-management/outcomes";

import type { DriveConclusion } from "./drive-conclusion";
import {
  everyObjectivePosture,
  OBJECTIVE_STATUSES,
  resolveOutcomeRollup,
  rollUpObjective,
  rollUpOrganization,
  type ObjectiveRollup,
  type ObjectiveRollupInput,
  type RoomContribution,
} from "./conclusion-rollup";

const ON_TARGET: ProductObjectivePosture = {
  availability: "available",
  direction: "increase",
  state: "on-target",
  progress: 1,
  latestValue: 90,
};

const IMPROVING: ProductObjectivePosture = {
  availability: "available",
  direction: "increase",
  state: "improving",
  progress: 0.4,
  latestValue: 40,
};

const UNREADABLE: ProductObjectivePosture = {
  availability: "insufficient-evidence",
  state: "unknown",
  reason: "target-missing",
};

function conclusion(overrides: Partial<DriveConclusion> = {}): DriveConclusion {
  return {
    kind: "in-motion",
    action: "dispatch_agent",
    reason: "agent_stage",
    blockage: null,
    summary: "a stage is dispatched",
    ...overrides,
  };
}

const STUCK: DriveConclusion = conclusion({
  kind: "blocked",
  action: "stop",
  reason: "unreachable_substrate",
  summary: "the substrate cannot be reached",
  blockage: {
    what: "The substrate this room reads cannot be reached, so it has nothing to act on.",
    unblockedBy: "the substrate answers a read again",
    ownerPrincipalId: "PRN-OWNER",
    ownerSetupRequired: null,
  },
});

function room(capsuleId: string, value: DriveConclusion | null): RoomContribution {
  return { capsuleId, conclusion: value };
}

function objective(overrides: Partial<ObjectiveRollupInput> = {}): ObjectiveRollupInput {
  return {
    objectiveId: "OBJ-1",
    title: "Rehome every animal within 30 days",
    status: "active",
    posture: IMPROVING,
    accountablePrincipalId: "PRN-OWNER",
    accountableSetupRequired: null,
    rooms: [],
    ...overrides,
  };
}

describe("rollUpObjective — the same three states, one level up (AC-CS-04)", () => {
  it("an objective on target is met", () => {
    const rolled = rollUpObjective(objective({ posture: ON_TARGET }));
    expect(rolled.kind).toBe("outcome-met");
    expect(rolled.inPlay).toBe(true);
  });

  it("an unmet objective with work in motion is in motion, not a blockage", () => {
    const rolled = rollUpObjective(objective({ rooms: [room("WC-1", conclusion())] }));
    expect(rolled.kind).toBe("in-motion");
    expect(rolled.blockages).toEqual([]);
  });

  it("a stuck room makes its objective stuck, and the room's own blockage travels up", () => {
    const rolled = rollUpObjective(objective({ rooms: [room("WC-1", STUCK)] }));
    expect(rolled.kind).toBe("blocked");
    expect(rolled.blockages).toHaveLength(1);
    expect(rolled.blockages[0]?.at).toBe("WC-1");
    expect(rolled.blockages[0]?.level).toBe("room");
    // Carried, not restated: the room already said what would clear it.
    expect(rolled.blockages[0]?.unblockedBy).toBe("the substrate answers a read again");
  });

  it("one room in motion beside a stuck one keeps the objective in motion", () => {
    const rolled = rollUpObjective(objective({
      rooms: [room("WC-1", STUCK), room("WC-2", conclusion())],
    }));
    expect(rolled.kind).toBe("in-motion");
    // The stuck room is still visible. Progress elsewhere does not unstick it.
    expect(rolled.blockages.map((entry) => entry.at)).toEqual(["WC-1"]);
  });
});

describe("rollUpObjective — the case this phase exists for", () => {
  it("an unmet objective with nothing in motion and nothing stuck is a named, owned blockage", () => {
    const rolled = rollUpObjective(objective());
    expect(rolled.kind).toBe("blocked");
    expect(rolled.blockages).toHaveLength(1);
    const blockage = rolled.blockages[0];
    expect(blockage?.level).toBe("objective");
    expect(blockage?.ownerPrincipalId).toBe("PRN-OWNER");
    expect(blockage?.what).toContain("no work is linked to it at all");
    expect(blockage?.unblockedBy).toContain("work is linked and started");
  });

  it("says work exists but is not moving, when rooms are linked and all finished", () => {
    const rolled = rollUpObjective(objective({
      rooms: [room("WC-1", conclusion({ kind: "outcome-met", reason: "success", blockage: null }))],
    }));
    expect(rolled.kind).toBe("blocked");
    expect(rolled.blockages[0]?.what).toContain("no work is in motion for it");
  });

  it("never invents an owner: with no accountable it is a surfaced defect, not a blockage", () => {
    const rolled = rollUpObjective(objective({
      accountablePrincipalId: null,
      accountableSetupRequired: "This organization records no owner.",
    }));
    expect(rolled.kind).toBe("unconcluded");
    expect(rolled.blockages[0]?.ownerPrincipalId).toBeNull();
    expect(rolled.blockages[0]?.ownerSetupRequired).toBe("This organization records no owner.");
    expect(JSON.stringify(rolled)).not.toMatch(/PRN-OWNER/);
  });

  it("a room that has never been driven concludes nothing, and is not read as progress", () => {
    const rolled = rollUpObjective(objective({ rooms: [room("WC-1", null)] }));
    expect(rolled.kind).toBe("unconcluded");
    expect(rolled.blockages[0]?.at).toBe("WC-1");
    expect(rolled.blockages[0]?.unblockedBy).toBe("the drive records a conclusion for this room");
  });
});

describe("rollUpObjective — a measure nobody can read is never called met", () => {
  it("is unconcluded, and names the observation that would make it readable", () => {
    const rolled = rollUpObjective(objective({ posture: UNREADABLE }));
    expect(rolled.kind).toBe("unconcluded");
    expect(rolled.summary).toContain("Nobody can say whether");
    expect(rolled.blockages.at(-1)?.unblockedBy).toBe("a target value is recorded on the objective");
  });

  it("still carries a stuck room's blockage beside the unreadable measure", () => {
    const rolled = rollUpObjective(objective({ posture: UNREADABLE, rooms: [room("WC-1", STUCK)] }));
    expect(rolled.blockages.map((entry) => entry.at)).toEqual(["WC-1", "OBJ-1"]);
  });
});

describe("rollUpObjective — what is not in play cannot make the organization look unmet", () => {
  it.each([
    ["draft", "in-motion", "still being formed"],
    ["closed", "outcome-met", "concluded deliberately"],
    ["archived", "outcome-met", "withdrawn deliberately"],
  ])("a %s objective is out of play and says why", (status, kind, phrase) => {
    const rolled = rollUpObjective(objective({ status, posture: UNREADABLE }));
    expect(rolled.inPlay).toBe(false);
    expect(rolled.kind).toBe(kind);
    expect(rolled.summary).toContain(phrase);
  });
});

describe("conformance — every posture and status concludes (AC-CS-04)", () => {
  const postures = everyObjectivePosture();

  it("the posture enumeration is not empty, so this walk means something", () => {
    expect(postures.length).toBeGreaterThan(10);
  });

  it("classifies every posture and status pair, with no silent default", () => {
    for (const status of OBJECTIVE_STATUSES) {
      for (const posture of postures) {
        const rolled = rollUpObjective(objective({ status, posture }));
        expect(rolled.kind, `${status}/${posture.availability}`).toBeTruthy();
        expect(rolled.summary.length, `${status}/${posture.availability}`).toBeGreaterThan(0);
      }
    }
  });

  it("every blockage it raises names an owner or the setup that is missing, and an event that clears it", () => {
    for (const posture of postures) {
      for (const rooms of [[], [room("WC-1", STUCK)], [room("WC-1", null)]]) {
        const rolled = rollUpObjective(objective({ posture, rooms }));
        for (const blockage of rolled.blockages) {
          expect(blockage.unblockedBy.length, blockage.what).toBeGreaterThan(0);
          expect(blockage.unblockedBy).not.toMatch(/someone (reviews|looks)/i);
          expect(
            Boolean(blockage.ownerPrincipalId) || Boolean(blockage.ownerSetupRequired),
            blockage.what,
          ).toBe(true);
        }
      }
    }
  });

  it("an active objective that is not met and not moving is never silent", () => {
    for (const posture of postures) {
      const rolled = rollUpObjective(objective({ posture }));
      if (rolled.kind === "outcome-met") continue;
      expect(rolled.blockages.length, posture.availability).toBeGreaterThan(0);
    }
  });
});

function rolled(overrides: Partial<ObjectiveRollup> = {}): ObjectiveRollup {
  return {
    objectiveId: "OBJ-1",
    kind: "outcome-met",
    inPlay: true,
    summary: "met",
    blockages: [],
    ...overrides,
  };
}

describe("rollUpOrganization — the recursion terminates at the reason it exists", () => {
  const base = {
    organizationId: "ORG-1",
    mission: "Every animal we take in leaves with a family.",
    accountablePrincipalId: "PRN-OWNER",
    accountableSetupRequired: null,
  };

  it("every objective in play met is the terminating success condition", () => {
    const answer = rollUpOrganization({ ...base, objectives: [rolled(), rolled({ objectiveId: "OBJ-2" })] });
    expect(answer.kind).toBe("outcome-met");
    expect(answer.summary).toContain("meeting its stated purpose");
    expect(answer.inPlayObjectiveIds).toEqual(["OBJ-1", "OBJ-2"]);
  });

  it("takes the state furthest from someone carrying it", () => {
    const answer = rollUpOrganization({
      ...base,
      objectives: [rolled(), rolled({ objectiveId: "OBJ-2", kind: "in-motion" })],
    });
    expect(answer.kind).toBe("in-motion");
  });

  it("ranks silence above a named blockage, because a blockage has an owner", () => {
    const answer = rollUpOrganization({
      ...base,
      objectives: [
        rolled({ objectiveId: "OBJ-2", kind: "blocked" }),
        rolled({ objectiveId: "OBJ-3", kind: "unconcluded" }),
      ],
    });
    expect(answer.kind).toBe("unconcluded");
  });

  it("an objective out of play cannot make the organization look unmet", () => {
    const answer = rollUpOrganization({
      ...base,
      objectives: [rolled(), rolled({ objectiveId: "OBJ-2", kind: "unconcluded", inPlay: false })],
    });
    expect(answer.kind).toBe("outcome-met");
    expect(answer.inPlayObjectiveIds).toEqual(["OBJ-1"]);
  });

  it("an organization that never stated why it exists cannot be reconciled against it", () => {
    const answer = rollUpOrganization({ ...base, mission: "   ", objectives: [rolled()] });
    expect(answer.kind).toBe("unconcluded");
    expect(answer.blockages.at(-1)?.level).toBe("organization");
    expect(answer.blockages.at(-1)?.unblockedBy).toContain("mission is recorded");
  });

  it("a stated purpose with no objective in play says nothing is expressing it", () => {
    const answer = rollUpOrganization({ ...base, objectives: [rolled({ inPlay: false })] });
    expect(answer.kind).toBe("unconcluded");
    expect(answer.blockages.at(-1)?.unblockedBy).toContain("objective is activated");
  });

  it("carries every blockage below it, so the top answer still points at the stuck room", () => {
    const answer = rollUpOrganization({
      ...base,
      objectives: [rolled({
        kind: "blocked",
        blockages: [{
          at: "WC-1",
          level: "room",
          what: "stuck",
          unblockedBy: "the substrate answers a read again",
          ownerPrincipalId: "PRN-OWNER",
          ownerSetupRequired: null,
        }],
      })],
    });
    expect(answer.kind).toBe("blocked");
    expect(answer.blockages.map((entry) => entry.at)).toEqual(["WC-1"]);
  });
});

describe("resolveOutcomeRollup — one read, one vocabulary (AC-CS-05)", () => {
  it("answers for the organization and every objective at once, and they agree", () => {
    const answer = resolveOutcomeRollup({
      organizationId: "ORG-1",
      mission: "Every animal we take in leaves with a family.",
      accountablePrincipalId: "PRN-OWNER",
      accountableSetupRequired: null,
      objectives: [
        objective({ objectiveId: "OBJ-MET", posture: ON_TARGET }),
        objective({ objectiveId: "OBJ-STUCK", rooms: [room("WC-1", STUCK)] }),
      ],
    });

    expect(answer.objectives.map((entry) => entry.kind)).toEqual(["outcome-met", "blocked"]);
    expect(answer.organization.kind).toBe("blocked");
    // The organization's answer is exactly the worst of its objectives, never
    // a separately computed opinion that could drift from them.
    expect(answer.organization.blockages.map((entry) => entry.at)).toEqual(["WC-1"]);
  });

  it("an organization with no objectives at all reaches the honest answer, not a cheerful one", () => {
    const answer = resolveOutcomeRollup({
      organizationId: "ORG-1",
      mission: "Every animal we take in leaves with a family.",
      accountablePrincipalId: "PRN-OWNER",
      accountableSetupRequired: null,
      objectives: [],
    });
    expect(answer.organization.kind).toBe("unconcluded");
    expect(answer.objectives).toEqual([]);
  });
});

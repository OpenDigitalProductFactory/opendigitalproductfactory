import { describe, expect, it } from "vitest";

import {
  buildArchetypeJobDefinitions,
  unansweredAxesFor,
} from "./archetype-job-definition-projection";

// WHAT THESE GUARD. The projection's value is that a job description nobody
// wrote is still specific to how THIS business runs. Its danger is the opposite
// of the old door's: where that one never asked, a projection could plausibly
// ANSWER — filling authority or qualifications with a sentence derived from
// nothing. So the tests below check both halves: what it derives, and what it
// refuses to.

type Stage = {
  key: string;
  label: string;
  order: number;
  loadBearing: boolean;
  capabilityBindings: never[];
  metricBindings: string[];
  trustGateKeys: string[];
  streamKey: string;
  input: string | null;
  output: string | null;
  responsibleRole: string | null;
  handoffToStageKey: string | null;
};

function stage(over: Partial<Stage> & { key: string }): Stage {
  return {
    label: `Stage ${over.key}`,
    order: 1,
    loadBearing: false,
    capabilityBindings: [],
    metricBindings: [],
    trustGateKeys: [],
    streamKey: "deliver",
    input: null,
    output: null,
    responsibleRole: null,
    handoffToStageKey: null,
    ...over,
  };
}

function ovsm(stages: Stage[], streams: Array<{ responsibleRole: string; stages: { key: string }[] }> = []) {
  return {
    archetypeId: "dental-practice",
    archetypeName: "Dental Practice",
    category: "health-services",
    stages,
    streams,
  } as never;
}

describe("one role, the stages it owns", () => {
  it("bundles every stage a role owns into ONE job", () => {
    // A job is a bundle of accountabilities, not a single duty — which is the
    // inversion that distinguishes this from the room projection.
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({ key: "book", label: "Book the appointment", order: 1, responsibleRole: "Front desk" }),
        stage({ key: "remind", label: "Remind the patient", order: 2, responsibleRole: "Front desk" }),
        stage({ key: "treat", label: "Treat the patient", order: 3, responsibleRole: "Clinician" }),
      ]),
    );

    expect(set.definitions).toHaveLength(2);
    const frontDesk = set.definitions.find((d) => d.role === "Front desk");
    expect(frontDesk?.accountabilities.map((a) => a.stageKey)).toEqual(["book", "remind"]);
  });

  it("orders accountabilities by the stage order, not by discovery", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({ key: "late", order: 9, responsibleRole: "Front desk" }),
        stage({ key: "early", order: 2, responsibleRole: "Front desk" }),
      ]),
    );
    expect(set.definitions[0]!.accountabilities.map((a) => a.stageKey)).toEqual(["early", "late"]);
  });

  it("unions gates and measures across the stages a role owns", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({ key: "a", responsibleRole: "Bookkeeper", trustGateKeys: ["g2", "g1"], metricBindings: ["m1"] }),
        stage({ key: "b", responsibleRole: "Bookkeeper", trustGateKeys: ["g1"], metricBindings: ["m2"] }),
      ]),
    );
    const def = set.definitions[0]!;
    expect(def.gateBindings).toEqual(["g1", "g2"]);
    expect(def.measureBindings).toEqual(["m1", "m2"]);
  });

  it("is stable in output order, so re-projection does not churn", () => {
    // A projection whose order wobbles produces spurious diffs every time it
    // re-runs, which is how convergence noise starts.
    const stages = [
      stage({ key: "z", responsibleRole: "Zeta" }),
      stage({ key: "a", responsibleRole: "Alpha" }),
    ];
    const first = buildArchetypeJobDefinitions(ovsm(stages)).definitions.map((d) => d.role);
    const second = buildArchetypeJobDefinitions(ovsm([...stages].reverse())).definitions.map((d) => d.role);
    expect(first).toEqual(["Alpha", "Zeta"]);
    expect(second).toEqual(first);
  });
});

describe("a stage nobody owns is a finding, not a blank", () => {
  it("reports unowned stages instead of inventing a role for them", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({ key: "orphan", responsibleRole: null }),
        stage({ key: "blank", responsibleRole: "   " }),
        stage({ key: "owned", responsibleRole: "Clinician" }),
      ]),
    );
    expect(set.unownedStageKeys).toEqual(["blank", "orphan"]);
    expect(set.definitions.map((d) => d.role)).toEqual(["Clinician"]);
  });
});

describe("what it derives", () => {
  it("answers purpose, accountabilities and tailoring from the value stream", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({
          key: "recall",
          label: "Recall the patient",
          responsibleRole: "Front desk",
          input: "a due recall",
          output: "a booked appointment",
        }),
      ]),
    );
    const axes = set.definitions[0]!.axes;
    expect(axes.purpose?.state).toBe("satisfied");
    expect(axes.accountabilities?.state).toBe("satisfied");
    // Tailoring is the whole point: this is not a generic role description.
    expect((axes.tailoring as { evidence: string }).evidence).toContain("dental-practice");
    expect((axes.accountabilities as { evidence: string }).evidence).toContain("a due recall");
  });

  it("answers measures only when the stages actually carry metrics", () => {
    const withMetrics = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R", metricBindings: ["recall-rate"] })]),
    );
    const without = buildArchetypeJobDefinitions(ovsm([stage({ key: "a", responsibleRole: "R" })]));

    expect(withMetrics.definitions[0]!.axes.measures?.state).toBe("satisfied");
    expect(without.definitions[0]!.axes.measures).toBeUndefined();
  });

  it("records standing work as a FACT, and leaves the schedule to the room", () => {
    // DI-81E47BDA59F1: cadence is room-owned. The value stream can say this role
    // has standing work; asserting a schedule here would re-create the
    // per-coworker toggle that ruling removed.
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R", loadBearing: true })]),
    );
    const cadence = set.definitions[0]!.axes.cadence as { evidence: string };
    expect(cadence.evidence).toContain("room");
    expect(set.definitions[0]!.hasStandingWork).toBe(true);
  });

  it("omits cadence entirely when the role holds no standing work", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R", loadBearing: false })]),
    );
    expect(set.definitions[0]!.axes.cadence).toBeUndefined();
  });
});

describe("what it refuses to invent", () => {
  it("leaves authority, qualifications and supervision unanswered", () => {
    // The OVSM knows what a role is accountable for and what constraints its
    // stages impose. It cannot know what tools that role needs, what it may
    // decide alone, or who it reports to. A projection that filled those with a
    // plausible sentence would defeat the contract more quietly than the old
    // door ever did.
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({
          key: "a",
          responsibleRole: "Clinician",
          loadBearing: true,
          metricBindings: ["m"],
          trustGateKeys: ["g"],
        }),
      ]),
    );
    expect(unansweredAxesFor(set.definitions[0]!)).toEqual([
      "authority",
      "qualifications",
      "supervision",
    ]);
  });

  it("leaves CONTEXT unanswered when the stages impose nothing to know", () => {
    // Priming is derived, not invented. A stage carrying no gate and no domain
    // gives the role nothing specific to hold, and saying otherwise would be
    // the plausible sentence this projection exists to avoid.
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R" })]),
    );
    expect(set.definitions[0]!.axes.context).toBeUndefined();
    expect(set.definitions[0]!.requiredContext).toEqual({ constraints: [], domains: [] });
  });

  it("does not treat a gate binding as an authority answer", () => {
    // Gates say what this role's work must PASS. They do not say what it may
    // decide alone — that needs the FPAW §10 allocation pattern.
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R", trustGateKeys: ["clinical-signoff"] })]),
    );
    expect(set.definitions[0]!.axes.authority).toBeUndefined();
    expect(set.definitions[0]!.gateBindings).toEqual(["clinical-signoff"]);
  });
});

describe("archetype tailoring is inherited, not authored", () => {
  it("gives two archetypes different jobs for the same role name", () => {
    const dental = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "recall", label: "Recall the patient", responsibleRole: "Scheduler" })]),
    );
    const farm = buildArchetypeJobDefinitions({
      archetypeId: "farm-ranch",
      archetypeName: "Farm & Ranch",
      category: "agriculture",
      stages: [stage({ key: "irrigate", label: "Schedule irrigation", responsibleRole: "Scheduler" })],
    } as never);

    const dentalEvidence = (dental.definitions[0]!.axes.accountabilities as { evidence: string }).evidence;
    const farmEvidence = (farm.definitions[0]!.axes.accountabilities as { evidence: string }).evidence;

    // Same role name, different job — because the value streams differ, not
    // because anyone wrote two descriptions.
    expect(dentalEvidence).toContain("Recall the patient");
    expect(farmEvidence).toContain("Schedule irrigation");
    expect(dental.definitions[0]!.definitionId).not.toBe(farm.definitions[0]!.definitionId);
  });

  it("builds a stable, readable definition id from archetype and role", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "Front Desk / Reception" })]),
    );
    expect(set.definitions[0]!.definitionId).toBe("archetype-job:dental-practice:front-desk-reception");
  });
});

describe("roles live on LANES, and that is where most of them are", () => {
  // Probed against the live catalogue of 107 archetypes: all 110 lanes name a
  // responsibleRole, covering 877 stages, while 861 of those stages name none
  // themselves. Reading only the stage — as the room projection's
  // requiredParticipantRole does — derived 9 jobs and left 861 stages unowned.
  // Resolving lane-then-stage derives 116 jobs and leaves none.

  it("attributes a lane's stages to the lane's role", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm(
        [stage({ key: "book" }), stage({ key: "remind", order: 2 })],
        [{ responsibleRole: "Business operator", stages: [{ key: "book" }, { key: "remind" }] }],
      ),
    );
    expect(set.unownedStageKeys).toEqual([]);
    expect(set.definitions).toHaveLength(1);
    expect(set.definitions[0]!.role).toBe("Business operator");
    expect(set.definitions[0]!.accountabilities).toHaveLength(2);
  });

  it("lets a stage that names its own owner override its lane", () => {
    // The more specific declaration wins, as everywhere else in the
    // derive-with-override family.
    const set = buildArchetypeJobDefinitions(
      ovsm(
        [stage({ key: "book" }), stage({ key: "treat", order: 2, responsibleRole: "Clinician" })],
        [{ responsibleRole: "Business operator", stages: [{ key: "book" }, { key: "treat" }] }],
      ),
    );
    expect(set.definitions.map((d) => d.role).sort()).toEqual(["Business operator", "Clinician"]);
    expect(set.definitions.find((d) => d.role === "Clinician")!.accountabilities.map((a) => a.stageKey)).toEqual(["treat"]);
  });

  it("still reports a stage that neither its lane nor itself owns", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "orphan" }), stage({ key: "owned", order: 2 })], [
        { responsibleRole: "Business operator", stages: [{ key: "owned" }] },
      ]),
    );
    expect(set.unownedStageKeys).toEqual(["orphan"]);
  });

  it("tolerates an OVSM with no lanes at all", () => {
    const set = buildArchetypeJobDefinitions(ovsm([stage({ key: "a", responsibleRole: "R" })]));
    expect(set.definitions).toHaveLength(1);
  });
});

describe("priming — what a role must know before it acts", () => {
  it("derives the constraints its own stages impose", () => {
    // Measured across the live catalogue: 23 distinct trust gates. A gate named
    // clinical-adjacent-no-advice is not a checkbox to tick afterwards — it is
    // something the role must hold BEFORE its first turn, or the first turn is
    // the incident.
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({ key: "triage", responsibleRole: "Intake coordinator", trustGateKeys: ["clinical-adjacent-no-advice", "crisis-routing"] }),
      ]),
    );
    const def = set.definitions[0]!;
    expect(def.requiredContext.constraints).toEqual(["clinical-adjacent-no-advice", "crisis-routing"]);
    const context = def.axes.context as { evidence: string };
    expect(context.evidence).toContain("before acting");
    expect(context.evidence).toContain("clinical-adjacent-no-advice");
  });

  it("derives the business domains its stages work in", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([
        stage({ key: "a", responsibleRole: "R", capabilityBindings: ["billing-readiness"] as never }),
        stage({ key: "b", order: 2, responsibleRole: "R", capabilityBindings: ["service-operations"] as never }),
      ]),
    );
    expect(set.definitions[0]!.requiredContext.domains).toEqual(["billing-readiness", "service-operations"]);
  });

  it("answers context from a domain alone, with no gate present", () => {
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R", capabilityBindings: ["rental-fleet"] as never })]),
    );
    expect(set.definitions[0]!.axes.context?.state).toBe("satisfied");
  });

  it("says the corpus supplies craft knowledge, and this supplies the local part", () => {
    // The corpus plane already measures whether a coworker can REACH its
    // profession corpus, and every identity sits at level 3 there. Priming is a
    // different question: what is specific to THIS business.
    const set = buildArchetypeJobDefinitions(
      ovsm([stage({ key: "a", responsibleRole: "R", trustGateKeys: ["safeguarding"] })]),
    );
    expect((set.definitions[0]!.axes.context as { evidence: string }).evidence).toContain("THIS business");
  });
});

import { describe, expect, it } from "vitest";

import { projectBacklogItemReadiness, type InitiativeReadinessActivity } from "./entry-adapter";
import {
  PLAN_DEFINITIONS,
  RESEARCH_DEFINITIONS,
  readinessRequirement,
  requirementNextAction,
} from "./readiness-guidance";
import { READINESS_PROFILES } from "./types";

function evidenceActivity(id: string, evidenceKind: string, recordedAt = "2026-08-27T02:28:00.000Z"): InitiativeReadinessActivity {
  return {
    id,
    kind: "evidence",
    gateKey: null,
    recordedAt: new Date(recordedAt),
    payload: { evidenceKind, summary: "recorded through record_execution_evidence" },
  };
}

function project(activities: InitiativeReadinessActivity[], workType = "bug") {
  return projectBacklogItemReadiness({
    item: { id: "row-1", itemId: "BI-5CBDC146", workType, type: "portfolio", source: "user-request" },
    activities,
    target: "implementation",
    transitionObject: {
      kind: "backlog-item",
      id: "BI-5CBDC146",
      expectedVersion: "claim.v1",
      targetState: "implementation",
    },
    authorization: "pass",
    capsuleIdentity: "pass",
    evaluatedAt: "2026-08-28T00:00:00.000Z",
  });
}

const find = (decision: ReturnType<typeof project>["decision"], code: string) =>
  [...decision.unmet, ...decision.blockers, ...decision.satisfied].find((entry) => entry.code === code);

// BI-28E8CB88. Measured on the live install 2026-08-26: 38 items held `evidence`
// activities, 4 held `initiative_gate_receipt`, so 35 items recorded their work
// into a lane readiness does not read — and neither the writer nor the reader
// said so. The author sees a success result and a timeline entry; the gate then
// reports `missing`, which reads as "you supplied nothing".
describe("evidence recorded outside the receipt lane is reported, not ignored", () => {
  it("reports RESEARCH_REQUIRED as recorded-unread when the item holds qualifying evidence", () => {
    const { decision } = project([
      evidenceActivity("cmt814vg80gch01mgdsvu06f4", "source_verified"),
      evidenceActivity("cmt814vg80gch01mgdsvu06f5", "test_pass"),
    ]);

    const research = find(decision, "RESEARCH_REQUIRED");
    expect(research).toBeDefined();
    // The gate is NOT weakened. The requirement stays unmet.
    expect(research?.state).toBe("missing");
    expect(decision.verdict).toBe("input-required");
    // But it no longer reads as "you supplied nothing".
    expect(research?.evidenceLane).toBe("recorded-unread");
    expect(research?.unreadEvidenceRefs).toEqual([
      "cmt814vg80gch01mgdsvu06f4",
      "cmt814vg80gch01mgdsvu06f5",
    ]);
    expect(research?.nextAction).toMatch(/2 evidence activities are recorded on this item that this gate cannot read/);
    expect(research?.nextAction).toMatch(/A timeline evidence entry is not a gate receipt/);
  });

  it("distinguishes 'no evidence exists' from 'evidence exists this gate cannot read'", () => {
    // Acceptance criterion 2, stated as the two cases that used to be one word.
    const bare = find(project([]).decision, "RESEARCH_REQUIRED");
    expect(bare?.state).toBe("missing");
    expect(bare?.evidenceLane).toBe("none");
    expect(bare?.unreadEvidenceRefs).toEqual([]);

    const held = find(project([evidenceActivity("act-1", "source_verified")]).decision, "RESEARCH_REQUIRED");
    expect(held?.state).toBe("missing");
    expect(held?.evidenceLane).toBe("recorded-unread");
  });

  it("does not treat a FAILING record as an attempt to satisfy a requirement", () => {
    // Reporting a `test_fail` as "evidence this gate cannot read" would mislead
    // in the other direction: there is nothing here a receipt could ratify.
    const research = find(project([evidenceActivity("act-1", "test_fail")]).decision, "RESEARCH_REQUIRED");
    expect(research?.evidenceLane).toBe("none");
  });

  it("does not report evidence against a requirement it could not plausibly answer", () => {
    // A production-build pass is delivery evidence, not research.
    const { decision } = project([evidenceActivity("act-1", "build_pass")]);
    expect(find(decision, "RESEARCH_REQUIRED")?.evidenceLane).toBe("none");
  });
});

// BI-3AE38A1F, reframed on founder direction: even a bug needs research. What
// constitutes research VARIES BY PROFILE, and the bar must be legible to whoever
// is doing the work rather than a code they discover on rejection.
describe("what a requirement means is stated per profile", () => {
  it("gives every profile that carries RESEARCH_REQUIRED a definition", () => {
    for (const profile of READINESS_PROFILES) {
      if (profile === "doc-only") {
        expect(RESEARCH_DEFINITIONS[profile]).toBeNull();
        continue;
      }
      const definition = RESEARCH_DEFINITIONS[profile];
      expect(definition, `${profile} has no research definition`).not.toBeNull();
      expect(definition!.satisfiedBy.length).toBeGreaterThan(0);
      expect(definition!.writerTool).toContain("record_initiative_evidence");
    }
  });

  it("asks a fix for reproduction and a feature for design exploration", () => {
    const fix = requirementNextAction({
      code: "RESEARCH_REQUIRED",
      profile: "fix",
      state: "missing",
      unreadEvidenceRefs: [],
    });
    expect(fix).toMatch(/verification and reproduction/);
    expect(fix).toMatch(/failing-then-passing proof/);
    expect(fix).toMatch(/record_initiative_evidence/);

    const feature = requirementNextAction({
      code: "RESEARCH_REQUIRED",
      profile: "feature",
      state: "missing",
      unreadEvidenceRefs: [],
    });
    expect(feature).toMatch(/design exploration/);
    expect(feature).not.toMatch(/failing-then-passing/);
  });

  it("does not send a fix off to write a plan document", () => {
    // Shipping a docs/superpowers/plans/ file for a single-deliverable fix adds
    // the plan-backlog coverage gate, whose receipt comes only through the
    // reviewer route — the loop this work exists to break.
    expect(PLAN_DEFINITIONS.fix?.summary).toMatch(/not a separate plan document/);
    expect(PLAN_DEFINITIONS.feature?.satisfiedBy.join(" ")).toMatch(/docs\/superpowers\/plans\//);
  });

  it("says nothing for a requirement that is already satisfied", () => {
    expect(requirementNextAction({
      code: "RESEARCH_REQUIRED",
      profile: "fix",
      state: "pass",
      unreadEvidenceRefs: [],
    })).toBeNull();
  });
});

// BI-28E8CB88 recurrence 2026-08-27, on BI-3727106F (merged as 708961196e, 37
// checks green): `update_backlog_item_status` answered
// `DELIVERY_EVIDENCE_REQUIRED  state: missing  evidenceRefs: [<an id>]` — it
// listed the evidence and still said missing, because the completion policy's
// precise blockers were collapsed to one word before the caller saw them.
describe("a collapsed sub-policy verdict carries its own reasons", () => {
  it("reports the dimension the completion policy actually found missing", () => {
    const nextAction = requirementNextAction({
      code: "DELIVERY_EVIDENCE_REQUIRED",
      profile: "fix",
      state: "missing",
      unreadEvidenceRefs: [],
      reasons: ["Completion evidence is missing production-build"],
    });
    expect(nextAction).toMatch(/missing production-build/);
    expect(nextAction).toMatch(/record_execution_evidence/);
  });
});

describe("readinessRequirement is the single constructor for a hand-built result", () => {
  it("fills the lane and next action a bare literal used to omit", () => {
    const requirement = readinessRequirement({
      code: "CAPSULE_IDENTITY_MISMATCH",
      state: "fail",
      accountableRole: "delivery-coordinator",
      profile: "fix",
    });
    expect(requirement.evidenceLane).toBe("none");
    expect(requirement.unreadEvidenceRefs).toEqual([]);
    expect(requirement.nextAction).toMatch(/adopt_worktree/);
  });
});

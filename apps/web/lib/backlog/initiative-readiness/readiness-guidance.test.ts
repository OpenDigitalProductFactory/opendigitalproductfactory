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

// The live case, end to end. Measured against the running install 2026-08-28:
// `update_backlog_item_status(BI-5CBDC146, done)` with a manifest citing the two
// evidence activities that item actually holds answered
//
//   DELIVERY_EVIDENCE_REQUIRED  state: missing  evidenceRefs:
//     ["cmtawlw5s055e01o0q0ian5ua", "cmtawmbs3055u01o0cp6un8b3"]
//
// on a fix that is merged (PR #4736, 427b2f782f) and green. It listed the
// evidence and still said missing, and named no reason — the exact output
// BI-28E8CB88 calls "the one output guaranteed to read as 'you supplied
// nothing' to a caller who supplied exactly what was asked for".
describe("the live BI-5CBDC146 refusal becomes actionable", () => {
  const now = new Date("2026-08-28T21:16:50.777Z");
  const recordedAt = new Date("2026-08-27T02:29:00.000Z");
  const evidence = [
    {
      id: "cmtawlw5s055e01o0q0ian5ua",
      itemId: "row-1",
      evidenceKind: "test_pass" as const,
      recordedAt,
      structurallyValid: true,
    },
    {
      id: "cmtawmbs3055u01o0cp6un8b3",
      itemId: "row-1",
      evidenceKind: "source_verified" as const,
      recordedAt,
      structurallyValid: true,
    },
  ];

  it("names the dimension that is actually unmet", async () => {
    const { evaluateCompletionEvidence } = await import("../completion-evidence-policy");
    const verdict = evaluateCompletionEvidence({
      item: { id: "row-1", itemId: "BI-5CBDC146", status: "in-progress", workType: "bug" },
      rawManifest: {
        workClass: "implementation",
        evidenceActivityIds: evidence.map((entry) => entry.id),
        ux: { disposition: "not-applicable", reason: "Git hook path resolution has no portal surface." },
        migration: { disposition: "not-applicable", reason: "No schema change in this fix." },
      },
      evidence,
      activeBuildEvidence: null,
      evidenceCutoff: new Date("2026-08-01T00:00:00.000Z"),
      now,
    });

    // The policy always knew. It said so, and nothing carried it to the caller.
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockers.map((entry) => entry.message)).toContain(
      "Completion evidence is missing production-build",
    );

    const nextAction = requirementNextAction({
      code: "DELIVERY_EVIDENCE_REQUIRED",
      profile: "fix",
      state: "missing",
      unreadEvidenceRefs: [],
      reasons: [...verdict.blockers.map((entry) => entry.message), verdict.nextAction ?? ""],
    });
    expect(nextAction).toMatch(/missing production-build/);
    expect(nextAction).toMatch(/record_execution_evidence/);
  });

  it("allows delivery once the named dimension is recorded — the gate was never unsatisfiable, only illegible", async () => {
    const { evaluateCompletionEvidence } = await import("../completion-evidence-policy");
    const withBuild = [
      ...evidence,
      {
        id: "act-build-pass",
        itemId: "row-1",
        evidenceKind: "build_pass" as const,
        recordedAt,
        structurallyValid: true,
      },
    ];
    const verdict = evaluateCompletionEvidence({
      item: { id: "row-1", itemId: "BI-5CBDC146", status: "in-progress", workType: "bug" },
      rawManifest: {
        workClass: "implementation",
        evidenceActivityIds: withBuild.map((entry) => entry.id),
        ux: { disposition: "not-applicable", reason: "Git hook path resolution has no portal surface." },
        migration: { disposition: "not-applicable", reason: "No schema change in this fix." },
      },
      evidence: withBuild,
      activeBuildEvidence: null,
      evidenceCutoff: new Date("2026-08-01T00:00:00.000Z"),
      now,
    });

    expect(verdict.blockers).toEqual([]);
    expect(verdict.allowed).toBe(true);
  });
});

// BI-CB3AEBBF. Blocker messages are bare clauses, so joining them with a plain
// space produced "Completion evidence is missing source Completion evidence is
// missing production-build" — read live off a real refusal. The reasons are the
// part a caller acts on; running them together makes the reader hunt for the
// sentence boundary to find the second missing dimension.
describe("requirementNextAction reason joining", () => {
  it("separates two unterminated reasons instead of running them together", () => {
    const action = requirementNextAction({
      code: "DELIVERY_EVIDENCE_REQUIRED",
      state: "missing",
      profile: "fix",
      reasons: [
        "Completion evidence is missing source",
        "Completion evidence is missing production-build",
      ],
      unreadEvidenceRefs: [],
    });

    expect(action).toContain("missing source. Completion evidence");
    expect(action).not.toContain("missing source Completion evidence");
  });

  it("does not double-punctuate a reason that already ends in a stop", () => {
    const action = requirementNextAction({
      code: "DELIVERY_EVIDENCE_REQUIRED",
      state: "missing",
      profile: "fix",
      reasons: ["Evidence activity cmt123 does not resolve.", "Record fresh evidence:"],
      unreadEvidenceRefs: [],
    });

    expect(action).not.toContain("..");
    expect(action).toContain("does not resolve. Record fresh evidence:");
  });

  it("still returns null for a satisfied requirement", () => {
    expect(requirementNextAction({
      code: "DELIVERY_EVIDENCE_REQUIRED",
      state: "pass",
      profile: "fix",
      reasons: ["ignored"],
      unreadEvidenceRefs: [],
    })).toBeNull();
  });
});

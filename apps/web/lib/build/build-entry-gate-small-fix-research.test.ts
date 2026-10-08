import { describe, expect, it, vi } from "vitest";

import { CLAIM_READINESS_ACTIVITY_KINDS } from "@/lib/work-capsules/governed-work-claim";
import { enforceBuildInitiativeReadiness } from "./build-entry-gate";

// BI-7027C26E: a small fix promoted to Build Studio may leave ideate with no
// design review at all (the fix lifecycle's ideate->plan gate is
// "designReview-not-failed-if-present", so a manually promoted fix does not
// deadlock). advanceBuildPhase then asks this gate for the `plan` target, where
// the small shape owes research. With no receipt and no reviewed design, the
// fix's recorded reproduction (BI-6EB2DBBB: source_verified + test_pass) is the
// only research there is — so the gate must load the `evidence` rows the claim
// loads (BI-5C992261), or a reproduced fix is refused forever.

type Activity = { id: string; kind: string; gateKey: string | null; recordedAt: Date; payload: unknown };

const RECEIPT_ROWS: Activity[] = [];

function evidence(id: string, evidenceKind: string, at: string): Activity {
  return { id, kind: "evidence", gateKey: null, recordedAt: new Date(at), payload: { evidenceKind } };
}

function smallFixBuild(stored: Activity[]) {
  // The mock honours the activity-kind filter the gate passes, so a kind the
  // gate does not ask for never reaches the projector — exactly as in Prisma.
  const findUnique = vi.fn().mockImplementation(async (query: {
    select: { originator: { select: { activities: { where: { kind: { in: string[] } } } } } };
  }) => {
    const kinds = query.select.originator.select.activities.where.kind.in;
    return {
      id: "build-row",
      buildId: "FB-FIX",
      kind: "fix",
      originatingBacklogItemId: "bi-row",
      designDoc: null,
      designReview: null,
      buildPlan: null,
      originator: {
        id: "bi-row",
        itemId: "BI-FIX",
        title: "Adoption card shows the wrong age",
        body: "The adoption card renders months as years.",
        type: "product",
        source: "user-request",
        workType: "bug",
        scopeKind: "platform",
        archetypeCategories: [],
        archetypeIds: [],
        activities: stored.filter((activity) => kinds.includes(activity.kind)),
      },
    };
  });
  return {
    featureBuild: { findUnique },
    backlogItemActivity: { create: vi.fn().mockResolvedValue({ id: "decision-row" }) },
    buildActivity: { create: vi.fn().mockResolvedValue({ id: "build-activity" }) },
    workroom: {
      findFirst: vi.fn().mockResolvedValue({
        scopeClaims: [{ workShape: "delivery-small@1.0.0", recordedAt: "2026-10-07T00:00:00.000Z" }],
      }),
    },
  };
}

const enterPlan = (db: ReturnType<typeof smallFixBuild>) => enforceBuildInitiativeReadiness({
  db,
  buildId: "FB-FIX",
  target: "plan",
  targetPhase: "plan",
  expectedPhase: "ideate",
  evaluatedAt: "2026-10-07T12:00:00.000Z",
});

describe("Build Studio entry admits a small fix's recorded reproduction as research (BI-7027C26E)", () => {
  it("refuses research when nothing is recorded", async () => {
    const result = await enterPlan(smallFixBuild(RECEIPT_ROWS));
    expect(result.allowed).toBe(false);
    expect(result.decision.unmet.map((entry) => entry.code)).toContain("RESEARCH_REQUIRED");
  });

  it("lets a small fix with no design review enter plan once its reproduction is recorded", async () => {
    const result = await enterPlan(smallFixBuild([
      evidence("ev-source", "source_verified", "2026-10-07T10:00:00.000Z"),
      evidence("ev-test", "test_pass", "2026-10-07T11:00:00.000Z"),
    ]));
    expect(result.decision.unmet.map((entry) => entry.code)).not.toContain("RESEARCH_REQUIRED");
    expect(result.allowed).toBe(true);
  });

  it("still refuses half a reproduction", async () => {
    for (const rows of [
      [evidence("ev-source", "source_verified", "2026-10-07T10:00:00.000Z")],
      [evidence("ev-test", "test_pass", "2026-10-07T11:00:00.000Z")],
      [
        evidence("ev-source", "source_verified", "2026-10-07T10:00:00.000Z"),
        evidence("ev-pass", "test_pass", "2026-10-07T10:30:00.000Z"),
        evidence("ev-fail", "test_fail", "2026-10-07T11:00:00.000Z"),
      ],
    ]) {
      const result = await enterPlan(smallFixBuild(rows));
      expect(result.allowed).toBe(false);
      expect(result.decision.unmet.map((entry) => entry.code)).toContain("RESEARCH_REQUIRED");
    }
  });

  it("reads the same activity kinds the claim reads, with no cap that lets evidence crowd out receipts", async () => {
    const db = smallFixBuild(RECEIPT_ROWS);
    await enterPlan(db);
    const activities = db.featureBuild.findUnique.mock.calls[0]![0].select.originator.select.activities;
    expect([...activities.where.kind.in].sort()).toEqual([...CLAIM_READINESS_ACTIVITY_KINDS].sort());
    expect(activities.take).toBeUndefined();
  });
});

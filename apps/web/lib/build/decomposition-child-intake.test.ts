// apps/web/lib/build/decomposition-child-intake.test.ts
//
// BI-FF8ABFCB — child intake derivation + self-heal.

import { describe, expect, it, vi } from "vitest";

import {
  buildDecompositionChildIntakePatch,
  healDecompositionChildIntake,
  type HealChildIntakeDb,
} from "./decomposition-child-intake";
import { isHappyPathIntakeReady, normalizeHappyPathState } from "@/lib/explore/feature-build-types";

const parentIntake = {
  status: "ready" as const,
  epicId: "EP-PARTNER-CHANNEL",
  backlogItemId: "BI-DE47EC0B",
  taxonomyNodeId: "triaged-bi:cmq05mt4t00ib01qpvz2ts6zu",
  constrainedGoal: "Phase 2: Partner identity",
  failureReason: null,
};

describe("buildDecompositionChildIntakePatch", () => {
  it("inherits parent backlog + taxonomy, anchors on the child's own epic, uses child title as goal", () => {
    const patch = buildDecompositionChildIntakePatch({
      parentIntake,
      epicSemanticId: "EP-043E34AE",
      childTitle: "Program setup and partner-account parts truck",
      childOriginatingBacklogItemId: "cmq-child-bi",
      childBuildId: "FB-CHILD",
    });
    expect(patch).toEqual({
      status: "ready",
      epicId: "EP-043E34AE",
      backlogItemId: "BI-DE47EC0B",
      taxonomyNodeId: "triaged-bi:cmq05mt4t00ib01qpvz2ts6zu",
      constrainedGoal: "Program setup and partner-account parts truck",
    });
  });

  it("produces an intake that satisfies the plan gate (isHappyPathIntakeReady)", () => {
    const patch = buildDecompositionChildIntakePatch({
      parentIntake,
      epicSemanticId: "EP-043E34AE",
      childTitle: "child",
      childOriginatingBacklogItemId: "bi",
      childBuildId: "FB-C",
    });
    const state = normalizeHappyPathState({ intake: patch });
    expect(isHappyPathIntakeReady(state)).toBe(true);
  });

  it("falls back to a provenance taxonomy anchor when the parent lacks one", () => {
    const patch = buildDecompositionChildIntakePatch({
      parentIntake: { ...parentIntake, taxonomyNodeId: null },
      epicSemanticId: "EP-X",
      childTitle: "c",
      childOriginatingBacklogItemId: "cmq-bi-row",
      childBuildId: "FB-C",
    });
    expect(patch.taxonomyNodeId).toBe("triaged-bi:cmq-bi-row");
  });

  it("falls back to the child's originating BI when the parent intake has no backlogItemId", () => {
    const patch = buildDecompositionChildIntakePatch({
      parentIntake: { ...parentIntake, backlogItemId: null },
      epicSemanticId: "EP-X",
      childTitle: "c",
      childOriginatingBacklogItemId: "cmq-bi-row",
      childBuildId: "FB-C",
    });
    expect(patch.backlogItemId).toBe("cmq-bi-row");
  });
});

describe("healDecompositionChildIntake", () => {
  function makeDb(parentPlan: unknown): { db: HealChildIntakeDb; updates: Array<{ where: unknown; data: unknown }> } {
    const updates: Array<{ where: unknown; data: unknown }> = [];
    const db: HealChildIntakeDb = {
      epic: { findUnique: vi.fn(async () => ({ epicId: "EP-043E34AE" })) },
      featureBuild: {
        findFirst: vi.fn(async () => ({ plan: parentPlan })),
        update: vi.fn(async (args) => {
          updates.push(args);
          return {};
        }),
      },
    };
    return { db, updates };
  }

  it("backfills a child's missing intake from the superseded parent and persists it", async () => {
    const { db, updates } = makeDb({ happyPathState: { intake: parentIntake } });
    const healed = await healDecompositionChildIntake({
      child: {
        buildId: "FB-CHILD",
        title: "Ops gate and scope fence truck",
        parentEpicId: "epic-row-1",
        originatingBacklogItemId: "cmq-child-bi",
        plan: null,
      },
      db,
    });
    expect(healed).toBe(true);
    expect(updates).toHaveLength(1);
    const written = normalizeHappyPathState(
      (updates[0]!.data as { plan: { happyPathState: unknown } }).plan.happyPathState,
    );
    expect(isHappyPathIntakeReady(written)).toBe(true);
    expect(written.intake.epicId).toBe("EP-043E34AE");
    expect(written.intake.backlogItemId).toBe("BI-DE47EC0B");
    expect(written.intake.constrainedGoal).toBe("Ops gate and scope fence truck");
  });

  it("is a no-op when the child's intake is already ready", async () => {
    const { db, updates } = makeDb({ happyPathState: { intake: parentIntake } });
    const healed = await healDecompositionChildIntake({
      child: {
        buildId: "FB-READY",
        title: "already fine",
        parentEpicId: "epic-row-1",
        originatingBacklogItemId: "bi",
        plan: { happyPathState: { intake: parentIntake } },
      },
      db,
    });
    expect(healed).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

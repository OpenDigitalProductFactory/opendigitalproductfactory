import { describe, expect, it, vi } from "vitest";

import {
  runSemanticChangeReview,
  selectSemanticReviewSpecialists,
  type SemanticChangeReviewOperationInput,
} from "./semantic-change-review-operation";

const identity = {
  capsuleId: "WC-REVIEW",
  baseTreeHash: "a".repeat(40),
  headTreeHash: "b".repeat(40),
  diffDigest: "c".repeat(64),
  policyVersion: "semantic-change-review-policy.v1",
  reviewerVersion: "change-reviewer.v1",
  specialistIds: [],
};

function input(overrides: Partial<SemanticChangeReviewOperationInput> = {}): SemanticChangeReviewOperationInput {
  return {
    surface: "external",
    authorSurface: "codex-desktop",
    artifactType: "code-change",
    title: "Committed runtime change",
    artifact: "diff --git a/apps/web/lib/a.ts b/apps/web/lib/a.ts",
    verificationEvidence: "1 test passed",
    changedFiles: ["apps/web/lib/a.ts"],
    identity,
    repairRound: 0,
    mode: "enforce",
    ...overrides,
  };
}

describe("semantic change-review operation", () => {
  it("requires independent review for runtime code before publication", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      decision: "pass",
      issues: [],
      summary: "Runtime change is correct and covered.",
    });

    const out = await runSemanticChangeReview(input(), { dispatch });

    expect(dispatch).toHaveBeenCalledOnce();
    expect(out.activation.activate).toBe(true);
    expect(out.receipt.disposition).toBe("reviewed");
    expect(out.mayPublish).toBe(true);
  });

  it.each(["codex-desktop", "claude-desktop", "grok-desktop"])(
    "routes %s runtime delivery through review before publication",
    async (authorSurface) => {
      const dispatch = vi.fn().mockResolvedValue({ decision: "pass", issues: [], summary: "Pass." });
      const out = await runSemanticChangeReview(input({ authorSurface }), { dispatch });
      expect(dispatch).toHaveBeenCalledOnce();
      expect(out.mayPublish).toBe(true);
      expect(out.receipt.result.decision).toBe("pass");
    },
  );

  it("auto-passes a low-risk docs-only change with durable evidence", async () => {
    const dispatch = vi.fn();
    const out = await runSemanticChangeReview(
      input({
        artifactType: "spec",
        title: "Clarify contributor docs",
        artifact: "diff --git a/docs/guide.md b/docs/guide.md",
        changedFiles: ["docs/guide.md"],
      }),
      { dispatch },
    );

    expect(dispatch).not.toHaveBeenCalled();
    expect(out.receipt.disposition).toBe("auto-pass");
    expect(out.evidence.activity.payload).toEqual(out.receipt);
    expect(out.evidence.externalEvidence.details).toEqual(out.receipt);
    expect(out.mayPublish).toBe(true);
  });

  it("reuses a fresh receipt and re-reviews a stale receipt", async () => {
    const firstDispatch = vi.fn().mockResolvedValue({ decision: "pass", issues: [], summary: "Pass." });
    const first = await runSemanticChangeReview(input(), { dispatch: firstDispatch });
    const reuseDispatch = vi.fn();
    const reused = await runSemanticChangeReview(input({ priorReceipt: first.receipt }), { dispatch: reuseDispatch });

    expect(reuseDispatch).not.toHaveBeenCalled();
    expect(reused.reusedFreshReceipt).toBe(true);

    const staleDispatch = vi.fn().mockResolvedValue({ decision: "pass", issues: [], summary: "Re-reviewed." });
    const stale = await runSemanticChangeReview(
      input({
        identity: { ...identity, headTreeHash: "d".repeat(40) },
        priorReceipt: first.receipt,
      }),
      { dispatch: staleDispatch },
    );

    expect(staleDispatch).toHaveBeenCalledOnce();
    expect(stale.staleReasons).toContain("head-tree-changed");
    expect(stale.reusedFreshReceipt).toBe(false);
  });

  it("stops the repair loop after two failed repair rounds", async () => {
    const dispatch = vi.fn().mockResolvedValue({
      decision: "fail",
      issues: [{ severity: "critical", description: "Broken authorization boundary" }],
      summary: "Blocking defect remains.",
    });

    const out = await runSemanticChangeReview(input({ repairRound: 2 }), { dispatch });

    expect(out.repairLimitReached).toBe(true);
    expect(out.nextAction).toBe("operator-review");
    expect(out.mayPublish).toBe(false);
  });

  it("uses the identical evidence projection for external and Build Studio surfaces", async () => {
    const dispatch = vi.fn().mockResolvedValue({ decision: "pass", issues: [], summary: "Pass." });
    const external = await runSemanticChangeReview(input({ surface: "external" }), { dispatch });
    const studio = await runSemanticChangeReview(input({ surface: "build-studio" }), { dispatch });

    expect(studio.evidence).toEqual(external.evidence);
  });

  it("routes content-scoped high-risk review through existing specialist coworkers", () => {
    expect(selectSemanticReviewSpecialists([
      "apps/web/components/Form.tsx",
      "packages/db/prisma/schema.prisma",
      "package.json",
      "docs/architecture/runtime.md",
    ])).toEqual([
      "AGT-131",
      "AGT-181",
      "AGT-902",
      "AGT-903",
    ]);
  });

  it("rejects an uncommitted or unresolved tree identity", async () => {
    await expect(runSemanticChangeReview(
      input({ identity: { ...identity, headTreeHash: "" } }),
      { dispatch: vi.fn() },
    )).rejects.toThrow("stable committed tree");
  });

  it("supports shadow-only rollback without discarding the failed receipt", async () => {
    const out = await runSemanticChangeReview(
      input({ mode: "shadow" }),
      {
        dispatch: vi.fn().mockResolvedValue({
          decision: "fail",
          issues: [{ severity: "critical", description: "Real defect" }],
          summary: "Defect found.",
        }),
      },
    );

    expect(out.receipt.result.decision).toBe("fail");
    expect(out.mayPublish).toBe(true);
    expect(out.nextAction).toBe("shadow-observe");
  });
});

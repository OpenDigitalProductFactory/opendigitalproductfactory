// BI-FD7DE19D — the review packet carries evidence as a bounded, digest-bound
// pointer, never the full gate log, and never trims the diff.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
import { runSemanticChangeReview, type SemanticChangeReviewOperationInput } from "./semantic-change-review-operation";
import { semanticReviewMinimumContextTokens } from "./semantic-review-context-floor";
import {
  REVIEW_EVIDENCE_OBSERVED_EXCERPT_CHARS,
  boundReviewEvidence,
  endpointIneligibleSummary,
} from "./semantic-review-evidence-budget";

const identity = {
  capsuleId: "WC-REVIEW", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40), diffDigest: "c".repeat(64),
  policyVersion: "semantic-change-review-policy.v1", reviewerVersion: "change-reviewer.v1", specialistIds: [],
};

function gateLog(chars: number): string {
  const lines: string[] = [];
  for (let i = 0; lines.join("\n").length < chars; i += 1) lines.push(`[guard ${i}] ok`);
  return lines.join("\n").slice(0, chars - 12) + "\nGATE PASSED";
}

function input(observed: string, artifact: string): SemanticChangeReviewOperationInput {
  const fixture = failureAnalysisFixture(identity);
  return {
    surface: "external", authorSurface: "claude-desktop", artifactType: "code-change", title: "Committed runtime change",
    artifact, verificationEvidence: "Local-CI gate PASS", changedFiles: ["apps/web/lib/a.ts"], identity, repairRound: 0, mode: "enforce",
    ...fixture,
    resolvedFailureEvidence: fixture.resolvedFailureEvidence.map((row) => ({ ...row, observed })),
  };
}

const pass = { decision: "pass", issues: [], summary: "Reviewed.",
  failureAnalysisReview: { adequate: true, rationale: "Challenged the failure modes against the executed gate evidence." } };

describe("boundReviewEvidence (BI-FD7DE19D)", () => {
  it("replaces a long observed log with a digest pointer and a bounded tail excerpt", () => {
    const log = gateLog(12_000);
    const [row] = boundReviewEvidence([{ id: "ev-1", observed: log, status: "passed" }]);
    expect(row).toMatchObject({
      id: "ev-1", status: "passed",
      observedChars: 12_000,
      observedSha256: createHash("sha256").update(log).digest("hex"),
    });
    expect(row).not.toHaveProperty("observed");
    const excerpt = (row as Record<string, unknown>).observedExcerpt as string;
    expect(excerpt).toBe(log.slice(-REVIEW_EVIDENCE_OBSERVED_EXCERPT_CHARS));
    expect(excerpt).toContain("GATE PASSED");
  });

  it("keeps a short observed output whole", () => {
    expect(boundReviewEvidence([{ id: "ev-1", observed: "1 test passed" }])).toEqual([{ id: "ev-1", observed: "1 test passed" }]);
  });

  it("is deterministic", () => {
    const rows = [{ id: "ev-1", observed: gateLog(9_000) }];
    expect(JSON.stringify(boundReviewEvidence(rows))).toBe(JSON.stringify(boundReviewEvidence(rows)));
  });
});

describe("the review prompt (BI-FD7DE19D)", () => {
  it("sends the diff whole and the gate log as a pointer", async () => {
    const log = gateLog(12_000);
    const artifact = `diff --git a/apps/web/lib/a.ts b/apps/web/lib/a.ts\n${"+const x = 1;\n".repeat(400)}`;
    const dispatch = vi.fn().mockResolvedValue(pass);
    await runSemanticChangeReview(input(log, artifact), { dispatch });
    const prompt = dispatch.mock.calls[0]![0] as string;
    expect(prompt).toContain(artifact);
    expect(prompt).not.toContain(log);
    expect(prompt).toContain(createHash("sha256").update(log).digest("hex"));
    expect(prompt).toContain('"observedChars":12000');
  });

  // The measured live packet (PR #6875): a 61,264-char diff plus a 12,000-char
  // gate log needed 42,051 tokens against the 40,960-token local reviewer.
  it("fits the measured live packet inside a 40,960-token reviewer", async () => {
    const artifact = `diff --git a/x b/x\n${"+".repeat(61_264 - 20)}`;
    const dispatch = vi.fn().mockResolvedValue(pass);
    await runSemanticChangeReview(input(gateLog(12_000), artifact), { dispatch });
    const prompt = dispatch.mock.calls[0]![0] as string;
    expect(semanticReviewMinimumContextTokens({ systemPrompt: "s".repeat(1_435), userPrompt: prompt })).toBeLessThanOrEqual(40_960);
  });
});

describe("endpointIneligibleSummary (BI-FD7DE19D)", () => {
  const eligibility = (buckets: string[]) => [{ sensitivity: "confidential", residencyPolicy: "any_enabled", excludedCount: buckets.length,
    exclusions: buckets.map((bucket) => ({ bucket, count: 1 })) }];

  it("names splitting the change when a context window excluded a reviewer", () => {
    const summary = endpointIneligibleSummary(eligibility(["sensitivity-clearance", "context-window"]) as never);
    expect(summary).toMatch(/larger than the largest eligible reviewer context/);
    expect(summary).toMatch(/split the change into smaller pull requests/i);
  });

  it("keeps the generic summary otherwise", () => {
    expect(endpointIneligibleSummary(eligibility(["sensitivity-clearance"]) as never))
      .toBe("No endpoint meets the review's routing requirements. No provider dispatch began for this branch.");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewReadinessStrip } from "@/components/build/ReviewReadinessStrip";
import type { FeatureBuildRow, ReviewResult } from "@/lib/feature-build-types";

function review(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return { decision: "pass", issues: [], summary: "", ...overrides };
}

function build(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    planReview: null,
    designReview: null,
    taskResults: null,
    uxTestResults: null,
    verificationOut: null,
    acceptanceMet: null,
    ...overrides,
  } as unknown as FeatureBuildRow;
}

describe("ReviewReadinessStrip render gate", () => {
  it("renders nothing outside the review phase", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip build={build({ planReview: review() })} phase="build" />,
    );
    expect(html).toBe("");
  });

  it("renders the strip during the review phase", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip build={build({ planReview: review() })} phase="review" />,
    );
    expect(html).toContain('data-testid="review-readiness-strip"');
    expect(html).toContain("Review Readiness");
  });
});

describe("ReviewReadinessStrip chips", () => {
  it("always renders the checklist + verification spine for a bare review build", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip build={build()} phase="review" />,
    );
    expect(html).toContain('data-lens-key="checklist"');
    expect(html).toContain('data-lens-key="verification"');
    // Optional lenses are absent without backing data.
    expect(html).not.toContain('data-lens-key="code-review"');
    expect(html).not.toContain('data-lens-key="ux"');
  });

  it("encodes each lens state in data-state and the aria-label", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip
        build={build({
          planReview: review({
            decision: "fail",
            issues: [{ severity: "critical", description: "x" }],
          }),
        })}
        phase="review"
      />,
    );
    expect(html).toContain('data-state="fail"');
    expect(html).toContain('aria-label="Checklist review: fail — 1 critical"');
  });

  it("shows the cleared / blocking summary in the section header", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip
        build={build({
          planReview: review({
            decision: "fail",
            issues: [{ severity: "critical", description: "x" }],
          }),
          verificationOut: {
            testsPassed: 1,
            testsFailed: 0,
            typecheckPassed: true,
            fullOutput: "",
            timestamp: "",
          },
        })}
        phase="review"
      />,
    );
    // checklist=fail, verification=pass → 1/2 cleared · 1 blocking
    expect(html).toContain("1/2 cleared");
    expect(html).toContain("1 blocking");
  });

  it("renders an advisory chip (non-gating) when architecture review ran", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip
        build={build({
          planReview: review({
            architectureAdvisory: { summary: "s", issues: [{ severity: "minor", description: "n" }] },
          }),
        })}
        phase="review"
      />,
    );
    expect(html).toContain('data-lens-key="architecture"');
    expect(html).toContain('data-state="advisory"');
    expect(html).toContain('aria-label="Architecture: advisory — 1 note"');
  });

  it("renders named reviewer chips when per-reviewer verdicts are persisted", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip
        build={build({
          planReview: review({
            decision: "fail",
            reviewers: [
              { source: "reviewer-1", label: "Primary review", role: "reviewer", decision: "pass", issueCounts: { critical: 0, important: 0, minor: 0 } },
              { source: "reviewer-2", label: "Independent review", role: "reviewer", decision: "fail", issueCounts: { critical: 1, important: 0, minor: 0 } },
              { source: "architect", label: "Architecture", role: "architect", decision: "pass", issueCounts: { critical: 0, important: 0, minor: 0 } },
            ],
          }),
        })}
        phase="review"
      />,
    );
    expect(html).toContain('data-lens-key="reviewer:reviewer-1"');
    expect(html).toContain('aria-label="Primary review: pass — cleared"');
    expect(html).toContain('aria-label="Independent review: fail — 1 critical"');
    expect(html).toContain('aria-label="Architecture: advisory — aligned"');
    // The merged checklist chip is replaced by the per-reviewer chips.
    expect(html).not.toContain('data-lens-key="checklist"');
  });

  it("renders no raw hex literals (DPF token invariant)", () => {
    const html = renderToStaticMarkup(
      <ReviewReadinessStrip
        build={build({
          planReview: review({ decision: "fail", issues: [{ severity: "critical", description: "x" }] }),
          taskResults: [
            { taskIndex: 0, title: "t", testResult: { passed: true, output: "" }, codeReview: review() },
          ],
          acceptanceMet: [{ criterion: "a", met: false, evidence: "" }],
        })}
        phase="review"
      />,
    );
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

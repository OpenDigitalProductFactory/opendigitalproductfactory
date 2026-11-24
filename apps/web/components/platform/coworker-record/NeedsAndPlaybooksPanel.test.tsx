import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NeedsAndPlaybooksPanel } from "./NeedsAndPlaybooksPanel";
import { WorkPatternBindingCard } from "./WorkPatternBindingCard";

describe("ActivePlaybookBindingCard", () => {
  it("explains evidence-bounded autonomy without exposing engineer identifiers", () => {
    const markup = renderToStaticMarkup(
      <WorkPatternBindingCard
        now={new Date("2026-07-26T12:00:00.000Z")}
        binding={{
          bindingId: "AB-WP-ENGINEER-ID",
          name: "Build review v2",
          status: "active",
          resourceRef: "build-review@2",
          updatedAt: new Date("2026-07-26T10:00:00.000Z"),
          authorityScope: {
            schemaVersion: 1,
            activationLaneKey: "WP-LANE-ENGINEER-ID",
            bindingScopeKey: "WP-SCOPE-ENGINEER-ID",
            patternKey: "build-review",
            patternVersion: 2,
            activityKey: "build.implement",
            riskClass: "internal-reversible",
            installScopes: ["dpf_dogfood"],
            organizationIds: ["org-dogfood"],
            taskCorpusKeys: ["dpf-repository"],
            modelProfileIds: ["frontier-coding"],
            promotionPolicyKey: "governed-build-playbook-promotion",
            promotionPolicyVersion: 1,
            sourceExperimentTaskRunId: "TR-WPX-ENGINEER-ID",
            corroborationTaskRunIds: [],
            priorSafeBindingId: "AB-prior",
            evidenceFreshnessAt: "2026-07-26T10:00:00.000Z",
            evidenceOrigin: "customer-zero",
            scopeCeiling: "same-install",
            blockers: [
              "broader_scope_requires_portable_corpus_or_customer_corroboration",
            ],
          },
        }}
      />,
    );

    expect(markup).toContain("Active method");
    expect(markup).toContain("Only this DPF installation");
    expect(markup).toContain("Evidence checked today");
    expect(markup).toContain("cannot add to the coworker");
    expect(markup).toContain("What is needed for broader use");
    expect(markup).not.toContain("ENGINEER-ID");
  });

  it("keeps rollback history behind disclosure", () => {
    const markup = renderToStaticMarkup(
      <NeedsAndPlaybooksPanel
        canWrite={false}
        needs={{
          summary: { total: 0, byStatus: {}, bySeverity: {}, byKind: {} },
          filterOptions: { statuses: [], severities: [], kinds: [] },
          needs: [],
        }}
        workPatterns={{
          generatedAt: new Date("2026-07-26T12:00:00.000Z"),
          window: {
            since: new Date("2026-06-26T12:00:00.000Z"),
            until: new Date("2026-07-26T12:00:00.000Z"),
          },
          summary: {
            totalPatterns: 0,
            totalObservedRuns: 0,
            openNeedCount: 0,
            readyForReviewCount: 0,
            candidateOnlyCount: 0,
          },
          bindings: [{
            bindingId: "AB-rolled-back",
            name: "Build review v1",
            status: "rolled-back",
            resourceRef: "build-review@1",
            updatedAt: new Date("2026-07-26T10:00:00.000Z"),
            authorityScope: {
              schemaVersion: 1,
              activationLaneKey: "WP-LANE",
              bindingScopeKey: "WP-SCOPE",
              patternKey: "build-review",
              patternVersion: 1,
              activityKey: "build.implement",
              riskClass: "internal-reversible",
              installScopes: ["dpf_dogfood"],
              organizationIds: ["org-dogfood"],
              taskCorpusKeys: ["dpf-repository"],
              modelProfileIds: ["frontier-coding"],
              promotionPolicyKey: "governed-build-playbook-promotion",
              promotionPolicyVersion: 1,
              sourceExperimentTaskRunId: "TR-WPX",
              corroborationTaskRunIds: [],
              priorSafeBindingId: null,
              evidenceFreshnessAt: "2026-07-26T10:00:00.000Z",
              evidenceOrigin: "customer-zero",
              scopeCeiling: "same-install",
              blockers: [],
            },
          }],
          patterns: [],
        }}
      />,
    );

    expect(markup).toContain("<details>");
    expect(markup).toContain("Replaced and rolled-back method history");
    expect(markup.indexOf("Build review v1")).toBeGreaterThan(
      markup.indexOf("<summary"),
    );
  });

  it("renders Approve/Defer/Reject controls for a proposed experiment candidate when canWrite is true", () => {
    const basePattern = {
      patternKey: "build.implement:dpf-standard",
      agentId: "build-specialist",
      routeContext: "/platform/ai/agent/build-specialist",
      riskClass: "internal-reversible",
      status: "candidate" as const,
      scope: "activity" as const,
      version: 2,
      source: "human-review" as const,
      decisionScope: "platform-wwmd" as const,
      observedRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      outcomeCounts: {},
      latestObservedAt: null,
      latestTaskRunId: null,
      evidenceRefs: [{ capabilityNeedId: "CWN-1" }],
      candidate: {
        kind: "skill" as const,
        need: "Prove standard dogfood implementation loop",
        blocks: "Unblocks autonomous build eligibility",
        fingerprint: "fp-1",
        evaluationMethod: "governed-work-pattern-experiment",
      },
      candidateNeedKinds: ["skill" as const],
      linkedNeedIds: ["CWN-1"],
      openNeedCount: 1,
      readiness: {
        readyForReview: true,
        readyForCaseActivation: false,
        blockers: ["pattern-status-not-approved-or-active"],
      },
      activationProposed: true,
      reviewState: null,
      activationCandidate: null,
      caseStaging: null,
      shadowEvaluation: null,
      experiment: null,
      experimentCandidateProposed: true,
    };
    const emptyNeeds = {
      summary: { total: 0, byStatus: {}, bySeverity: {}, byKind: {} },
      filterOptions: { statuses: [], severities: [], kinds: [] },
      needs: [],
    };
    const workPatterns = {
      generatedAt: new Date("2026-11-24T01:00:00.000Z"),
      window: {
        since: new Date("2026-10-25T01:00:00.000Z"),
        until: new Date("2026-11-24T01:00:00.000Z"),
      },
      summary: {
        totalPatterns: 1,
        totalObservedRuns: 0,
        openNeedCount: 1,
        readyForReviewCount: 1,
        candidateOnlyCount: 1,
      },
      bindings: [],
      patterns: [basePattern],
    };

    const writable = renderToStaticMarkup(
      <NeedsAndPlaybooksPanel canWrite={true} needs={emptyNeeds} workPatterns={workPatterns} />,
    );
    expect(writable).toContain("Approve candidate");
    expect(writable).toContain("Defer");
    expect(writable).toContain("Reject");

    const readonly = renderToStaticMarkup(
      <NeedsAndPlaybooksPanel canWrite={false} needs={emptyNeeds} workPatterns={workPatterns} />,
    );
    expect(readonly).not.toContain("Approve candidate");
  });
});

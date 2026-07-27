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
});

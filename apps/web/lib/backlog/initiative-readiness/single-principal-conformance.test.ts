/**
 * Conformance: an install with ONE human principal must still reach a governed
 * scope baseline, and must never reach it by weakening separation of duties.
 *
 * BI-72F368BC is the third recorded occurrence of this class — a mandatory
 * gate whose accepted-actor set is empty on a real install shape — so the
 * deliverable that stops a fourth is this file, not the fix.
 *
 * The shape under test is the one this install actually has: exactly one human
 * Principal (`kind: human`), a set of coworker Principals (`kind: agent`), and
 * artifacts authored by the human through an external CLI session that carries
 * no agent provenance at all.
 */

import { describe, expect, it, vi } from "vitest";

import {
  independentReviewerRemedy,
  resolveReviewerIdentity,
  type AliasReader,
} from "./reviewer-identity";
import {
  validateInitiativeGateReceiptDraft,
  type InitiativeGateReceiptContext,
  type InitiativeGateReceiptDraft,
} from "./receipt-schema";

const HUMAN = "PRN-human-sole";
const REVIEWER_COWORKER = "PRN-agent-change-reviewer";

/** The single-principal install: one human alias, one reviewer-coworker alias. */
function singlePrincipalInstall(): AliasReader {
  return {
    principalAlias: {
      findMany: vi.fn(async ({ where }) => {
        if (where.aliasType === "user" && where.aliasValue === "user-sole") {
          return [{ principal: { principalId: HUMAN } }];
        }
        if (where.aliasType === "agent" && where.aliasValue === "change-reviewer") {
          return [{ principal: { principalId: REVIEWER_COWORKER } }];
        }
        return [];
      }),
    },
  };
}

const draft: InitiativeGateReceiptDraft = {
  gate: "spec-approval",
  decision: "pass",
  artifactRef: { kind: "repo-blob-at-commit", repositoryFullName: "o/r", commitSha: "abc", path: "docs/superpowers/specs/x.md", providerBlobId: "blob" },
  reason: "The canonical design declares its objectives and acceptance statements.",
  findingRefs: [],
  resolvedFindingRefs: [],
};

function contextFor(reviewerPrincipalId: string, reviewerAgentId: string | null): InitiativeGateReceiptContext {
  return {
    receiptId: "activity-1",
    policyVersion: "initiative-readiness.v1",
    allowedGates: ["spec-approval"],
    subject: { kind: "backlog-item", id: "BI-72F368BC" },
    resolvedArtifact: {
      ref: draft.artifactRef,
      digest: "sha256:design",
      // Externally authored: a human principal, no agent provenance.
      authorPrincipalId: HUMAN,
      authorAgentId: null,
    },
    reviewerPrincipalId,
    reviewerAgentId,
    authorityDecisionId: "authority-1",
    authoritySnapshot: {
      decision: "allow",
      effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "initiative_design_review",
      tokenScope: "write",
      organizationId: "org-1",
      actionKey: "record_initiative_design_review",
      policyVersion: "authorization.v1",
    },
    openFindingRefs: [],
    resolvedFindings: [],
    requiresIndependentReviewer: true,
  };
}

describe("single-principal install reaches a governed scope baseline", () => {
  it("attributes a coworker-recorded review to the COWORKER's principal, not the delegating human", async () => {
    const identity = await resolveReviewerIdentity(singlePrincipalInstall(), {
      reviewerUserId: "user-sole",
      reviewerAgentId: "change-reviewer",
    });
    expect(identity).toEqual({ principalId: REVIEWER_COWORKER, kind: "coworker" });
  });

  it("passes the spec-approval gate for that coworker, so a baseline becomes reachable", () => {
    expect(validateInitiativeGateReceiptDraft(draft, contextFor(REVIEWER_COWORKER, "change-reviewer")))
      .toMatchObject({ ok: true });
  });

  it("still attributes a direct human call to the human, and still refuses it as self-review", async () => {
    const identity = await resolveReviewerIdentity(singlePrincipalInstall(), {
      reviewerUserId: "user-sole",
      reviewerAgentId: null,
    });
    expect(identity).toEqual({ principalId: HUMAN, kind: "human" });
    expect(validateInitiativeGateReceiptDraft(draft, contextFor(HUMAN, "claude-code")))
      .toMatchObject({ ok: false, code: "reviewer-not-independent" });
  });

  it("falls back to the human when the agent id has no registered principal", async () => {
    // An external CLI session label is not a coworker identity.
    const identity = await resolveReviewerIdentity(singlePrincipalInstall(), {
      reviewerUserId: "user-sole",
      reviewerAgentId: "claude-code-session-1",
    });
    expect(identity).toEqual({ principalId: HUMAN, kind: "human" });
  });

  it("refuses an ambiguous identity rather than picking one", async () => {
    const ambiguous: AliasReader = {
      principalAlias: { findMany: vi.fn(async () => [
        { principal: { principalId: "PRN-a" } },
        { principal: { principalId: "PRN-b" } },
      ]) },
    };
    expect(await resolveReviewerIdentity(ambiguous, { reviewerUserId: "user-sole", reviewerAgentId: null })).toBeNull();
  });
});

describe("separation of duties survives the fix", () => {
  // The whole risk of making the gate reachable is that it gets made reachable
  // by turning the rule off. Nothing in the receipt context may do that except
  // a lane that is declared non-independent by design.
  it("has no disposition, flag, or override that lets an author approve their own artifact", () => {
    const selfReview = contextFor(HUMAN, "claude-code");
    for (const override of [
      { requiresIndependentReviewer: true },
      { requiresIndependentReviewer: undefined },
      // A caller-supplied truthy value is not an escape hatch either.
      { requiresIndependentReviewer: "yes" as unknown as boolean },
    ]) {
      expect(validateInitiativeGateReceiptDraft(draft, { ...selfReview, ...override }))
        .toMatchObject({ ok: false, code: "reviewer-not-independent" });
    }
  });

  it("refuses self-review even when the author's agent provenance is absent", () => {
    expect(validateInitiativeGateReceiptDraft(draft, contextFor(HUMAN, null)))
      .toMatchObject({ ok: false, code: "reviewer-not-independent" });
  });

  it("names the author, the reviewer, and the one route forward", () => {
    const result = validateInitiativeGateReceiptDraft(draft, contextFor(HUMAN, "claude-code"));
    const error = (result as { error: string }).error;
    expect(error).toContain(HUMAN);
    expect(error).toContain("spec-approval");
    expect(error).toContain("initiative_design_review");
    expect(error).toContain("coworker");
    expect(error).toContain("no self-approval override");
  });

  it("keeps the remedy accurate when author and reviewer are genuinely different identities", () => {
    // The agent-collision leg: distinct principals, same agent.
    const remedy = independentReviewerRemedy({
      gate: "spec-approval",
      grant: "initiative_design_review",
      authorPrincipalId: "PRN-a",
      reviewerPrincipalId: "PRN-b",
      reviewerKind: "coworker",
    });
    expect(remedy).not.toContain("the same identity");
    expect(remedy).toContain("PRN-a");
    expect(remedy).toContain("PRN-b");
  });
});

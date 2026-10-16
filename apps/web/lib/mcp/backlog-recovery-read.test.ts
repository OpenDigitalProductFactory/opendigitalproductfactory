import { describe, expect, it } from "vitest";
import { boundedBacklogRecoveryRead, isRecoveryReadGate } from "./backlog-recovery-read";
import { resolveInitiativeReviewerRecovery } from "@/lib/tak/initiative-readiness-tool-grants";
import { readinessRequirement } from "@/lib/backlog/initiative-readiness/readiness-guidance";
import type { InitiativeReadinessDecision } from "@/lib/backlog/initiative-readiness/types";

const packet = { gate: "plan-review", requestCoworker: { requestKey: "unchanged", objective: "Read the immutable plan" } };
const recovery = { reviewerRoutes: [packet], escalations: [], unroutable: [] };
const args = { itemId: "BI-BOUND", status: "open", workShape: "delivery-large@1.0.0", gate: "plan-review", recovery };

describe("bounded existing backlog recovery projection", () => {
  it("delivers an intact request from the real six-lane issuer within the caller budget", async () => {
    const decision: InitiativeReadinessDecision = {
      decisionId: "IRD-SIX", policyVersion: "initiative-readiness.v3", subject: { kind: "backlog-item", id: "BI-BOUND" },
      transitionObject: { kind: "work-capsule", id: "WC-BOUND", targetState: "implementation", expectedVersion: "claim.v1" },
      profile: "feature", target: "implementation", verdict: "input-required", satisfied: [], blockers: [],
      shapeDecision: { declared: "large", effective: "large", sensitivity: "low", raised: false, trigger: null },
      unmet: [
        readinessRequirement({ code: "CANONICAL_DESIGN_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
        readinessRequirement({ code: "SPEC_APPROVAL_REQUIRED", state: "missing", accountableRole: "design-checklist-reviewer" }),
        ...["architecture-reviewer", "data-reviewer", "ux-reviewer", "security-reviewer"].map(accountableRole =>
          readinessRequirement({ code: "REVIEW_REQUIRED", state: "missing", accountableRole })),
      ], evaluatedAt: "2026-10-16T00:00:00Z",
    };
    const issue = () => resolveInitiativeReviewerRecovery({ decision, currentAgentId: "AGT-AUTHOR", expectedCurrentBaselineId: null,
      dispatchContext: { workroomId: "WC-BOUND", repositoryFullName: "org/repo", branchName: "fix/bounded", headSha: "a".repeat(40) },
      canonicalArtifact: { resolved: true, path: "docs/superpowers/specs/bounded.md", providerBlobId: "b".repeat(40) },
      db: { agentToolGrant: { findMany: async () => ["initiative_design_review", "initiative_architecture_review", "initiative_data_review", "initiative_ux_review", "initiative_security_review", "file_read"].map(grantKey => ({
        grantKey, agent: { agentId: "AGT-REVIEW", displayName: "Independent reviewer", status: "active", archived: false, lifecycleStage: "production" },
      })) } },
    });
    const issued = await issue();
    expect(issued.reviewerRoutes).toHaveLength(6);
    expect(JSON.stringify(issued).length).toBeGreaterThan(8_000);
    const first = boundedBacklogRecoveryRead({ ...args, gate: "design-spec", recovery: issued });
    expect(first.success).toBe(true);
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(8_000);
    const delivered = (first.data?.recovery as typeof issued).reviewerRoutes;
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toBe(issued.reviewerRoutes.find(route => route.gate === "design-spec"));
    const again = boundedBacklogRecoveryRead({ ...args, gate: "design-spec", recovery: await issue() });
    expect(again).toEqual(first);
  });

  it("returns the original packet without reformatting or mutating it", () => {
    const result = boundedBacklogRecoveryRead(args);
    expect(result).toMatchObject({ success: true, data: { availableGates: ["plan-review"], recovery } });
    expect((result.data?.recovery as typeof recovery).reviewerRoutes[0]).toBe(packet);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000);
  });

  it("refuses an oversized single packet without delivering a partial request", () => {
    const result = boundedBacklogRecoveryRead({ ...args, recovery: {
      ...recovery, reviewerRoutes: [{ ...packet, requestCoworker: { ...packet.requestCoworker, objective: "x".repeat(20_000) } }],
    } });
    expect(result).toMatchObject({ success: false, error: "recovery_packet_over_budget", data: { limitChars: 8_000 } });
    expect(result.data).not.toHaveProperty("recovery");
    expect(result.data?.requestDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(8_000);
  });

  it("does not silently pick one of two packets for the same gate", () => {
    const result = boundedBacklogRecoveryRead({ ...args, recovery: { ...recovery, reviewerRoutes: [packet, packet] } });
    expect(result).toMatchObject({ success: false, error: "recovery_gate_ambiguous" });
    expect(result.data).not.toHaveProperty("recovery");
  });

  it("reports a missing gate without substituting a different packet", () => {
    const result = boundedBacklogRecoveryRead({ ...args, gate: "spec-approval" });
    expect(result).toMatchObject({ success: false, error: "recovery_gate_unavailable", data: { availableGates: ["plan-review"] } });
    expect(result.data).not.toHaveProperty("recovery");
  });

  it("retains the canonical author research escalation and never creates a research reviewer", () => {
    const research = { reviewerRoutes: [], unroutable: [], escalations: [{
      toolName: "record_initiative_evidence", reason: "research-evidence-required", accountableRole: "design-author",
    }] };
    expect(boundedBacklogRecoveryRead({ ...args, gate: "research", recovery: research }))
      .toMatchObject({ success: true, data: { recovery: research } });
  });

  it("rejects unknown gate values using the canonical gate registry", () => {
    expect(isRecoveryReadGate("plan-review")).toBe(true);
    expect(isRecoveryReadGate("objective-mapping")).toBe(true);
    expect(isRecoveryReadGate("research")).toBe(true);
    expect(isRecoveryReadGate("new-private-writer")).toBe(false);
    expect(isRecoveryReadGate({})).toBe(false);
  });
});

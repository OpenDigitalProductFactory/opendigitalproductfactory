import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentCardSupervisorPanel } from "./AgentCardSupervisorPanel";
import type { InternalAgentCard } from "@/lib/tak/agent-card-types";

const baseCard: InternalAgentCard = {
  schemaVersion: "dpf.agent-card.v1",
  agentId: "build-specialist",
  name: "Build Specialist",
  description: "Implements governed Build Studio changes.",
  status: "active",
  lifecycleStage: "production",
  interfaces: ["mcp", "a2a-internal", "task-run", "supervisor-control"],
  skills: [
    {
      label: "build-phase-implementation",
      taskType: "code_generation",
      capability: "build_promote",
    },
  ],
  capabilities: ["build_promote"],
  toolGrants: ["sandbox_execute", "backlog_write"],
  exposedTools: ["launch_sandbox", "record_execution_evidence", "run_sandbox_tests"],
  securitySchemes: [
    {
      id: "dpf-capability",
      type: "dpf-capability",
      description: "The acting user must have the platform capability.",
    },
  ],
  securityRequirements: ["user capability must allow the requested action"],
  extensions: {
    tak: {
      sensitivity: "internal",
      hitlTier: 2,
      hitlPolicy: "proposal_for_external_writes",
      autonomyLevel: "bounded",
      allowDelegation: true,
      maxDelegationRiskBand: "medium",
      operatingProfileFingerprint: "c".repeat(64),
      authority: {
        agentId: "build-specialist",
        routeContext: "/platform/audit/authority",
        actingPrincipalRef: "PRN-HUMAN-1",
        actingPrincipalGaid: null,
        agentGaid: "gaid:priv:dpf.internal:build-specialist",
        aidocValidationState: "validated",
        operatingProfileFingerprint: "c".repeat(64),
        hitlTier: 2,
        hitlPolicy: "proposal_for_external_writes",
        sensitivity: "internal",
        toolGrantCount: 2,
        exposedToolCount: 3,
        authorizationClasses: ["observe", "execute"],
        requiresApprovalForSideEffects: true,
        limitations: ["side-effecting actions require proposal or review before execution"],
        supervisorDecisionState: {
          pendingProposalCount: 2,
          latestPendingProposal: {
            approvalId: "prop-row-2",
            proposalId: "PROP-002",
            threadId: "thread-2",
            messageId: "msg-2",
            actionType: "register_digital_product_from_build",
            actionLabel: "Register digital product from build",
            actionSummary: "Proposed action register_digital_product_from_build.",
            actionDetails: [],
            proposedAt: "2026-05-20T15:00:00.000Z",
            decisionEndpoint: "/api/v1/governance/approvals/prop-row-2",
          },
          recentReceiptCount: 3,
          latestReceipt: {
            receiptId: "receipt-2",
            toolExecutionId: "tool-exec-2",
            toolName: "run_sandbox_tests",
            receiptKind: "sandbox-test-run",
            receiptStatus: "valid",
            executionStatus: "succeeded",
            expiresAt: "2026-06-20T16:00:01.000Z",
            createdAt: "2026-05-20T16:00:01.000Z",
            journalHref: "/platform/audit/journal?executionId=tool-exec-2&receiptId=receipt-2",
          },
        },
      },
    },
    gaid: {
      gaid: "gaid:priv:dpf.internal:build-specialist",
      aidocRef: "gaid:priv:dpf.internal:build-specialist",
      authorizationClasses: ["observe", "execute"],
      validationState: "validated",
    },
  },
};

describe("AgentCardSupervisorPanel", () => {
  it("renders TAK, GAID, exposed tools, and approval posture for supervisors", () => {
    const html = renderToStaticMarkup(<AgentCardSupervisorPanel cards={[baseCard]} />);

    expect(html).toContain("Supervisor Agent Cards");
    expect(html).toContain("Build Specialist");
    expect(html).toContain("gaid:priv:dpf.internal:build-specialist");
    expect(html).toContain("validated");
    expect(html).toContain("Reviewed");
    expect(html).toContain("3 exposed tools");
    expect(html).toContain("Pending proposals");
    expect(html).toContain("PROP-002");
    expect(html).toContain("Register digital product from build");
    expect(html).toContain("Approval workflow");
    expect(html).toContain("/api/v1/governance/approvals/prop-row-2");
    expect(html).toContain("Latest receipt");
    expect(html).toContain("run_sandbox_tests");
    expect(html).toContain("sandbox-test-run");
    expect(html).toContain("Open receipt in Capability Journal");
    expect(html).toContain("/platform/audit/journal?executionId=tool-exec-2&amp;receiptId=receipt-2");
    expect(html).toContain("succeeded");
    expect(html).toContain("proposal/review");
    expect(html).toContain("mcp");
    expect(html).toContain("run_sandbox_tests");
    expect(html).toContain("side-effecting actions require proposal or review before execution");
    expect(html).toContain("border-[var(--dpf-border)]");
  });

  it("shows an explicit empty state when no Agent Cards are projected", () => {
    const html = renderToStaticMarkup(<AgentCardSupervisorPanel cards={[]} />);

    expect(html).toContain("No internal Agent Cards are projected yet.");
  });

  it("collapses additional cards so large agent fleets stay scannable", () => {
    const cards = Array.from({ length: 8 }, (_, index) => ({
      ...baseCard,
      agentId: `agent-${index + 1}`,
      name: `Agent ${index + 1}`,
      extensions: {
        ...baseCard.extensions,
        tak: {
          ...baseCard.extensions.tak,
          authority: {
            ...baseCard.extensions.tak.authority,
            agentId: `agent-${index + 1}`,
          },
        },
      },
    }));

    const html = renderToStaticMarkup(<AgentCardSupervisorPanel cards={cards} />);

    expect(html).toContain("<details");
    expect(html).toContain("Additional projected cards");
    expect(html).toContain("2 more cards");
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  coworkerEnvelopeToAttentionItem,
  loadCoworkerEnvelopeItems,
  type CoworkerEnvelopeRow,
} from "./coworker-envelope";
import { classifyOwnerAttentionLane } from "../owner-routing";
import { buildOwnerAttentionProjection } from "../owner-projection";
import { portfolioOf } from "../outside-in";
import { agentProposalToAttentionItem } from "./agent-proposal";

// The live reproduction recorded on WC-635FCF78: a governed reviewer proposed a
// commit-bound `record_initiative_evidence` call and parked the TaskRun on
// `input-required` waiting for the delegating employee. The fixture mirrors that
// row exactly, so the projection is proven against a real shape.
const NOW = Date.parse("2026-08-25T20:00:00.000Z");
const OWNER = "cmt6ejt2109n56mnw5kt1f8y0";
const OTHER_OWNER = "cmt6ejt2109n56mnw5kt1f8y1";

const reviewBinding = {
  gate: "research",
  itemId: "BI-MCP-EFF-0285909C",
  writerToolName: "record_initiative_evidence",
  artifactRef: {
    kind: "repo-blob-at-commit",
    path: "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
    commitSha: "89e875eb49be0604ee8fa4156d0903b6a0932e62",
    providerBlobId: "bddca7c5a0b109f9460f84b2b0d886f5d794cbb6",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  },
};

function envelope(over: Partial<CoworkerEnvelopeRow> = {}): CoworkerEnvelopeRow {
  return {
    id: "cmt932fn301el01p7vfb2gas7",
    coworkerAgentId: "AGT-WS-PORTFOLIO",
    delegatingUserId: OWNER,
    manifestActionId: "record_initiative_evidence",
    rationale: "This action is authorized to proceed only after employee approval.",
    status: "proposed",
    taskRunId: "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7A98D78A3948",
    // clock-bomb-guard: allow coworkerEnvelopeToAttentionItem takes nowMs explicitly and never reads the wall clock
    expiresAt: new Date("2026-08-25T20:09:05.868Z"),
    createdAt: new Date("2026-08-25T19:54:05.871Z"),
    proposedParameters: { decision: "pass" },
    taskRun: { a2aMetadata: { trigger: "external-mcp", initiativeReviewBinding: reviewBinding } },
    ...over,
  };
}

describe("coworkerEnvelopeToAttentionItem", () => {
  it("projects a proposed envelope with the exact record the owner must inspect", () => {
    const item = coworkerEnvelopeToAttentionItem(envelope(), NOW);

    expect(item.id).toBe("coworker-envelope:cmt932fn301el01p7vfb2gas7");
    expect(item.source).toBe("coworker-envelope");
    expect(item.context).toBe(
      "This action is authorized to proceed only after employee approval.",
    );
    expect(item.triage.residueReason).toBe("policy-approval");
    expect(item.triage.deadlineIso).toBe("2026-08-25T20:09:05.868Z");
    // The workforce portfolio: a coworker is blocked, not a customer.
    expect(portfolioOf(item)).toBe("for-employees");

    const approval = item.envelope;
    expect(approval).toBeDefined();
    expect(approval?.envelopeId).toBe("cmt932fn301el01p7vfb2gas7");
    expect(approval?.coworkerAgentId).toBe("AGT-WS-PORTFOLIO");
    expect(approval?.delegatingUserId).toBe(OWNER);
    expect(approval?.manifestActionId).toBe("record_initiative_evidence");
    expect(approval?.rationale).toBe(
      "This action is authorized to proceed only after employee approval.",
    );
    expect(approval?.status).toBe("proposed");
    expect(approval?.taskRunId).toBe(
      "TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-7A98D78A3948",
    );
    expect(approval?.expiresAtIso).toBe("2026-08-25T20:09:05.868Z");
    expect(approval?.actionable).toBe(true);
    expect(approval?.decision.kind).toBe("known");
    expect(approval?.decision.recommendation).toBe("research passes with no findings");
    expect(approval?.decision.authorization).toBe(
      "record that receipt so implementation planning may continue",
    );
  });

  it("carries the immutable review binding: subject, gate, commit, path and blob", () => {
    const approval = coworkerEnvelopeToAttentionItem(envelope(), NOW).envelope;

    expect(approval?.reviewBinding).toEqual({
      gate: "research",
      itemId: "BI-MCP-EFF-0285909C",
      repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
      commitSha: "89e875eb49be0604ee8fa4156d0903b6a0932e62",
      path: "docs/superpowers/specs/2026-08-15-resilient-concurrent-development-process.md",
      providerBlobId: "bddca7c5a0b109f9460f84b2b0d886f5d794cbb6",
    });
  });

  it("omits the review binding when the task carries none", () => {
    const approval = coworkerEnvelopeToAttentionItem(
      envelope({ taskRunId: null, taskRun: null }),
      NOW,
    ).envelope;

    expect(approval?.reviewBinding).toBeUndefined();
    expect(approval?.taskRunId).toBeNull();
    expect(approval?.actionable).toBe(true);
  });

  it("routes the decision at the authenticated envelope state-machine endpoints", () => {
    const approval = coworkerEnvelopeToAttentionItem(envelope(), NOW).envelope;

    expect(approval?.approveHref).toBe(
      "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/approve",
    );
    expect(approval?.declineHref).toBe(
      "/api/agent/envelope/cmt932fn301el01p7vfb2gas7/deny",
    );
    // Never the AgentActionProposal governance surface.
    expect(approval?.approveHref).not.toMatch(/proposal/i);
    expect(approval?.declineHref).not.toMatch(/proposal/i);
  });

  it("offers no link action, so no owner button can navigate away from the decision", () => {
    const item = coworkerEnvelopeToAttentionItem(envelope(), NOW);

    expect(item.actions.length).toBeGreaterThan(0);
    expect(item.actions.every((action) => action.href === undefined)).toBe(true);
  });

  it("hard-floors the card into needs-you-now even in assertive mode", () => {
    const item = coworkerEnvelopeToAttentionItem(envelope(), NOW);
    const lane = classifyOwnerAttentionLane(item, "assertive");

    expect(lane.lane).toBe("needs-you-now");
    expect(lane.hardFloor).toBe(true);

    const projection = buildOwnerAttentionProjection([item], {
      fallbackLevel: "assertive",
      nowMs: NOW,
    });
    expect(projection.count).toBe(1);
    expect(projection.needsYouNow[0]?.item.source).toBe("coworker-envelope");
  });

  it("keeps the owner headline plain and free of bare technical acronyms", () => {
    const projection = buildOwnerAttentionProjection(
      [coworkerEnvelopeToAttentionItem(envelope(), NOW)],
      { nowMs: NOW },
    );
    const card = projection.needsYouNow[0]!.card;

    expect(card.headline).toBe("Authorize this research receipt?");
    expect(card.headline.split(/\s+/).length).toBeLessThanOrEqual(8);
    expect(card.recommendation.text).toBe("research passes with no findings");
    expect(card.situation).toMatch(/BI-MCP-EFF-0285909C/);
    expect(
      [
        card.headline,
        card.whyItMatters,
        card.ifYouDoNothing,
        card.recommendation.text,
        card.recommendation.specialistByline,
        ...card.choices.map((choice) => choice.label),
      ].join(" "),
    ).not.toMatch(/\b(?:AI|API|DB|GPU|CI|CD)\b/);
  });

  // Expiry and resolved states.

  it("marks an expired proposal non-actionable and past due", () => {
    const item = coworkerEnvelopeToAttentionItem(
      envelope(),
      Date.parse("2026-08-25T20:30:00.000Z"),
    );

    expect(item.envelope?.actionable).toBe(false);
    expect(item.triage.timeToAct).toBe("overdue");
  });

  it.each(["approved", "declined", "executed", "failed", "cancelled"] as const)(
    "marks a %s envelope non-actionable",
    (status) => {
      const item = coworkerEnvelopeToAttentionItem(
        // clock-bomb-guard: allow compared against the pinned NOW constant, not the wall clock
        envelope({ status, expiresAt: new Date("2026-08-26T00:00:00.000Z") }),
        NOW,
      );

      expect(item.envelope?.status).toBe(status);
      expect(item.envelope?.actionable).toBe(false);
    },
  );

  it("refuses to treat an unrecognised status as actionable", () => {
    const item = coworkerEnvelopeToAttentionItem(envelope({ status: "gibberish" }), NOW);

    expect(item.envelope?.actionable).toBe(false);
    expect(item.envelope?.status).toBe("gibberish");
  });

  // An envelope is not an AgentActionProposal.

  it("cannot be confused with an agent action proposal item", () => {
    const env = coworkerEnvelopeToAttentionItem(envelope(), NOW);
    const proposal = agentProposalToAttentionItem({
      proposalId: "AAP-1",
      actionType: "send_email",
      parameters: {},
      proposedAt: new Date("2026-08-25T19:54:05.871Z"),
      agentId: "AGT-WS-PORTFOLIO",
    });

    expect(env.source).not.toBe(proposal.source);
    expect(env.id).not.toBe(proposal.id);
    expect(env.id.startsWith("coworker-envelope:")).toBe(true);
    expect(proposal.id.startsWith("agent-proposal:")).toBe(true);
    // The proposal read-model carries no envelope payload, so no surface can
    // hand a proposal id to the envelope state machine.
    expect(proposal.envelope).toBeUndefined();
    expect(env.envelope).toBeDefined();
  });
});

// Owner projection and delegating-user isolation.

function stubDb(
  rows: CoworkerEnvelopeRow[],
  executions: Array<{
    taskRunId: string | null;
    toolName: string;
    parameters: unknown;
    result: unknown;
  }> = [],
) {
  const findMany = vi.fn(async (args: { where: { delegatingUserId: string } }) =>
    rows.filter((row) => row.delegatingUserId === args.where.delegatingUserId),
  );
  const findExecutions = vi.fn(async () => executions);
  return {
    db: {
      coworkerActionEnvelope: { findMany },
      toolExecution: { findMany: findExecutions },
    } as never,
    findMany,
    findExecutions,
  };
}

describe("loadCoworkerEnvelopeItems", () => {
  it("projects the authenticated delegating user's proposed envelopes", async () => {
    const { db, findMany } = stubDb([envelope()]);

    const items = await loadCoworkerEnvelopeItems(db, OWNER, NOW);

    expect(items).toHaveLength(1);
    expect(items[0]?.envelope?.envelopeId).toBe("cmt932fn301el01p7vfb2gas7");
    const where = findMany.mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where.delegatingUserId).toBe(OWNER);
    // Only live proposals reach the inbox: resolved and expired envelopes are
    // filtered in the query, so no actionable control can be rendered for one.
    expect(where.status).toBe("proposed");
    expect(where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: new Date(NOW) } },
    ]);
  });

  it("never returns another user's envelope", async () => {
    const { db, findMany } = stubDb([envelope()]);

    const items = await loadCoworkerEnvelopeItems(db, OTHER_OWNER, NOW);

    expect(items).toEqual([]);
    expect(
      (findMany.mock.calls[0]![0]!.where as Record<string, unknown>).delegatingUserId,
    ).toBe(OTHER_OWNER);
  });

  it("returns nothing and never queries when there is no authenticated user", async () => {
    const { db, findMany } = stubDb([envelope()]);

    expect(await loadCoworkerEnvelopeItems(db, undefined, NOW)).toEqual([]);
    expect(await loadCoworkerEnvelopeItems(db, "", NOW)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("joins the pending ToolExecution parameters onto the owner decision", async () => {
    const row = envelope({ proposedParameters: undefined });
    const { db } = stubDb([row], [
      {
        taskRunId: row.taskRunId,
        toolName: row.manifestActionId,
        parameters: { decision: "fail", findings: [{ issue: "Not reproduced.", severity: "important" }] },
        result: { data: { envelopeId: row.id } },
      },
    ]);

    const items = await loadCoworkerEnvelopeItems(db, OWNER, NOW);

    expect(items[0]?.envelope?.decision.recommendation).toBe(
      "research does not pass with 1 finding",
    );
    expect(items[0]?.envelope?.decision.findings).toEqual([
      { issue: "Not reproduced.", severity: "important" },
    ]);
  });
});

// Production wiring for the concierge sweep (BI-C62127B9, EP-0AF96937).
//
// The sweep's logic, its caps and its reporting live in concierge-sweep.ts and
// are tested without a database. This module is the boring half: it reads the
// candidates, binds the conductor to the real panel, retires stale drafts, and
// records the pass in the standing governance room.
//
// The room is upserted on a stable key rather than created per pass — this is
// the standing-room pattern (BI-A2234157): one room for an ongoing activity,
// convened once, never closed, with each pass appended as activity.

import { prisma, Prisma } from "@dpf/db";

import {
  runConciergeSweep,
  type SweepLimits,
  type SweepSummary,
} from "./concierge-sweep";
import {
  UNRESOLVED_OUTCOMES,
  excludedFromOwnerRulingQueue,
} from "@/lib/decision-perspective/owner-ruling-queue";
import { conductTriage, type TriageSubject } from "./triage-conductor";
import { runGovernanceTriagePanel } from "./triage-panel-binding";
import type { ProposalClient } from "./resolution-proposal-store";

/** Stable identity of the standing governance room. */
export const GOVERNANCE_ROOM_KEY = "decision-concierge-standing-room";

/** How many candidates the sweep will even look at in one pass. */
const CANDIDATE_SCAN_LIMIT = 50;

/**
 * The subset of the open queue the sweep will spend a panel on.
 *
 * "Still waiting on a human" has exactly one definition, and it is
 * `owner-ruling-queue.ts` (BI-EB5E9BE3) — this composes on its exports rather
 * than restating them, because three copies of that predicate drifted once
 * already and the failure is silent: the queue says four, the sweep works six,
 * the inbox shows two, and nothing reconciles them.
 *
 * The two clauses added here are the sweep's own scoping, not a second
 * definition of open: panels cost inference, so only material risk earns one,
 * and a decision already carrying a live draft is not re-drafted.
 *
 * Unlike the owner inbox this is not narrowed to an organization profile — the
 * sweep drafts for every profile on the install, and the ruling surface applies
 * the ownership boundary when it shows the result.
 */
function panelCandidateWhere(): Prisma.DecisionInteractionWhereInput {
  return {
    outcomeType: { in: [...UNRESOLVED_OUTCOMES] },
    humanOutcome: { equals: Prisma.DbNull },
    question: { not: "" },
    NOT: excludedFromOwnerRulingQueue(),
    riskTier: { in: ["medium", "high", "critical"] },
    resolutionProposals: { none: { status: "proposed", lifecycle: "active" } },
  };
}

async function loadCandidates(): Promise<TriageSubject[]> {
  const rows = await prisma.decisionInteraction.findMany({
    where: panelCandidateWhere(),
    orderBy: { createdAt: "desc" },
    take: CANDIDATE_SCAN_LIMIT,
    select: {
      id: true,
      interactionId: true,
      profileId: true,
      question: true,
      domainClass: true,
      gateKey: true,
      riskTier: true,
      outcomeType: true,
      options: true,
    },
  });

  return rows.map((row) => ({
    interactionRowId: row.id,
    interactionId: row.interactionId,
    profileId: row.profileId,
    question: row.question,
    domainClass: row.domainClass,
    gateKey: row.gateKey,
    riskTier: row.riskTier,
    outcomeType: row.outcomeType,
    // The predicate already excludes answered rows; re-asserting it here would
    // be a second definition of "resolved" and is exactly the drift
    // owner-ruling-queue.ts exists to prevent.
    resolved: false,
  }));
}

function optionIdsOf(options: unknown): string[] {
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : [];
}

/** Retire drafts whose decision was settled some other way since the last pass. */
async function retireStaleProposals(): Promise<number> {
  const settled = await prisma.decisionInteraction.findMany({
    where: {
      humanOutcome: { not: Prisma.DbNull },
      resolutionProposals: { some: { status: "proposed", lifecycle: "active" } },
    },
    select: { id: true },
    take: 200,
  });
  if (settled.length === 0) return 0;
  const { count } = await prisma.decisionResolutionProposal.updateMany({
    where: {
      interactionId: { in: settled.map((s) => s.id) },
      status: "proposed",
      lifecycle: "active",
    },
    data: {
      lifecycle: "retired",
      lifecycleAt: new Date(),
      lifecycleReason: "decision resolved elsewhere",
    },
  });
  return count;
}

/** Append the pass to the standing room, convening it the first time. */
async function recordPass(summary: SweepSummary): Promise<void> {
  const room = await prisma.workroom.upsert({
    where: { idempotencyKey: GOVERNANCE_ROOM_KEY },
    update: { lastSyncedAt: new Date() },
    create: {
      capsuleId: `WC-${GOVERNANCE_ROOM_KEY.slice(0, 8).toUpperCase()}`,
      idempotencyKey: GOVERNANCE_ROOM_KEY,
      title: "Decision governance",
      objective:
        "Keep decisions that need a person moving: draft what the owner should do, and say what could not be drafted.",
      status: "working",
      source: "scheduled-steward",
      activityKind: "governance",
      decisionScope: "wwmd",
      portfolioRole: "foundational",
      servedPersona: "Business owner ruling on what their AI could not decide alone",
    },
    select: { id: true },
  });

  await prisma.workroomActivity.create({
    data: {
      workCapsuleId: room.id,
      kind: "concierge-sweep",
      summary: summary.headline,
      payload: {
        considered: summary.considered,
        panelled: summary.panelled,
        proposed: summary.proposed,
        deferredToNextPass: summary.deferredToNextPass,
        unproductive: summary.unproductive,
        retiredStaleProposals: summary.retiredStaleProposals,
      },
    },
  });
}

/**
 * Run one pass. `userId` owns the panels' task runs — the sweep is a steward,
 * so the runs are attributed to the operator whose install it is.
 */
export async function runConciergeSweepJob(input: {
  userId: string;
  limits?: SweepLimits;
}): Promise<SweepSummary> {
  return runConciergeSweep(
    {
      candidates: loadCandidates,
      retireStale: retireStaleProposals,
      report: recordPass,
      conduct: async (subject) => {
        const row = await prisma.decisionInteraction.findUnique({
          where: { id: subject.interactionRowId },
          select: { options: true },
        });
        return conductTriage(
          {
            db: prisma as unknown as ProposalClient,
            roster: async () =>
              prisma.agent.findMany({
                where: { archived: false },
                select: { agentId: true, name: true, displayName: true },
              }),
            runPanel: ({ subject: s, plan, staffedAgentIds }) =>
              runGovernanceTriagePanel({
                subject: s,
                plan,
                staffedAgentIds,
                userId: input.userId,
                optionIds: optionIdsOf(row?.options),
              }),
          },
          subject,
        );
      },
    },
    input.limits,
  );
}

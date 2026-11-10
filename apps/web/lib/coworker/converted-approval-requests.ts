// Converted approval requests (BI-C8EC05C9, spec D8).
//
// A coworker action that needs a person used to be an AgentActionProposal. As
// the platform converges on CoworkerActionEnvelope, the readers that counted or
// listed proposals read both: legacy proposals, and the envelopes raised in
// their place. A converted envelope is the one whose park row carries the
// platform's approval-resume marker — a server-written fact, never a column a
// caller sets. Before PR-B nothing carries it, so every count and list is
// exactly what it was.
import { APPROVAL_RESUME_MARKER_KEY } from "./approval-resume-marker";

/** Prisma `where` fragment selecting envelopes raised in place of a proposal. */
export const CONVERTED_ENVELOPE_WHERE = {
  toolExecutions: { some: { parameters: { path: [APPROVAL_RESUME_MARKER_KEY, "v"], equals: 1 } } },
} as const;

type PendingCountDb = {
  agentActionProposal: { count(args: { where: { status: string } }): Promise<number> };
  coworkerActionEnvelope: { count(args: { where: Record<string, unknown> }): Promise<number> };
};

/** Requests waiting on a person: pending legacy proposals plus live converted envelopes. */
export async function countPendingApprovalRequests(db: PendingCountDb, now: Date = new Date()): Promise<number> {
  const [proposals, envelopes] = await Promise.all([
    db.agentActionProposal.count({ where: { status: "proposed" } }),
    db.coworkerActionEnvelope.count({ where: { status: "proposed", expiresAt: { gt: now }, ...CONVERTED_ENVELOPE_WHERE } }),
  ]);
  return proposals + envelopes;
}

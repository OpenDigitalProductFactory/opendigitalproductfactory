// The authenticated CoworkerActionEnvelope decision routes.
//
// One home for the two URLs so the owner-attention projection, the inbox
// approval card, and any future surface all point at the SAME state-machine
// endpoints (AGENTS.md §8). The routes wrap approveEnvelope / denyEnvelope in
// envelope-actions.ts, which enforce the delegating-user check and the
// legal-transition table before any write.
//
// This module is deliberately pure — no `server-only`, no Prisma — so a client
// component can import it without dragging the server graph into its bundle.
//
// An AgentActionProposal decision NEVER travels through here, and an envelope
// decision never travels through the proposal server actions (BI-7CB2CCDE).

/** POST target that records the delegating user's approval of an envelope. */
export function envelopeApproveRoute(envelopeId: string): string {
  return `/api/agent/envelope/${encodeURIComponent(envelopeId)}/approve`;
}

/** POST target that records the delegating user's refusal of an envelope. */
export function envelopeDeclineRoute(envelopeId: string): string {
  return `/api/agent/envelope/${encodeURIComponent(envelopeId)}/deny`;
}

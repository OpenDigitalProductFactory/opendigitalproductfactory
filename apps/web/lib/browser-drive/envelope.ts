// Destructive-action envelope for browser-driving (EP-BROWSER-DRIVE, spec §8.5).
//
// Irreversible, outward-facing browser actions (publish/submit/send/order/
// configure) require a CoworkerActionEnvelope before the final act. The human
// approves the rendered artifact + target, not a vague instruction. Drafting and
// read-only extraction do NOT require an envelope. Reuses the existing envelope
// substrate (Verdict 2) — no browser-specific approval path.

import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";

/** The outward, irreversible action classes that gate behind an envelope. */
export const DESTRUCTIVE_BROWSER_ACTIONS = [
  "publish",
  "submit",
  "send",
  "order",
  "configure",
] as const;
export type DestructiveBrowserAction = (typeof DESTRUCTIVE_BROWSER_ACTIONS)[number];

export function isDestructiveBrowserAction(action: string): action is DestructiveBrowserAction {
  return (DESTRUCTIVE_BROWSER_ACTIONS as readonly string[]).includes(action);
}

export type ProposeBrowserEnvelopeInput = {
  coworkerAgentId: string;
  delegatingUserId: string;
  threadId: string;
  action: DestructiveBrowserAction;
  /** What the human approves — the rendered post body / form payload, etc. */
  renderedArtifact: unknown;
  targetUrl: string;
  rationale: string;
};

/**
 * Propose a CoworkerActionEnvelope for an outward browser action. Status defaults
 * to "proposed"; the final act runs only after the human approves (approveEnvelope
 * in coworker/envelope-actions.ts), and is recorded with executionMode "proposal"
 * + the returned envelope id.
 */
export async function proposeBrowserActionEnvelope(input: ProposeBrowserEnvelopeInput) {
  return prisma.coworkerActionEnvelope.create({
    data: {
      coworkerAgentId: input.coworkerAgentId,
      delegatingUserId: input.delegatingUserId,
      threadId: input.threadId,
      manifestActionId: `browser.${input.action}`,
      argsJson: {
        action: input.action,
        targetUrl: input.targetUrl,
        renderedArtifact: input.renderedArtifact,
      } as Prisma.InputJsonValue,
      rationale: input.rationale,
    },
  });
}

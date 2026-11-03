// BI-AE416D75. The option a COWORKER proposed on a governed decision.
//
// `DecisionInteraction.recommendedOptionId` is the kernel's commandment argmax,
// and the gate only computes one on a recommend/arbitrate verdict. A decision a
// coworker brings to the gate — the architect's review verdict, a request to
// run a governed tool — is usually escalated or deferred, so that column is
// null on every one of them. The coworker still proposed something; the gate
// just had nowhere to put it, and the trust ledger counted all of them as "no
// recommendation".
//
// The proposal is recorded as its own fact (`outcomePayload.proposedOptionId`)
// so the kernel's pick keeps its meaning for kernel calibration. Pure: no IO.

import {
  TAK_ALIGNMENT_PROPOSED_OPTION_ID,
  TAK_ALIGNMENT_SCORED_OPTIONS,
} from "@/lib/tak/alignment-gate-options";

/** The key in `outcomePayload` that carries the coworker's proposal. */
export const PROPOSED_OPTION_PAYLOAD_KEY = "proposedOptionId" as const;

function scoredOptionIds(scoredOptions: unknown): string[] {
  if (!Array.isArray(scoredOptions)) return [];
  return scoredOptions
    .map((option) => (option && typeof option === "object" ? (option as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string");
}

/**
 * The proposal to record, or null. A proposal must name an option the gate was
 * offered (a scored option id, or a plain option): one outside the menu would
 * score the coworker against a choice nobody could make, so it is dropped
 * rather than recorded.
 */
export function normalizeProposedOptionId(
  proposed: string | null | undefined,
  menu: { options: readonly string[]; scoredOptions?: unknown },
): string | null {
  const id = proposed?.trim() ?? "";
  if (!id) return null;
  const offered = new Set([...menu.options, ...scoredOptionIds(menu.scoredOptions)]);
  return offered.has(id) ? id : null;
}

/** The stored decision columns a proposal can be read back from. */
export type ProposalSourceRow = {
  gateKey: unknown;
  options: unknown;
  scoredOptions: unknown;
  outcomePayload: unknown;
};

function isTakAlignmentMenu(scoredOptions: unknown): boolean {
  if (!Array.isArray(scoredOptions) || scoredOptions.length !== TAK_ALIGNMENT_SCORED_OPTIONS.length) return false;
  return TAK_ALIGNMENT_SCORED_OPTIONS.every((expected, index) => {
    const actual = scoredOptions[index] as { id?: unknown; description?: unknown; features?: unknown } | null;
    if (!actual || actual.id !== expected.id || actual.description !== expected.description) return false;
    const features = actual.features as Record<string, unknown> | null | undefined;
    if (!features || typeof features !== "object") return false;
    const keys = Object.keys(features);
    const expectedKeys = Object.keys(expected.features);
    return keys.length === expectedKeys.length
      && expectedKeys.every((key) => features[key] === expected.features[key]);
  });
}

/**
 * Read the coworker's proposal back from a stored decision, for the ledger
 * backfill. Two sources only, both recorded facts:
 *
 *   1. `outcomePayload.proposedOptionId`, written by the gate since BI-AE416D75.
 *   2. A WWWD row carrying the TAK alignment gate's exact fixed menu. That gate
 *      runs only when a coworker asks to execute a governed tool, so its
 *      proposal is "proceed" by construction, before and after this fix.
 *
 * Anything else returns null. The architect's review verdict before this fix
 * was never stored, so those decisions stay without a recommendation.
 */
export function readRecordedCoworkerProposal(row: ProposalSourceRow): string | null {
  const options = Array.isArray(row.options)
    ? row.options.filter((entry): entry is string => typeof entry === "string")
    : [];
  const payload = row.outcomePayload && typeof row.outcomePayload === "object"
    ? (row.outcomePayload as Record<string, unknown>)
    : {};
  const recorded = payload[PROPOSED_OPTION_PAYLOAD_KEY];
  if (typeof recorded === "string") {
    return normalizeProposedOptionId(recorded, { options, scoredOptions: row.scoredOptions });
  }
  if (row.gateKey === "org-business" && isTakAlignmentMenu(row.scoredOptions)) {
    return TAK_ALIGNMENT_PROPOSED_OPTION_ID;
  }
  return null;
}

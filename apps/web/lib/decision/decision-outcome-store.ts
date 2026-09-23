// BI-F302B80E slice 1, part 2 — the write side of "was the recommendation followed".
//
// The rules live in decision-outcome.ts and are pure. This module is the thin
// IO shell: load the row, ask the rules, write the two columns the seal
// deliberately leaves mutable.
//
// `chosenOptionId` and `humanOutcome` are the ONLY decision columns absent from
// SEALED_IMMUTABLE_FIELDS (decision-chain.ts). That is not an oversight — they
// are the append-after-the-fact half of the record, and everything the kernel
// committed to at decision time stays frozen. So this write is compatible with
// the trust envelope by construction, and a row sealed months ago can still
// receive its outcome.
//
// One consequence worth stating: `scoredOptions` IS sealed, so historical rows
// that never carried it can never be backfilled. The chosen option is therefore
// validated against `options` — the id list, which every kernel row has carried
// since the ledger existed — rather than against the richer scored set.

import { getErrorMessage } from "@/lib/shared/get-error-message";

import {
  buildRecordedResolution,
  planResolution,
  type DecisionResolver,
  type ResolutionOutcome,
  type ResolvableDecisionRow,
} from "./decision-outcome";

export type DecisionOutcomeDb = {
  decisionInteraction: {
    findUnique(args: {
      where: { interactionId: string };
      select: Record<string, boolean>;
    }): Promise<Record<string, unknown> | null>;
    update(args: {
      where: { interactionId: string };
      data: Record<string, unknown>;
    }): Promise<unknown>;
  };
};

export type RecordDecisionOutcomeInput = {
  db: DecisionOutcomeDb;
  interactionId: string;
  /** The option the actor went with, or null to record it as left unresolved. */
  chosenOptionId: string | null;
  resolvedBy: DecisionResolver;
  rationale: string;
  now?: Date;
};

export type RecordDecisionOutcomeResult =
  | { recorded: true; disposition: string; agreement: boolean | null; interactionId: string }
  | { recorded: false; reason: "not-found"; detail: string }
  | { recorded: false; reason: "write-failed"; detail: string }
  | (Extract<ResolutionOutcome, { accepted: false }> extends infer R
      ? R extends { reason: infer Reason; detail: string }
        ? { recorded: false; reason: Reason; detail: string }
        : never
      : never);

/** Exactly the columns the rules read. Selected explicitly so a schema change surfaces here. */
const ROW_SELECT = {
  interactionId: true,
  recommendedOptionId: true,
  chosenOptionId: true,
  humanOutcome: true,
  options: true,
  autonomous: true,
} as const;

function readOptionIds(value: unknown): string[] {
  // `options` is a Json column defaulting to `[]`. A malformed value yields an
  // empty menu, which makes every named option fail `option-not-offered` — the
  // safe direction: refuse rather than accept an unvalidatable choice.
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function recordDecisionOutcome(
  input: RecordDecisionOutcomeInput,
): Promise<RecordDecisionOutcomeResult> {
  const existing = await input.db.decisionInteraction.findUnique({
    where: { interactionId: input.interactionId },
    select: { ...ROW_SELECT },
  });

  if (!existing) {
    return {
      recorded: false,
      reason: "not-found",
      detail: `No decision found with interactionId ${JSON.stringify(input.interactionId)}.`,
    };
  }

  const row: ResolvableDecisionRow = {
    interactionId: String(existing.interactionId),
    recommendedOptionId:
      typeof existing.recommendedOptionId === "string" ? existing.recommendedOptionId : null,
    chosenOptionId: typeof existing.chosenOptionId === "string" ? existing.chosenOptionId : null,
    humanOutcome: existing.humanOutcome ?? null,
    options: readOptionIds(existing.options),
    autonomous: existing.autonomous === true,
  };

  const plan = planResolution(row, {
    chosenOptionId: input.chosenOptionId,
    resolvedBy: input.resolvedBy,
  });

  if (!plan.accepted) {
    return { recorded: false, reason: plan.reason, detail: plan.detail } as RecordDecisionOutcomeResult;
  }

  const resolution = buildRecordedResolution({
    plan,
    // Non-null by the no-recommendation refusal above.
    recommendedOptionId: row.recommendedOptionId as string,
    rationale: input.rationale,
    now: input.now ?? new Date(),
  });

  try {
    await input.db.decisionInteraction.update({
      where: { interactionId: row.interactionId },
      data: {
        chosenOptionId: plan.chosenOptionId,
        humanOutcome: resolution,
      },
    });
  } catch (error) {
    // Fail-closed on the REPORT, not on the caller's work: the actor has
    // already acted. Say the outcome was not recorded rather than implying it
    // was, so the row stays honestly unreported instead of silently wrong.
    return {
      recorded: false,
      reason: "write-failed",
      detail: getErrorMessage(error),
    };
  }

  return {
    recorded: true,
    disposition: plan.disposition,
    agreement: plan.agreement,
    interactionId: row.interactionId,
  };
}

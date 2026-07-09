// WSID feedback loop — completed consolidation bets enrich the profession
// corpus (BI-5C01F920, EP-8DC217EB BET-0f).
//
// Closes the self-optimization loop: when a consolidation bet completes, the
// technique it demonstrated is a learning the professions that worked it do
// not yet have in their WSID corpus. This records that as a deterministic,
// deduped growth signal (`ProfessionCorpusGap`, reason `bet-completed`) for
// each mapped profession — routed through the SAME governed corpus-growth
// surface operators already review (coworker-record ProfessionCorpusPanel),
// so no craft content is fabricated: the sweep only flags "capture BET-N's
// technique here, source = its spec + anchor files" and where to find it.
//
// Invoked by the self-optimization sweep (BET-0e) for bets that newly
// completed since the prior run. No LLM loop — the mining stays session-scale;
// this keeps the corpus honest between runs (plan §9).

import {
  recordProfessionCorpusGap,
  type ProfessionCorpusEvidenceClient,
} from "@/lib/decision-perspective/profession-corpus-evidence";
import { getConsolidationBet } from "./consolidation-bets";
import { professionsForBet } from "./bet-professions";

export type BetCompletionLearning = {
  betKey: string;
  professionKey: string;
  recorded: boolean;
  fingerprint: string;
};

export type BetCompletionFeedbackResult = {
  learnings: BetCompletionLearning[];
  recordedCount: number;
};

function learningQuery(betKey: string, title: string): string {
  return `Capture the technique from completed consolidation ${betKey}: ${title}`;
}

function learningSource(betKey: string, files: string[]): string {
  const anchors = files.slice(0, 6).join(", ");
  return anchors
    ? `${betKey} delivery: review the change (spec + anchor files ${anchors}) and distil the reusable technique into the corpus.`
    : `${betKey} delivery: review the change and distil the reusable technique into the corpus.`;
}

/**
 * Record a `bet-completed` corpus-growth signal for every profession mapped to
 * each newly-completed bet. Deduped by the underlying gap fingerprint
 * (profession × normalized topic × reason), so re-running the sweep coalesces
 * rather than piling up. Fail-open per record (never throws).
 */
export async function recordBetCompletionLearnings(
  newlyCompletedBetKeys: string[],
  deps: { db?: ProfessionCorpusEvidenceClient; routeContext?: string } = {},
): Promise<BetCompletionFeedbackResult> {
  const learnings: BetCompletionLearning[] = [];

  for (const betKey of newlyCompletedBetKeys) {
    const bet = getConsolidationBet(betKey);
    if (!bet) continue; // unknown bet key — nothing to attribute
    const professions = professionsForBet(betKey);
    if (professions.length === 0) continue;

    for (const professionKey of professions) {
      const result = await recordProfessionCorpusGap(
        {
          professionKey,
          reason: "bet-completed",
          query: learningQuery(betKey, bet.title),
          routeContext: deps.routeContext ?? "vertint.sweep",
          suggestedSource: learningSource(betKey, bet.selectors.files),
        },
        { db: deps.db },
      );
      learnings.push({
        betKey,
        professionKey,
        recorded: result.recorded,
        fingerprint: result.fingerprint,
      });
    }
  }

  return {
    learnings,
    recordedCount: learnings.filter((learning) => learning.recorded).length,
  };
}

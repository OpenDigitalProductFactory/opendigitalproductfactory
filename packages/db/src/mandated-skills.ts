// packages/db/src/mandated-skills.ts
// The skills the platform GUARANTEES every persona inherits, named once.
//
// BI-5E8E231E made these four carry `assignTo: ["*"]` so every roster persona
// gets the WWMD/WWWD decision stack. That mandate was asserted at seed time and,
// until BI-43920DD1, silently unenforceable at ranking time: they sat in the same
// relevance-ranked pool as everything else, so a turn whose vocabulary didn't
// happen to match them dropped the very skills the mandate exists to guarantee.
//
// Measured on the live install (2026-08-25, 1,175 real user turns replayed
// through the production ranker): 61.4% of turns dropped at least one of these
// four; `dpf-decision-via-kernel` alone was dropped on 57.3%.
//
// No dependencies on purpose — the skill ranker is a pure hot-path module and
// the seeder runs in Node, so the one list they share must import nothing.

/**
 * Skills reserved a slot before relevance ranking. A skill belongs here only
 * when the platform guarantees every persona inherits it; anything optional
 * competes for the remaining slots like everything else.
 */
export const MANDATED_DECISION_SKILL_IDS: readonly string[] = [
  "dpf-decision-via-kernel",
  "dpf-retrieve-decision-context",
  "dpf-compare-options",
  "dpf-record-decision-outcome",
];

export function isMandatedSkill(skillId: string): boolean {
  return MANDATED_DECISION_SKILL_IDS.includes(skillId);
}

// EP-27FD96BC · P3 (BI-2435BD7F) — relevance-ranked skill eligibility.
//
// Every active+enabled skill assigned to a coworker injects its one-line summary
// into the system prompt EVERY turn, regardless of the turn's topic. On a
// skill-heavy coworker that is a growing per-turn token tax the model mostly
// pays to ignore. This ranks the eligible skills by relevance to the turn and,
// only when the set is large, keeps the top-N — bounding the tax without hiding
// capability on the typical small-set coworker.
//
// Kernel decision (principle_decide 2026-07-11): THRESHOLD-CAP (keep all when the
// set is small; top-N by relevance only when it exceeds the cap) over reorder-only
// (doesn't cut the tax) or hard-cap (hides skills even from light agents) —
// composite 8.21 vs 6.73 / 6.22, high confidence.
//
// Pure — no I/O, cheap token overlap (no embedding call on the hot path).

export interface RankableSkill {
  skillId: string;
  label: string;
  description: string;
  category: string;
  tags: string[];
  /** Optional trigger regex; a match is a strong relevance signal. */
  triggerPattern?: string | null;
}

/** Default cap — below this many eligible skills nothing is dropped. */
export const DEFAULT_SKILL_SUMMARY_CAP = 12;

// A trigger-pattern match outweighs several incidental keyword hits.
const TRIGGER_MATCH_BONUS = 4;

const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "you", "your", "with", "this", "that", "have", "has",
  "can", "will", "would", "please", "how", "what", "when", "why", "who", "let",
  "get", "got", "are", "was", "were", "into", "from", "about", "need", "want",
]);

/** Lowercase, split on non-alphanumeric, drop short tokens and stopwords. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Relevance of a skill to the turn: how many distinct query tokens appear in the
 * skill's searchable text (label + description + category + tags + id), plus a
 * bonus if the skill's trigger regex matches the raw query. Pure.
 */
export function scoreSkillRelevance(
  skill: RankableSkill,
  queryTokens: ReadonlySet<string>,
  rawQuery: string,
): number {
  const haystack = new Set(
    tokenize([skill.label, skill.description, skill.category, skill.skillId, ...skill.tags].join(" ")),
  );
  let score = 0;
  for (const t of queryTokens) if (haystack.has(t)) score += 1;
  if (skill.triggerPattern) {
    try {
      if (new RegExp(skill.triggerPattern, "i").test(rawQuery)) score += TRIGGER_MATCH_BONUS;
    } catch {
      // Ignore an invalid stored trigger pattern.
    }
  }
  return score;
}

/**
 * Rank the eligible skills for a turn. When the set is at or below `cap`, it is
 * returned unchanged (byte-for-byte today's behavior — the regression guard). When
 * larger, only the top-`cap` by relevance are kept, most-relevant first; ties keep
 * the caller's original order (priority-desc), so a wholly-irrelevant turn still
 * yields a stable priority-ordered top-`cap`.
 */
export function rankSkillsByRelevance<T extends RankableSkill>(
  skills: T[],
  query: string,
  cap: number = DEFAULT_SKILL_SUMMARY_CAP,
): T[] {
  if (skills.length <= cap) return skills;
  const queryTokens = new Set(tokenize(query));
  return skills
    .map((skill, index) => ({ skill, index, score: scoreSkillRelevance(skill, queryTokens, query) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, cap)
    .map((entry) => entry.skill);
}

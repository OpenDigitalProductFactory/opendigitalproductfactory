import { z } from "zod";

// ============================================================================
// Readability — the Flesch–Kincaid tests Microsoft Word reports, plus the
// platform's tiered reading-level policy. Pure + shared so the web app (copy
// editor, coworker policy) and any future surface use one implementation.
//
// Policy doc: docs/platform-usability-standards.md → Readability & Plain Language
// Reference implementation that proved the metric: docs/business-types/_readability.mjs
// ============================================================================

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Strip HTML/markup to scoreable prose. Em/en dashes become spaces so a long,
 *  dash-joined sentence still counts as long. */
export function toProse(s: string): string {
  return String(s)
    // Strip HTML tags. The inner class excludes `<` (not just `>`) so the match
    // can't re-scan across many leading `<` — keeps this linear (no polynomial
    // ReDoS on input like "<<<<<<…"). Well-formed tags contain no inner `<`.
    .replace(/<[^<>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/[—–]/g, " ")
    .replace(/[`*_>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Heuristic syllable count (the standard vowel-group method). */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export interface ReadabilityScore {
  words: number;
  sentences: number;
  syllables: number;
  wordsPerSentence: number;
  syllablesPerWord: number;
  /** Flesch Reading Ease (0–100, higher is easier). */
  readingEase: number;
  /** Flesch–Kincaid Grade Level (≈ U.S. school grade). */
  gradeLevel: number;
}

/** Sentences a run of PROSE contains, split on terminal punctuation. */
function proseSentences(text: string): string[] {
  return text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
}

/** The Flesch–Kincaid arithmetic, given text and a sentence count established
 *  by the caller. Both public analyzers differ only in how they count sentences. */
function score(text: string, sentenceCount: number): ReadabilityScore {
  const sentences = Math.max(sentenceCount, 1);
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const wordCount = Math.max(words.length, 1);
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const wps = wordCount / sentences;
  const spw = syllables / wordCount;
  return {
    words: wordCount,
    sentences,
    syllables,
    wordsPerSentence: round1(wps),
    syllablesPerWord: round2(spw),
    readingEase: round1(206.835 - 1.015 * wps - 84.6 * spw),
    gradeLevel: round1(0.39 * wps + 11.8 * spw - 15.59),
  };
}

/**
 * Flesch–Kincaid over PROSE — text whose sentence boundaries are full stops.
 * Correct for a paragraph, a marketing snippet, a doc body.
 *
 * DO NOT use this on a rendered UI surface. See `analyzeUtteranceReadability`.
 */
export function analyzeReadability(rawText: string): ReadabilityScore {
  const text = toProse(rawText);
  return score(text, proseSentences(text).length);
}

/**
 * Flesch–Kincaid over a UI SURFACE — BI-0ED0F6B3.
 *
 * THE DEFECT THIS EXISTS TO FIX. Flesch–Kincaid divides words by sentences, and
 * `analyzeReadability` finds sentences by looking for full stops. A user
 * interface has almost none: it is headings, table cells, button labels, nav
 * items and list items, and none of those are punctuated. Flatten such a page
 * into one string and every label in it collapses into a single enormous
 * "sentence", words-per-sentence explodes, and the grade climbs for text that
 * carries no complexity at all.
 *
 * Measured proof (packages/validators/src/readability.test.ts): the same fifteen
 * words, at the same 1.4 syllables per word, score grade 6.8 with no full stop at
 * all (one "sentence") and grade 1.5 with a stop after each label. Identical
 * vocabulary; the only variable is punctuation the UI had no reason to carry. At
 * the 21-word length the BI measured, the same swing is 8.7 -> 5.2. On a real
 * 200-word surface the mechanism produced grades in the teens, and that inflation
 * is what drove every /admin route over the high-school cap.
 *
 * THE CORRECTION. In a UI the SENTENCE BOUNDARY IS THE ELEMENT BOUNDARY. Each
 * utterance — one heading, one cell, one label — is at least one sentence, and
 * genuine prose inside an utterance still splits on its own full stops. Feed the
 * utterances in separately and words-per-sentence becomes what it should be: a
 * measure of how long the surface's actual phrases are.
 *
 * The result is dominated by syllables-per-word for a label-shaped surface, which
 * is the punctuation-independent signal that separates plain copy from jargon,
 * while still catching a genuinely long sentence in real body copy. It also
 * cannot be gamed by adding full stops — a stop inside an utterance only ever
 * splits a sentence that was already counted.
 */
export function analyzeUtteranceReadability(utterances: readonly string[]): ReadabilityScore {
  const texts = utterances.map((u) => toProse(u)).filter((t) => /[a-z0-9]/i.test(t));
  const sentences = texts.reduce((n, t) => n + Math.max(proseSentences(t).length, 1), 0);
  return score(texts.join(" "), sentences);
}

// ── Reading levels & the tiered policy ──────────────────────────────────────

export const READING_LEVELS = ["high-school", "college", "uncapped"] as const;
export type ReadingLevel = (typeof READING_LEVELS)[number];

/** Max Flesch–Kincaid grade for a level (null = no cap). */
export const READING_LEVEL_MAX_GRADE: Record<ReadingLevel, number | null> = {
  "high-school": 9,
  college: 13,
  uncapped: null,
};

export const READING_LEVEL_LABEL: Record<ReadingLevel, string> = {
  "high-school": "High school (plain)",
  college: "College",
  uncapped: "Highest (no cap)",
};

/**
 * The platform readability policy: a reading-level target per audience tier.
 * Default: marketing/external & business copy → high school; reseller/partner →
 * college; architecture/standards → uncapped (precision over simplicity).
 */
export const readabilityPolicySchema = z.object({
  marketing: z.enum(READING_LEVELS).default("high-school"),
  reseller: z.enum(READING_LEVELS).default("college"),
  architecture: z.enum(READING_LEVELS).default("uncapped"),
});
export type ReadabilityPolicy = z.infer<typeof readabilityPolicySchema>;
export type ReadabilityAudience = keyof ReadabilityPolicy;

export const DEFAULT_READABILITY_POLICY: ReadabilityPolicy = {
  marketing: "high-school",
  reseller: "college",
  architecture: "uncapped",
};

/** PlatformConfig key the operator-adjustable policy is stored under (no new
 *  table). Client-safe constant so the admin panel can reference it without
 *  importing the server-only policy module. */
export const READABILITY_POLICY_KEY = "content_readability_policy";

/** Parse a stored policy value (object / JSON string / unknown), defaulting on
 *  anything invalid so a missing or corrupt config never breaks a prompt. */
export function parseReadabilityPolicy(raw: unknown): ReadabilityPolicy {
  let candidate: unknown = raw;
  if (typeof raw === "string") {
    try {
      candidate = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_READABILITY_POLICY };
    }
  }
  const result = readabilityPolicySchema.safeParse(candidate);
  return result.success ? result.data : { ...DEFAULT_READABILITY_POLICY };
}

/** Resolve the reading level a coworker should target for an audience, honouring
 *  a per-archetype override (e.g. `marketingSkillRules.readingLevel`) when set. */
export function resolveReadingLevel(
  policy: ReadabilityPolicy,
  opts: { audience: ReadabilityAudience; archetypeOverride?: ReadingLevel | null },
): ReadingLevel {
  if (opts.audience === "marketing" && opts.archetypeOverride) {
    return opts.archetypeOverride;
  }
  return policy[opts.audience];
}

/** True when a Flesch–Kincaid grade is within the target level. */
export function withinReadingLevel(gradeLevel: number, level: ReadingLevel): boolean {
  const max = READING_LEVEL_MAX_GRADE[level];
  return max == null || gradeLevel <= max;
}

/** Coerce an unknown value to a ReadingLevel, or null if it isn't one. */
export function asReadingLevel(value: unknown): ReadingLevel | null {
  return typeof value === "string" && (READING_LEVELS as readonly string[]).includes(value)
    ? (value as ReadingLevel)
    : null;
}

/**
 * The prompt directive a coworker receives when it must write to a reading
 * level. Returns null for "uncapped" (no constraint → no directive).
 */
export function readingLevelDirective(level: ReadingLevel): string | null {
  if (level === "uncapped") return null;
  const grade = READING_LEVEL_MAX_GRADE[level];
  const audience =
    level === "high-school"
      ? "a high-school reading level (the basis for mass acceptance)"
      : "a college reading level";
  return [
    "READING LEVEL — CUSTOMER-FACING COPY.",
    `Any customer-facing copy you write (storefront sections, campaigns, notices, public messages) must read at ${audience} — Flesch–Kincaid grade ${grade} or below.`,
    "Use short sentences, active voice, and familiar words; avoid jargon and internal terms in customer-facing copy. Keep architecture and standards detail for technical audiences only.",
    "Check the reading level before you publish.",
  ].join(" ");
}

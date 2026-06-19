// ============================================================================
// Readability scoring — the Flesch–Kincaid tests Microsoft Word reports.
// Used by the page generator to keep BUSINESS-FACING copy (what a small-business
// owner reads) at a high-school reading level. Technical copy (the TAK/GAID
// standards section, the archetype-engine internals) is scored separately and
// is allowed to read higher.
//
//   Flesch Reading Ease   = 206.835 − 1.015·(words/sentence) − 84.6·(syll/word)
//   Flesch–Kincaid Grade  = 0.39·(words/sentence) + 11.8·(syll/word) − 15.59
//
// Grade ≈ U.S. school grade. High school = grades 9–12; for mass-market
// marketing we aim for grade ≤ 9 and Reading Ease ≥ 60 ("plain English").
// ============================================================================

// Strip HTML/markup and normalise to scoreable prose.
export function toProse(s) {
  return String(s)
    .replace(/<[^<>]+>/g, " ") // tags (inner class excludes `<` → linear, no ReDoS)
    .replace(/&[a-z]+;|&#\d+;/gi, " ") // entities
    .replace(/[—–]/g, " ") // em/en dash → space (keeps the long sentence long)
    .replace(/[`*_>#]/g, " ") // stray markdown
    .replace(/\s+/g, " ")
    .trim();
}

// Heuristic syllable count (the standard vowel-group method).
export function syllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  word = word.replace(/^y/, "");
  const groups = word.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function analyze(rawText) {
  const text = toProse(rawText);
  const sentenceParts = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
  const sentences = Math.max(sentenceParts.length, 1);
  const words = text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const wordCount = Math.max(words.length, 1);
  const syllableCount = words.reduce((n, w) => n + syllables(w), 0);

  const wps = wordCount / sentences;
  const spw = syllableCount / wordCount;
  const readingEase = 206.835 - 1.015 * wps - 84.6 * spw;
  const gradeLevel = 0.39 * wps + 11.8 * spw - 15.59;

  return {
    words: wordCount,
    sentences,
    syllables: syllableCount,
    wordsPerSentence: +wps.toFixed(1),
    syllablesPerWord: +spw.toFixed(2),
    readingEase: +readingEase.toFixed(1),
    gradeLevel: +gradeLevel.toFixed(1),
  };
}

// Plain-English band label for a Flesch–Kincaid grade level.
export function band(grade) {
  if (grade <= 6) return "very easy";
  if (grade <= 9) return "high-school (plain)";
  if (grade <= 12) return "high-school";
  return "college+";
}

// Audience tiers — the single source of truth for the platform readability
// policy (see docs/platform-usability-standards.md → Readability & Plain
// Language). Marketing/archetype copy is held to high school; reseller copy to
// college; architecture/standards copy is uncapped (precision over simplicity).
export const TIERS = {
  marketing: { label: "Marketing & external", maxGrade: 9 },
  archetype: { label: "Archetype / business pages", maxGrade: 9 },
  reseller: { label: "Reseller / partner", maxGrade: 13 },
  architecture: { label: "Architecture & standards", maxGrade: null },
};
export function withinTier(grade, tier) {
  const t = TIERS[tier];
  return !t || t.maxGrade == null || grade <= t.maxGrade;
}

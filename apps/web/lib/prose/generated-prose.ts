// apps/web/lib/prose/generated-prose.ts
//
// Observability-only slop gauge for prose the platform GENERATES.
//
// scripts/check-prose-lint.ts already ratchets prose quality — but only for UI
// copy a human typed into a .tsx file. It has no counterpart for the text a
// model produces at runtime: alert humanization, backlog item bodies, wiki
// overlay drafts, PR descriptions, coworker replies. Those are the strings
// customers read most often, and nothing measured them.
//
// WHY A CHECKER AND NOT A PROMPT RULE. The obvious alternative is to instruct
// the model to write better. That is the wrong mechanism for the local tier:
// packages/db/src/local-model-capabilities.ts puts Qwen at
// instructionFollowingScore 78 and Gemma at 65, so a style block is followed
// unreliably — and, worse, it is followed AT THE COST OF THE TASK, because
// contextRetention (55 and 45) is the weakest dimension in both priors and a
// long style section displaces task content on exactly the models that can
// least afford it. Measuring after the fact costs the model nothing and is
// deterministic.
//
// IMPORTANT: nothing here changes what is emitted. It scores and returns, in
// the same spirit as ./tak/context-pressure.ts — measure first so a regression
// is visible instead of silent, and only then decide what to enforce. The
// ratchet promotion is deliberately deferred (BI-41F15FD7 step 4) until a
// baseline exists.
//
// Pure module — no imports, no I/O — so it is unit-tested directly and is
// cheap enough to run on a response path.

/** Empty puffery. Says a thing was important without saying what happened. */
const PUFFERY = [
  "pivotal", "testament to", "evolving landscape", "setting the stage",
  "in today's", "ever-changing", "game-changer", "game changer",
  "seamless", "seamlessly", "robust", "cutting-edge", "state-of-the-art",
  "best-in-class", "world-class", "unlock the power", "harness the power",
  "delve into", "navigate the complexities", "it's worth noting",
  "at the end of the day", "significant improvement", "greatly enhances",
];

/**
 * The superficial `-ing` clause: a comma, then a participle that adds no fact.
 * "…, ensuring reliability" and "…, highlighting the need for" assert nothing
 * checkable — they are grammatical filler attached to a real sentence.
 *
 * Matched as a CLOSED list rather than any `-ing` word, because plenty of
 * participial clauses carry real content ("…, returning null when the row is
 * absent"). A closed list under-reports and never fabricates.
 */
const SUPERFICIAL_ING = [
  "highlighting", "ensuring", "reflecting", "showcasing", "underscoring",
  "emphasizing", "demonstrating", "illustrating", "signifying",
  "showcasing the", "paving the way", "further solidifying",
];

/** Assistant throat-clearing. Never carries information. */
const CHATBOT_FILLER = [
  "i hope this helps", "let me know if", "feel free to", "great question",
  "certainly!", "of course!", "i'd be happy to", "as an ai",
  "in conclusion", "to summarize,", "here's a breakdown",
  "let's dive in", "without further ado",
];

/**
 * Matches the authored-copy threshold in scripts/check-prose-lint.ts. Kept as
 * a local literal rather than an import: that file is a build-time script with
 * a heavy dependency graph, and this module is deliberately import-free.
 */
const LONG_SENTENCE_WORDS = 25;

export type GeneratedProseAxes = {
  puffery: number;
  superficialIng: number;
  chatbotFiller: number;
  longSentences: number;
  sentences: number;
};

export type GeneratedProseZone = "clean" | "noticeable" | "slop";

export type GeneratedProseReading = GeneratedProseAxes & {
  /** Total tells across the three content axes. Long sentences are reported
   *  but excluded — a long sentence can be the right sentence. */
  tells: number;
  zone: GeneratedProseZone;
};

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Score generated prose. Case-insensitive; counts every occurrence, not every
 * matching phrase, so three "seamless" in one paragraph read as three.
 */
export function analyzeGeneratedProse(text: string): GeneratedProseReading {
  const lower = (text ?? "").toLowerCase();

  const puffery = PUFFERY.reduce((n, p) => n + countOccurrences(lower, p), 0);
  const chatbotFiller = CHATBOT_FILLER.reduce((n, p) => n + countOccurrences(lower, p), 0);
  const superficialIng = SUPERFICIAL_ING.reduce(
    (n, p) => n + countOccurrences(lower, `, ${p}`),
    0,
  );

  const sentenceList = splitSentences(text ?? "");
  const longSentences = sentenceList.filter((s) => wordCount(s) > LONG_SENTENCE_WORDS).length;

  const tells = puffery + superficialIng + chatbotFiller;

  return {
    puffery,
    superficialIng,
    chatbotFiller,
    longSentences,
    sentences: sentenceList.length,
    tells,
    zone: classifyGeneratedProse(tells, sentenceList.length),
  };
}

/**
 * Band the tell count by density rather than absolute count, so a long report
 * is not penalized for being long and a two-sentence alert is not excused for
 * being short.
 *
 * Thresholds are heuristic and deliberately loose — this gauge exists to make
 * a regression visible, not to adjudicate style. Tighten them from a baseline,
 * not from taste.
 */
export function classifyGeneratedProse(tells: number, sentences: number): GeneratedProseZone {
  if (tells === 0) return "clean";
  const density = tells / Math.max(sentences, 1);
  if (density >= 0.5 || tells >= 6) return "slop";
  return "noticeable";
}

/**
 * Emit the gauge for one generated response.
 *
 * Lives here rather than inline in the agentic loop because that file is the
 * largest module in the repo and its size ratchet only permits shrinking —
 * observability should not spend that budget. Silent on a clean turn.
 *
 * `redact` is the caller's log sanitizer, injected so this module stays
 * import-free and unit-testable.
 */
export function logGeneratedProse(
  text: string,
  context: { threadId?: string | null; modelId?: string | null },
  redact: (line: string) => string = (line) => line,
): GeneratedProseReading {
  const reading = analyzeGeneratedProse(text);
  if (reading.zone !== "clean") {
    console.log(
      redact(
        `[generated-prose] thread=${JSON.stringify(context.threadId ?? null)} ` +
          `zone=${reading.zone} tells=${reading.tells} puffery=${reading.puffery} ` +
          `ing=${reading.superficialIng} filler=${reading.chatbotFiller} ` +
          `longSentences=${reading.longSentences} sentences=${reading.sentences} ` +
          `model=${JSON.stringify(context.modelId ?? null)}`,
      ),
    );
  }
  return reading;
}

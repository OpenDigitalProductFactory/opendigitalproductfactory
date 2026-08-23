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
  /** Total tells across the three word-list axes. */
  tells: number;
  /** Long sentences as a share of all sentences. The axis that actually
   *  carries signal in this corpus — see LONG_SENTENCE_RATIO_BASELINE. */
  longSentenceRatio: number;
  zone: GeneratedProseZone;
};

/**
 * Measured on the live install, 2026-08-23, over 899 model-written coworker
 * messages (BI-41F15FD7):
 *
 *   word-list tells   2 puffery + 1 superficial -ing + 0 chatbot filler
 *                     -> 0.3% of messages scored anything at all
 *   long sentences    686 of 3,582 sentences (19.2%)
 *                     575 of 899 messages contained at least one (64%)
 *                     per-message ratio: median 0.25, p90 0.33
 *
 * The word lists were ported from a critique of long-form AI marketing prose.
 * DPF coworker output is short operational status text, which has no room for
 * puffery and no reason for throat-clearing, so those axes fire on almost
 * nothing. Sentence length is the readability problem this corpus actually has.
 *
 * CHOOSING THE THRESHOLD. The ratio is lumpy, because most messages are only
 * three or four sentences long, so values pile up on 0, 0.25 and one third.
 * p75, p90 and p95 are ALL 0.33. That makes the quantiles useless as a dial:
 *
 *   > 1/3   ->  31 messages   3.4%
 *   >= 1/3  -> 226 messages  25.1%
 *
 * The rule is therefore "MORE than a third of the sentences run long", which
 * excludes the very common one-long-sentence-in-three shape. That shape is not
 * a defect, and flagging a quarter of all output every day produces a number
 * nobody reads. Strictly-greater comparison against 1/3 does this exactly:
 * a computed 1/3 is not greater than the literal 1/3.
 *
 * Derived from one corpus measurement, not a law. Re-derive it when the corpus
 * changes rather than nudging it by feel — and note the metric is dominated by
 * message length, so it is a weak signal on very short replies.
 */
export const LONG_SENTENCE_RATIO_BASELINE = 1 / 3;

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
  const longSentenceRatio = sentenceList.length
    ? longSentences / sentenceList.length
    : 0;

  return {
    puffery,
    superficialIng,
    chatbotFiller,
    longSentences,
    sentences: sentenceList.length,
    tells,
    longSentenceRatio,
    zone: classifyGeneratedProse(tells, sentenceList.length, longSentenceRatio),
  };
}

/**
 * Band by density rather than absolute count, so a long report is not penalized
 * for being long and a two-sentence alert is not excused for being short.
 *
 * Two independent signals, because they mean different things. A word-list tell
 * is rare and specific — worth surfacing on its own. A high long-sentence ratio
 * is common and diffuse — worth surfacing only past the measured p90.
 *
 * These thresholds now come from a corpus measurement rather than taste; the
 * word-list bands are unchanged and remain unvalidated at the `slop` end, which
 * production has never reached.
 */
export function classifyGeneratedProse(
  tells: number,
  sentences: number,
  longSentenceRatio = 0,
): GeneratedProseZone {
  const density = tells / Math.max(sentences, 1);
  if (density >= 0.5 || tells >= 6) return "slop";
  if (tells > 0) return "noticeable";
  // No word-list tells: the sentence-length axis decides.
  if (longSentenceRatio > LONG_SENTENCE_RATIO_BASELINE) return "noticeable";
  return "clean";
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

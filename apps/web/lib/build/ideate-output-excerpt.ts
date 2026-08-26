// apps/web/lib/build/ideate-output-excerpt.ts
//
// BI-7AD0759A — keep what the model actually said when a local ideate run
// cannot be parsed into a design document.
//
// Live repro FB-D23311A7 on the Pet Rescue install: with routing fixed the
// local model genuinely ran, twice, for about four minutes each — and both
// times `dispatchIdeateResearch` returned `rawOutput` that `ideate-on-approval`
// never referenced. The operator was left with a four-minute wait and the fixed
// sentence "Routed ideate output could not be parsed into a design document."
// On a local-only install that is the whole story they get.
//
// Pure module — no Prisma, no I/O — so the excerpt rule is unit-testable
// without the database, and so importing it cannot drag the DB client into a
// test's module graph.

/** Max characters of model output kept as evidence, split across head and tail. */
export const IDEATE_EXCERPT_BUDGET = 1200;

/**
 * Bounded excerpt that keeps BOTH ends of the output.
 *
 * Truncating only the head hides exactly the place a malformed JSON object
 * usually fails. Short output is returned whole; longer output keeps the first
 * and last halves of the budget with a marker naming how much was elided, so an
 * excerpt can never be mistaken for the complete response.
 */
export function excerptHeadAndTail(text: string, budget = IDEATE_EXCERPT_BUDGET): string {
  if (text.length <= budget) return text;
  const half = Math.floor(budget / 2);
  const elided = text.length - budget;
  return `${text.slice(0, half)}\n… [${elided} chars elided] …\n${text.slice(-half)}`;
}

/**
 * The activity summary for a failed parse.
 *
 * An empty response is reported as such: "the model returned nothing" is a
 * different diagnosis from "the model returned prose", and collapsing the two
 * is how this failure stayed opaque.
 */
export function describeIdeateOutput(rawOutput: string | undefined | null): string {
  const text = (rawOutput ?? "").trim();
  if (text.length === 0) return "Ideate output excerpt: the model returned no output at all.";
  return `Ideate output excerpt (${text.length} chars): ${excerptHeadAndTail(text)}`;
}

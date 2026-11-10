// apps/web/lib/shared/excerpt-head-and-tail.ts
//
// Bounded excerpt that keeps BOTH ends of a text. Truncating only the head
// hides exactly where a malformed response fails and where a CLI puts its
// error after the banner. Short input is returned whole; longer input keeps
// the first and last halves of the budget with a marker naming how much was
// elided, so an excerpt can never be mistaken for the complete text.

export function excerptHeadAndTail(text: string, budget: number): string {
  if (text.length <= budget) return text;
  const half = Math.floor(budget / 2);
  const elided = text.length - budget;
  return `${text.slice(0, half)}\n… [${elided} chars elided] …\n${text.slice(-half)}`;
}

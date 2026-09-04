// apps/web/lib/build/owner-ask-context.ts
//
// BI-82E41B79 — what the owner ASKED FOR, in the words they used.
//
// A design review that sees only the design cannot catch a design that exceeds
// its brief. The design restates the request in its own `problemStatement`, and
// constraints do not survive that restatement: an owner who wrote "no settings,
// no filters, no configuration" got a design with URL-parameter filtering, and
// the reviewer — having never seen the prohibition — failed the build on that
// filter's edge cases rather than on its existence. Three builds died that way.
//
// So the ask travels to the reviewer verbatim. Not summarised, not re-derived
// from the design: the point is precisely that the design's version of the ask
// has already lost the constraints.

/** Longest ask carried into the prompt. Enough for a paragraph of constraints. */
const MAX_ASK_CHARS = 2000;

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/**
 * Render the owner's request as review context.
 *
 * Returns "" when there is nothing to say, so a caller with no title or
 * description passes exactly what it passed before rather than an empty
 * heading the reviewer would have to interpret.
 */
export function ownerAskContext(
  title: string | null | undefined,
  description: string | null | undefined,
): string {
  const askTitle = clean(title);
  const askBody = clean(description);
  // The description usually restates the title; carrying both would spend the
  // budget on a duplicate and read as emphasis the owner did not intend.
  const ask = askBody.startsWith(askTitle) ? askBody : [askTitle, askBody].filter(Boolean).join(" — ");
  if (!ask) return "";

  const truncated = ask.length > MAX_ASK_CHARS ? `${ask.slice(0, MAX_ASK_CHARS)}…` : ask;
  return [
    "WHAT THE OWNER ASKED FOR (verbatim — this is the request the design must serve):",
    truncated,
    "",
    "SCOPE FIDELITY: the design is answerable to this request, not only to good practice.",
    "If the owner ruled something OUT — no new fields, no configuration, no filters, no",
    "settings, a stated cap — a design that includes it anyway has EXCEEDED THE ASK, and",
    "that is itself a blocking issue: report it as critical and say which words it",
    "contradicts. Do NOT review the excess surface on its merits or ask for it to be",
    "hardened; the repair is to REMOVE it. Judge a design at the scale the request",
    "implies: absent a stated scale, do not assume the largest one.",
  ].join("\n");
}

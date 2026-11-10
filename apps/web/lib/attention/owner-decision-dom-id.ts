// The DOM id of one owner decision card (BI-0012E6CA).
//
// One home for the id so the card that renders it (OwnerDecisionCards) and every
// link that targets it (envelopeInboxRoute) cannot drift apart: an approval deep
// link used to point at `#approval-result`, an element the card never had.
//
// Pure — no React, no server graph — so client components and route builders
// can both import it.

/** Keep only characters that are safe in an id and a URL fragment. */
function safeIdPart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

/** The id on the card's <article>; its trigger and panel ids derive from it. */
export function ownerDecisionCardDomId(attentionItemId: string): string {
  return `owner-decision-${safeIdPart(attentionItemId)}`;
}

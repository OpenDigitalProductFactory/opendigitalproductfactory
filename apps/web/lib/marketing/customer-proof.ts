/** A task instruction or proof-asset label is not evidence of a customer result. */
export function requiresCustomerProof(task: { title: string; assetType: string; brief?: string | null }): boolean {
  const text = [task.title, task.assetType, task.brief].filter(Boolean).join("\n")
    .replace(/\b(?:without|no)\s+(?:customer|client)\s+(?:result|outcome|win)s?\s+claims\b/gi, "");
  const customerClaim = /\b(?:customer|client)[\s-]+(?:proof|case[\s-]*study|success|stor(?:y|ies)|wins?|outcomes?|results?|testimonials?)\b|\bclosed[\s-]*won\b|\btestimonials?\b/i.test(text);
  const measuredCustomerOutcome = /\b(?:customers?|clients?)\b[^.!?\n]{0,120}\b(?:reduced|saved|increased|achieved|improved|cut|grew|doubled|tripled|reported)\b/i.test(text);
  if (customerClaim || measuredCustomerOutcome) return true;
  // Internal dogfooding is not a customer success story. It must not borrow
  // this distinction to turn a customer claim into an established fact.
  if (/\binternal\s+dogfood(?:ing)?\b/i.test(text)) return false;
  return /\bcase[\s-]*stud(?:y|ies)\b/i.test(text);
}

export const CUSTOMER_PROOF_REMEDY = "Customer outcomes are unverified. Collect the source records, checked figures and required customer permission before drafting customer proof. A label or link alone does not establish them. An internal dogfooding account must be clearly labeled and must not imply customer results.";
const COLLECTION_TITLE = "Collect evidence for customer proof";

/** Preserve the saved row/history; make its current business instruction honest. */
export function customerProofTaskPresentation<T extends { title: string; assetType: string; brief: string | null }>(task: T): T {
  if (!requiresCustomerProof(task)) return task;
  if (task.title === COLLECTION_TITLE && task.brief?.startsWith(CUSTOMER_PROOF_REMEDY)) return task;
  return { ...task, title: COLLECTION_TITLE,
    brief: `${CUSTOMER_PROOF_REMEDY}\n\nUnverified original request: ${task.title}\n${task.brief ?? ""}` };
}

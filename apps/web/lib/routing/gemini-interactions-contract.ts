/**
 * Server-owned wire contract for Gemini's Interactions API.
 *
 * Google versions this preview surface independently from the v1beta URL. A
 * request without the revision header can be evaluated against an older
 * capability set and reject an otherwise supported background model. Keep
 * create and poll on the same immutable protocol revision.
 */
export const GEMINI_INTERACTIONS_API_REVISION = "2026-05-20";

export function withGeminiInteractionsApiRevision(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const withoutCallerRevision = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== "api-revision"),
  );
  return {
    ...withoutCallerRevision,
    "Api-Revision": GEMINI_INTERACTIONS_API_REVISION,
  };
}

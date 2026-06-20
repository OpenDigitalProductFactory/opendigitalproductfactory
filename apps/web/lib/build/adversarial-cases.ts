// apps/web/lib/build/adversarial-cases.ts
//
// Adversarial / edge-case generation for build verification (BI-02B98843).
//
// The review-phase browser-UX check verifies acceptance criteria PASS. Nothing
// deliberately tries to BREAK the feature — the pillar credited for the biggest
// first-pass quality jump. This produces negative / abuse / edge cases from the
// acceptance criteria + changed surface, phrased as plain-English browser
// assertions (the form runBrowserUseTests consumes), to run as an ADVISORY pass
// alongside the happy-path checks.
//
// Pure: prompt assembly + result parsing only. The LLM call + execution live in
// the verification queue function, so this stays trivially unit-testable.

export const MAX_ADVERSARIAL_CASES = 5;

export type AdversarialCaseInput = {
  acceptanceCriteria: string[];
  changedFiles: string[];
  /** Optional unified-diff excerpt for richer generation. */
  diffExcerpt?: string;
};

export function buildAdversarialCasePrompt(input: AdversarialCaseInput): string {
  const criteria =
    input.acceptanceCriteria.filter(Boolean).map((c, i) => `${i + 1}. ${c}`).join("\n") ||
    "(none provided)";
  const files = input.changedFiles.filter(Boolean).slice(0, 40).join("\n") || "(unknown)";
  const diff = input.diffExcerpt ? `\n\nChanged code (excerpt):\n${input.diffExcerpt.slice(0, 4000)}` : "";
  return [
    "You are an adversarial QA engineer. Your job is to BREAK the feature, not confirm it works.",
    "",
    "Acceptance criteria the feature is supposed to satisfy:",
    criteria,
    "",
    "Changed files:",
    files,
    diff,
    "",
    `Generate up to ${MAX_ADVERSARIAL_CASES} negative / abuse / edge cases that probe how this feature FAILS. Cover these angles where relevant:`,
    "- Unauthorized / unauthenticated access to a protected action.",
    "- Malformed, empty, oversized, or wrong-type input.",
    "- Boundary values (0, negative, max length, special characters).",
    "- Double-submit / rapid repeat / idempotency.",
    "- Navigation into a forbidden or half-completed state.",
    "",
    "Each case MUST be a single plain-English instruction a browser agent can drive, phrased as a POSITIVE assertion of GRACEFUL handling (so a real failure is detectable). For example:",
    '  "Submit the form with the required email field empty and confirm a clear validation message appears, not a crash, blank screen, or silent success."',
    "",
    'Respond with ONLY a JSON object: { "cases": ["...", "..."] }. No prose outside the JSON.',
  ].join("\n");
}

export function parseAdversarialCases(raw: string): string[] {
  if (!raw) return [];
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (!objMatch) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(objMatch[0]);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const cases = (parsed as Record<string, unknown>).cases;
  if (!Array.isArray(cases)) return [];
  return cases
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim())
    .slice(0, MAX_ADVERSARIAL_CASES);
}

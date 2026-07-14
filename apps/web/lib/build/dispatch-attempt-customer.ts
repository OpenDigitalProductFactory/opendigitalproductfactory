/**
 * Client-safe plain-language helpers for dispatch attempt display (BI-F606D0E6).
 *
 * Kept free of Node-only imports (`crypto`, `@dpf/db`) so client components can
 * import without pulling the server dispatch recorder into the browser bundle
 * (Next production build failed when BuildDispatchHistoryCard imported from
 * dispatch-attempts.ts directly).
 */
import type { BuildFailureAxis } from "./progress-visibility-types";

/**
 * Plain-language labels for dispatch failure axes (BI-F606D0E6 / EP-BS-UX-HARDENING
 * invariant 3). Never surface tool names (opencode, codex, …) or raw exit codes
 * on the default customer/operator surface.
 */
export function formatDispatchFailureAxisPlain(axis: BuildFailureAxis): string {
  switch (axis) {
    case "usage-limit":
      return "The AI usage limit was reached";
    case "rate-limit":
      return "The AI service is temporarily busy";
    case "auth":
      return "The AI service needs to be signed in again";
    case "timeout":
      return "The build step took too long and stopped";
    case "test-failure":
      return "Automated tests did not pass";
    case "typecheck-failure":
      return "The code did not type-check cleanly";
    case "out-of-scope-noise":
      return "Checks failed outside this build's changes";
    case "provider-unavailable":
      return "The AI service is temporarily unavailable";
    case "unknown":
    default:
      return "The build assistant could not finish this step";
  }
}

/** Coding-tool / CLI names that must not appear on the non-engineer surface. */
const DISPATCH_TOOL_NAME_RE =
  /\b(?:opencode|open-?code|claude(?:-?code)?|codex(?:-?cli)?|grok(?:-?cli)?|chatgpt|openai)\b/gi;

/** Raw "exit code N" / "exit N" patterns. */
const EXIT_CODE_RE = /\bexit(?:\s+code)?\s+\d+\b/gi;

/**
 * Strip tool names and raw exit codes from free-text diagnosis so non-engineer
 * view stays plain language (BI-F606D0E6).
 */
export function stripDispatchJargon(text: string): string {
  const cleaned = text
    .replace(EXIT_CODE_RE, "")
    .replace(DISPATCH_TOOL_NAME_RE, "the build assistant")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
  return cleaned.length > 0 ? cleaned : formatDispatchFailureAxisPlain("unknown");
}

/**
 * Customer/operator-facing one-line status for a dispatch attempt.
 * Pure + unit-tested. Engineer view keeps exit codes / model / raw output.
 */
export function formatDispatchAttemptCustomerStatus(args: {
  success: boolean;
  exitCode: number | null;
  failureAxis: BuildFailureAxis;
  rootCauseSummary: string | null;
}): string {
  if (args.success || args.exitCode === 0) {
    return "Completed";
  }
  if (args.rootCauseSummary) {
    const stripped = stripDispatchJargon(args.rootCauseSummary);
    if (stripped && stripped !== formatDispatchFailureAxisPlain("unknown")) {
      return stripped;
    }
  }
  return formatDispatchFailureAxisPlain(args.failureAxis);
}

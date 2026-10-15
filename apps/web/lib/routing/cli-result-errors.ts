import { InferenceError } from "./inference-error";

// CLI-owned banner, including the organization spend cap observed in BI-EDF1BD54.
// Anchor it so a successful explanation mentioning a limit is not a failure.
const CLI_QUOTA_BANNER = /^(?:you(?:'|’)?ve\s+)?hit\s+your\s+(?:(?:org|organization)(?:'|’)s\s+)?(?:weekly|daily|monthly|usage)\s+(?:spend\s+)?limit\b/i;
export function isCliQuotaBanner(text: string): boolean {
  return CLI_QUOTA_BANNER.test(text.trimStart());
}
export function stripLeadingQuotaBanner(text: string): string {
  const firstBreak = text.search(/\n|(?<=\))\s/);
  const head = firstBreak === -1 ? text : text.slice(0, firstBreak);
  return isCliQuotaBanner(head) ? text.slice(head.length).trimStart() : text;
}
export function isProviderOverloadMessage(text: string): boolean {
  return /\b529\b|overloaded/i.test(text);
}

function failedResult(output: string): boolean {
  let payload: unknown;
  try { payload = JSON.parse(output.trim()); } catch { return false; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const result = payload as Record<string, unknown>;
  return result.type === "result" && (result.is_error === true
    || (typeof result.subtype === "string" && result.subtype.startsWith("error_")));
}

/** Classify before publishing content or clearing the CLI pool's failure state. */
export function assertCliResultSucceeded(
  output: string,
  parsed: { text: string; toolCalls: readonly unknown[] },
  providerId: string,
): void {
  const failed = failedResult(output);
  const text = parsed.text;
  const withoutTools = parsed.toolCalls.length === 0;
  // Structured failure remains a failure even if partial tool output preceded it.
  if ((failed || withoutTools) && isCliQuotaBanner(text)) {
    throw new InferenceError(`Claude CLI usage limit reached (from stdout): ${text.slice(0, 200)}`, "rate_limit", providerId);
  }
  if ((failed || withoutTools) && text.length < 300
    && /invalid api key|fix external api key|please log in|authentication failed|not authenticated/i.test(text)) {
    throw new InferenceError(`Claude CLI auth error (from stdout): ${text.slice(0, 200)}`, "auth", providerId);
  }
  if ((failed || withoutTools) && text.length < 600 && isProviderOverloadMessage(text)) {
    throw new InferenceError(`Claude CLI overloaded (from stdout): ${text.slice(0, 300)}`, "overloaded", providerId);
  }
  // Do not echo unfamiliar error arrays: they can contain prompt or secret data.
  if (failed) throw new InferenceError("Claude CLI reported an unsuccessful result.", "provider_error", providerId);
}

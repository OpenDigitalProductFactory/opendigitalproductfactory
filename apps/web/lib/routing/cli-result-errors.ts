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

function isCliAuthError(text: string): boolean {
  return text.length < 300
    && /invalid api key|fix external api key|please log in|authentication failed|not authenticated/i.test(text);
}
function isCliOverloadError(text: string): boolean {
  return text.length < 600 && isProviderOverloadMessage(text);
}

const RESULT_SUBTYPES = [
  "success", "error_during_execution", "error_max_turns",
  "error_max_budget_usd", "error_max_structured_output_retries",
] as const;
type CliResultSubtype = typeof RESULT_SUBTYPES[number];
export interface CliTerminalResultMetadata {
  status: "success" | "error" | "unknown";
  type: "result" | "unknown";
  subtype: CliResultSubtype | "unknown";
  isError: boolean | null;
  hint: "quota" | "auth" | "overloaded" | "model" | "unclassified";
}

/** Output diagnostics only. No child output proves remote settlement or retry safety. */
export function parseCliTerminalResultMetadata(output: string): CliTerminalResultMetadata {
  const metadata: CliTerminalResultMetadata = {
    status: "unknown", type: "unknown", subtype: "unknown", isError: null, hint: "unclassified",
  };
  let payload: unknown;
  try { payload = JSON.parse(output.trim()); } catch { return metadata; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return metadata;
  const record = payload as Record<string, unknown>;
  if (record.type !== "result") return metadata;
  metadata.type = "result";
  if (typeof record.is_error === "boolean") metadata.isError = record.is_error;
  const subtype = RESULT_SUBTYPES.find((known) => known === record.subtype);
  if (subtype) metadata.subtype = subtype;
  // Unknown/error arrays can contain sensitive text and do not supply a result.
  // Contradictory nonempty arrays also cannot establish a complete envelope.
  if (!subtype || metadata.isError === null
    || typeof record.result !== "string" || !record.result.trim()
    || (record.errors !== undefined && (!Array.isArray(record.errors) || record.errors.length > 0))) return metadata;
  metadata.status = metadata.isError || subtype !== "success" ? "error" : "success";
  if (metadata.status === "success") return metadata;
  const text = record.result;
  if (isCliQuotaBanner(text)) metadata.hint = "quota";
  else if (isCliAuthError(text)) metadata.hint = "auth";
  else if (isCliOverloadError(text)) metadata.hint = "overloaded";
  else if (text.length < 300
    && /^(?:the )?model\s+\S+\s+does not exist or you do not have access to it\.?$/i.test(text.trim())) metadata.hint = "model";
  return metadata;
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
  if ((failed || withoutTools) && isCliAuthError(text)) {
    throw new InferenceError(`Claude CLI auth error (from stdout): ${text.slice(0, 200)}`, "auth", providerId);
  }
  if ((failed || withoutTools) && isCliOverloadError(text)) {
    throw new InferenceError(`Claude CLI overloaded (from stdout): ${text.slice(0, 300)}`, "overloaded", providerId);
  }
  // Do not echo unfamiliar error arrays: they can contain prompt or secret data.
  if (failed) throw new InferenceError("Claude CLI reported an unsuccessful result.", "provider_error", providerId);
}

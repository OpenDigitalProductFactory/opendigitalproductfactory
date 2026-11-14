/** Code scanning (CodeQL) alerts for the commissioned repository (BI-C67E5CCB). */
import type { RepoIdentity } from "@/lib/contributor-change-lanes/github-rest-reader";
import { isRecord } from "@/lib/shared/coerce";
import { readGithubAlertPages, type AlertPageRead } from "./github-alert-pager";

export interface CodeScanningAlert {
  number: number;
  state: string;
  ruleId: string;
  ruleDescription: string;
  /** critical | high | medium | low, from security_severity_level, else mapped from rule.severity. */
  severity: string;
  tool: string;
  path: string | null;
  startLine: number | null;
  url: string;
}

/** Non-security rules carry only rule.severity (error | warning | note). */
const RULE_SEVERITY: Record<string, string> = { error: "high", warning: "medium", note: "low" };

export function parseCodeScanningAlert(value: unknown, repo: RepoIdentity): CodeScanningAlert | null {
  if (!isRecord(value) || !Number.isSafeInteger(value.number) || Number(value.number) < 1
      || typeof value.state !== "string" || !isRecord(value.rule) || typeof value.rule.id !== "string") return null;
  const rule = value.rule;
  const ruleId = String(rule.id);
  const securityLevel = typeof rule.security_severity_level === "string" ? rule.security_severity_level.toLowerCase() : null;
  const ruleLevel = typeof rule.severity === "string" ? RULE_SEVERITY[rule.severity.toLowerCase()] ?? null : null;
  const severity = securityLevel ?? ruleLevel;
  if (!severity) return null;
  const instance = isRecord(value.most_recent_instance) ? value.most_recent_instance : {};
  const location = isRecord(instance.location) ? instance.location : {};
  const tool = isRecord(value.tool) && typeof value.tool.name === "string" ? value.tool.name : "code scanning";
  return {
    number: Number(value.number), state: value.state, ruleId,
    ruleDescription: typeof rule.description === "string" && rule.description.trim() ? rule.description : ruleId,
    severity, tool,
    path: typeof location.path === "string" ? location.path : null,
    startLine: Number.isSafeInteger(location.start_line) ? Number(location.start_line) : null,
    url: `https://github.com/${repo.owner}/${repo.name}/security/code-scanning/${value.number}`,
  };
}

export function readCodeScanningAlerts(input: {
  repo: RepoIdentity; token?: string | null; fetchImpl?: typeof fetch; maxPages?: number;
}): Promise<AlertPageRead<CodeScanningAlert>> {
  return readGithubAlertPages({
    ...input, path: "code-scanning/alerts", query: { state: "open" },
    surface: "Code scanning", permission: "Code scanning alerts: read", parse: parseCodeScanningAlert,
  });
}

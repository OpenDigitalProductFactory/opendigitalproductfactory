/** Security findings grouped into units of remediation (BI-C67E5CCB).
 *
 * Pure. One item per Dependabot (ecosystem, package), per CodeQL rule and per
 * leaked secret, so one upgrade or one fix closes one item. Alerts are sorted
 * by number before they are written, so GitHub reordering a page is never a
 * source change; a new or fixed alert in the group is. */
import type { RepositoryAlert } from "./dependabot-reader";
import type { CodeScanningAlert } from "./code-scanning-reader";
import type { SecretScanningAlert } from "./secret-scanning-reader";
import type { InboundEcosystemItem } from "./inbound-issue-triage";

export const SECURITY_GROUP_KINDS = ["dependabot-package", "code-scanning-rule", "secret-scanning-alert"] as const;
export type SecurityGroupKind = (typeof SECURITY_GROUP_KINDS)[number];

export function isSecurityGroupKind(value: unknown): value is SecurityGroupKind {
  return typeof value === "string" && (SECURITY_GROUP_KINDS as readonly string[]).includes(value);
}

/** The backlog origin kind the front door records for a group. */
export function securityOriginKind(kind: SecurityGroupKind): string {
  return `ecosystem-${kind}`;
}

const SEVERITY_RANK: Record<string, number> = { critical: 1, high: 2, moderate: 3, medium: 3, low: 4, note: 4, warning: 3, error: 2 };
const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;

/** Lower is more urgent. Unknown severities rank with medium rather than vanish. */
export function priorityForSeverity(severity: string): number {
  return SEVERITY_RANK[severity.trim().toLowerCase()] ?? 3;
}

/** Leaked secrets always rank first: a valid credential is exploitable today. */
export const SECRET_PRIORITY = 1;

function normalizeSeverity(severity: string): (typeof SEVERITY_ORDER)[number] {
  return SEVERITY_ORDER[priorityForSeverity(severity) - 1] ?? "medium";
}

function highest(severities: string[]): (typeof SEVERITY_ORDER)[number] {
  return SEVERITY_ORDER[Math.min(...severities.map(priorityForSeverity)) - 1] ?? "medium";
}

function countPhrase(severities: string[]): string {
  const counts = new Map<string, number>();
  for (const s of severities.map(normalizeSeverity)) counts.set(s, (counts.get(s) ?? 0) + 1);
  return SEVERITY_ORDER.filter((s) => counts.has(s)).map((s) => `${counts.get(s)} ${s}`).join(", ");
}

function byKey<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

const repository = (repo: { owner: string; name: string }) => `${repo.owner}/${repo.name}`.toLowerCase();

const NOT_REACHABILITY = "A provider finding is not proof of deployed reachability: verify the resolved dependency or code path before remediating.";

export function groupDependabotAlerts(alerts: RepositoryAlert[], repo: { owner: string; name: string }): InboundEcosystemItem[] {
  return [...byKey(alerts, (a) => `${a.ecosystem}/${a.packageName}`).entries()].map(([key, rows]) => {
    const sorted = [...rows].sort((a, b) => a.number - b.number);
    const top = highest(sorted.map((a) => a.severity));
    const noun = sorted.length === 1 ? "advisory" : "advisories";
    const { packageName, ecosystem } = sorted[0];
    const lines = sorted.map((a) => `- #${a.number} ${normalizeSeverity(a.severity)} ${a.advisory}: ${a.summary} — ${a.manifest}, `
      + `affected ${a.vulnerable}, patched ${a.patched ?? "none published"} — ${a.url}`);
    return {
      sourceKind: "dependabot-package" as const, sourceId: key, repository: repository(repo), state: "open",
      title: `Upgrade ${packageName} (${ecosystem}): ${countPhrase(sorted.map((a) => a.severity))} Dependabot ${noun}`,
      summary: [`Open Dependabot alerts on ${packageName} (${ecosystem}):`, "", ...lines, "", NOT_REACHABILITY,
        "Fix with the dpf-clear-dependabot-alerts skill. This item moves to awaiting acceptance once GitHub no longer reports any of these alerts open."].join("\n"),
      workType: "bug", url: `https://github.com/${repo.owner}/${repo.name}/security/dependabot?q=package%3A${encodeURIComponent(packageName)}+is%3Aopen`,
      priority: priorityForSeverity(top),
      securityGroup: { alertNumbers: sorted.map((a) => a.number), highestSeverity: top },
    };
  });
}

export function groupCodeScanningAlerts(alerts: CodeScanningAlert[], repo: { owner: string; name: string }): InboundEcosystemItem[] {
  return [...byKey(alerts, (a) => a.ruleId).entries()].map(([ruleId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.number - b.number);
    const top = highest(sorted.map((a) => a.severity));
    const noun = sorted.length === 1 ? "alert" : "alerts";
    const lines = sorted.map((a) => `- #${a.number} ${normalizeSeverity(a.severity)} at ${a.path ?? "unknown path"}`
      + `${a.startLine ? `:${a.startLine}` : ""} — ${a.url}`);
    return {
      sourceKind: "code-scanning-rule" as const, sourceId: ruleId, repository: repository(repo), state: "open",
      title: `Fix ${sorted[0].tool} ${ruleId}: ${countPhrase(sorted.map((a) => a.severity))} ${noun}`,
      summary: [`${sorted[0].ruleDescription}`, "", ...lines, "",
        "This item moves to awaiting acceptance once GitHub no longer reports any of these alerts open."].join("\n"),
      workType: "bug", url: sorted[0].url, priority: priorityForSeverity(top),
      securityGroup: { alertNumbers: sorted.map((a) => a.number), highestSeverity: top },
    };
  });
}

export function groupSecretScanningAlerts(alerts: SecretScanningAlert[], repo: { owner: string; name: string }): InboundEcosystemItem[] {
  return [...alerts].sort((a, b) => a.number - b.number).map((a) => ({
    sourceKind: "secret-scanning-alert" as const, sourceId: String(a.number), repository: repository(repo), state: "open",
    title: `Revoke and remove leaked ${a.secretType} (secret scanning #${a.number})`,
    // Never the secret value: the reader drops it at parse time (AC-7).
    summary: [`GitHub secret scanning found a ${a.secretType}${a.validity ? ` (validity: ${a.validity})` : ""} at `
      + `${a.path ?? "an undisclosed location"}${a.startLine ? `:${a.startLine}` : ""}.`, "",
      "Revoke the credential at its issuer first, then remove it from the repository and its history, then resolve the alert.",
      a.url].join("\n"),
    workType: "bug", url: a.url, priority: SECRET_PRIORITY,
    securityGroup: { alertNumbers: [a.number], highestSeverity: "critical" },
  }));
}

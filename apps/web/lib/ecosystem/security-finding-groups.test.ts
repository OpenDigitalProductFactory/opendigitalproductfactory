import { describe, expect, it } from "vitest";
import type { RepositoryAlert } from "./dependabot-reader";
import type { CodeScanningAlert } from "./code-scanning-reader";
import type { SecretScanningAlert } from "./secret-scanning-reader";
import {
  groupCodeScanningAlerts,
  groupDependabotAlerts,
  groupSecretScanningAlerts,
  priorityForSeverity,
  securityOriginKind,
} from "./security-finding-groups";
import { inboundSourceFingerprint, toBacklogIngestInput } from "./inbound-issue-triage";

const repo = { owner: "Acme", name: "Widgets" };
const dep = (number: number, severity: string, pkg = "undici", manifest = "a/pnpm-lock.yaml"): RepositoryAlert => ({
  number, state: "open", packageName: pkg, ecosystem: "npm", manifest, severity, advisory: `GHSA-${number}`,
  summary: `advisory ${number}`, vulnerable: "<7.0.0", patched: "7.0.0", url: `https://github.com/acme/widgets/security/dependabot/${number}`,
});
const rule = (number: number, ruleId: string, severity: string): CodeScanningAlert => ({
  number, state: "open", ruleId, ruleDescription: `${ruleId} description`, severity, tool: "CodeQL",
  path: "src/x.ts", startLine: 3, url: `https://github.com/acme/widgets/security/code-scanning/${number}`,
});
const secret: SecretScanningAlert = { number: 9, state: "open", secretType: "AWS Access Key ID", validity: "active",
  path: "deploy.sh", startLine: 2, url: "https://github.com/acme/widgets/security/secret-scanning/9" };

describe("priority from severity (AC-3)", () => {
  it("ranks critical first, then high, medium and low", () => {
    expect([priorityForSeverity("critical"), priorityForSeverity("high"), priorityForSeverity("moderate"),
      priorityForSeverity("medium"), priorityForSeverity("low"), priorityForSeverity("note")]).toEqual([1, 2, 3, 3, 4, 4]);
  });
});

describe("Dependabot grouping per (ecosystem, package) (AC-2)", () => {
  it("files one item per package across manifests, with counts and the highest severity", () => {
    const groups = groupDependabotAlerts([dep(1, "medium"), dep(2, "high", "undici", "b/pnpm-lock.yaml"), dep(3, "low", "hono")], repo);
    expect(groups).toHaveLength(2);
    const undici = groups.find((g) => g.sourceId === "npm/undici")!;
    expect(undici).toMatchObject({ sourceKind: "dependabot-package", repository: "acme/widgets", state: "open", priority: 2 });
    expect(undici.title).toBe("Upgrade undici (npm): 1 high, 1 medium Dependabot advisories");
    expect(undici.summary).toContain("#1");
    expect(undici.summary).toContain("b/pnpm-lock.yaml");
    expect(undici.securityGroup).toEqual({ alertNumbers: [1, 2], highestSeverity: "high" });
  });

  it("keeps the same fingerprint when GitHub reorders alerts and changes it when an alert appears", () => {
    const a = groupDependabotAlerts([dep(1, "medium"), dep(2, "high")], repo)[0];
    const b = groupDependabotAlerts([dep(2, "high"), dep(1, "medium")], repo)[0];
    const c = groupDependabotAlerts([dep(1, "medium"), dep(2, "high"), dep(4, "low")], repo)[0];
    expect(inboundSourceFingerprint(a)).toBe(inboundSourceFingerprint(b));
    expect(inboundSourceFingerprint(a)).not.toBe(inboundSourceFingerprint(c));
  });

  it("files an automated-detection bug with a qualified per-package origin and its priority (AC-6)", () => {
    const input = toBacklogIngestInput(groupDependabotAlerts([dep(1, "critical")], repo)[0]);
    expect(input).toMatchObject({ source: "automated-detection", workType: "bug", priority: 1,
      origin: { kind: securityOriginKind("dependabot-package"), id: "acme/widgets#npm/undici" } });
    expect(input.origin?.kind).toBe("ecosystem-dependabot-package");
  });
});

describe("code scanning grouping per rule", () => {
  it("files one item per rule with every location", () => {
    const groups = groupCodeScanningAlerts([rule(526, "js/file-access-to-http", "medium"), rule(527, "js/file-access-to-http", "medium"),
      rule(528, "js/polynomial-redos", "high")], repo);
    expect(groups.map((g) => [g.sourceId, g.priority])).toEqual([["js/file-access-to-http", 3], ["js/polynomial-redos", 2]]);
    expect(groups[0].title).toBe("Fix CodeQL js/file-access-to-http: 2 medium alerts");
  });
});

describe("secret scanning: one item per secret, always top priority (AC-3, AC-7)", () => {
  it("ranks every leaked secret first and names only type, location and link", () => {
    const [item] = groupSecretScanningAlerts([secret], repo);
    expect(item).toMatchObject({ sourceKind: "secret-scanning-alert", sourceId: "9", priority: 1 });
    expect(item.title).toBe("Revoke and remove leaked AWS Access Key ID (secret scanning #9)");
    expect(item.summary).toContain("deploy.sh:2");
  });
});

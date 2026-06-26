// EP-SOVEREIGN-SOC P1 content — the kernel detection-rule starter pack.
//
// Spec: docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md §4.3, §7.1.
//
// A small, explainable starter pack so the correlation sweep produces detections
// out of the box (it is otherwise correctly inert with no rules). Seeded under
// scopeKey="kernel" so it applies to every tenant; an operator tunes or disables
// rules per tenant via overlays without touching this pack. `ensureKernelDetectionPack`
// is create-if-missing — operator changes to an existing rule are never overwritten.

import type { DetectionPredicate, DetectionRuleView } from "./detection";

export const KERNEL_DETECTION_PACK_KEY = "dpf-kernel";
// 1.1.0 — additive content expansion (Windows high-signal event IDs, AWS
// control-plane tampering, upstream-finding relay) over the 1.0.0 starter trio.
// Bumps are deliberate: `ensureKernelDetectionPack` is create-if-missing keyed on
// ruleKey, so existing/operator-tuned rows are never re-asserted by a version bump.
export const KERNEL_DETECTION_PACK_VERSION = "1.1.0";

export interface KernelDetectionRule {
  ruleKey: string;
  name: string;
  description: string;
  severity: string;
  mitreTechniques: string[];
  predicate: DetectionPredicate;
}

export const KERNEL_DETECTION_PACK: KernelDetectionRule[] = [
  {
    ruleKey: "dpf-kernel:windows-failed-logon",
    name: "Windows failed logon",
    description:
      "A failed Windows logon (Event ID 4625 → OCSF Authentication, Medium). Repeated failures may indicate brute force.",
    severity: "medium",
    mitreTechniques: ["T1110"],
    predicate: { sourceKind: "windows.security", classUid: 3002, minSeverityId: 3 },
  },
  {
    ruleKey: "dpf-kernel:threat-intel-hit",
    name: "Threat-intel indicator match",
    description: "An event observable matched a known threat indicator (IOC) in the active feed.",
    severity: "high",
    mitreTechniques: ["T1071"],
    predicate: { matchThreatIndicator: true },
  },
  {
    ruleKey: "dpf-kernel:internal-authorization-denied",
    name: "Internal authorization denied",
    description:
      "A platform authorization decision was denied or errored (self-monitoring — the platform watching itself).",
    severity: "medium",
    mitreTechniques: ["T1078"],
    predicate: { sourceKind: "dpf.internal", minSeverityId: 3 },
  },

  // ── Windows Security channel — high-signal event IDs ────────────────────────
  // The Windows normalizer passes the raw Event ID through to
  // normalized.windowsEventId, so these key on the specific ID (the rule's own
  // severity drives the detection — the events themselves normalize as low/info).
  {
    ruleKey: "dpf-kernel:windows-audit-log-cleared",
    name: "Windows security audit log cleared",
    description:
      "The Windows Security event log was cleared (Event ID 1102) — a classic anti-forensic step to destroy evidence after an intrusion.",
    severity: "high",
    mitreTechniques: ["T1070.001"],
    predicate: { sourceKind: "windows.security", equals: { path: "windowsEventId", value: 1102 } },
  },
  {
    ruleKey: "dpf-kernel:windows-account-created",
    name: "Windows account created",
    description:
      "A new Windows user account was created (Event ID 4720). Routine in normal admin flows; notable when unexpected (account persistence).",
    severity: "medium",
    mitreTechniques: ["T1136.001"],
    predicate: { sourceKind: "windows.security", equals: { path: "windowsEventId", value: 4720 } },
  },
  {
    ruleKey: "dpf-kernel:windows-privileged-group-change",
    name: "Member added to a privileged Windows group",
    description:
      "A member was added to a security-enabled group (Event ID 4728/4732/4756) — a common privilege-escalation or persistence step.",
    severity: "medium",
    mitreTechniques: ["T1098"],
    predicate: {
      sourceKind: "windows.security",
      anyOf: [
        { equals: { path: "windowsEventId", value: 4728 } },
        { equals: { path: "windowsEventId", value: 4732 } },
        { equals: { path: "windowsEventId", value: 4756 } },
      ],
    },
  },

  // ── AWS CloudTrail — high-risk control-plane operations ─────────────────────
  // The CloudTrail normalizer maps the API call name to normalized.api.operation.
  {
    ruleKey: "dpf-kernel:aws-cloudtrail-tampering",
    name: "AWS CloudTrail logging tampered",
    description:
      "A CloudTrail trail was stopped, deleted, or reconfigured (StopLogging / DeleteTrail / UpdateTrail) — disabling cloud audit logging to evade detection.",
    severity: "high",
    mitreTechniques: ["T1562.008"],
    predicate: {
      sourceKind: "aws.cloudtrail",
      anyOf: [
        { equals: { path: "api.operation", value: "StopLogging" } },
        { equals: { path: "api.operation", value: "DeleteTrail" } },
        { equals: { path: "api.operation", value: "UpdateTrail" } },
      ],
    },
  },
  {
    ruleKey: "dpf-kernel:aws-mfa-weakened",
    name: "AWS MFA device removed",
    description:
      "An MFA device was deactivated or deleted (DeactivateMFADevice / DeleteVirtualMFADevice) — weakening account authentication.",
    severity: "high",
    mitreTechniques: ["T1556"],
    predicate: {
      sourceKind: "aws.cloudtrail",
      anyOf: [
        { equals: { path: "api.operation", value: "DeactivateMFADevice" } },
        { equals: { path: "api.operation", value: "DeleteVirtualMFADevice" } },
      ],
    },
  },
  {
    ruleKey: "dpf-kernel:aws-access-key-created",
    name: "AWS access key created",
    description:
      "A long-lived IAM access key was created (CreateAccessKey). Routine in some workflows; a common persistence mechanism when unexpected.",
    severity: "medium",
    mitreTechniques: ["T1098"],
    predicate: {
      sourceKind: "aws.cloudtrail",
      equals: { path: "api.operation", value: "CreateAccessKey" },
    },
  },

  // ── Upstream security products (CEF / ArcSight → OCSF Security Finding) ──────
  {
    ruleKey: "dpf-kernel:third-party-high-severity-finding",
    name: "High-severity third-party security finding",
    description:
      "An upstream security product (IDS/IPS/EDR via CEF) reported a high- or critical-severity finding. Relayed as a detection so it lands in the same case workflow.",
    severity: "high",
    // A relay of another product's verdict — no single ATT&CK technique applies.
    mitreTechniques: [],
    predicate: { sourceKind: "cef", minSeverityId: 4 },
  },
];

/** Convert a kernel pack rule into the evaluator's view (scopeKey="kernel"). */
export function kernelRuleToView(rule: KernelDetectionRule): DetectionRuleView {
  return {
    id: rule.ruleKey,
    ruleKey: rule.ruleKey,
    name: rule.name,
    severity: rule.severity,
    scopeKey: "kernel",
    enabled: true,
    predicate: rule.predicate,
    mitreTechniques: rule.mitreTechniques,
  };
}

export interface EnsurePackResult {
  created: number;
  total: number;
}

/**
 * Idempotent create-if-missing of the kernel pack into DetectionRule. Existing
 * rows (possibly operator-tuned / disabled) are left untouched — the pack seeds,
 * it does not re-assert. Called by the correlation sweep so the rules are always
 * present without separate seed wiring.
 */
export async function ensureKernelDetectionPack(): Promise<EnsurePackResult> {
  const { prisma } = await import("@dpf/db");
  let created = 0;
  for (const rule of KERNEL_DETECTION_PACK) {
    const existing = await prisma.detectionRule.findUnique({
      where: { ruleKey: rule.ruleKey },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.detectionRule.create({
      data: {
        ruleKey: rule.ruleKey,
        rulePackKey: KERNEL_DETECTION_PACK_KEY,
        rulePackVersion: KERNEL_DETECTION_PACK_VERSION,
        name: rule.name,
        description: rule.description,
        ruleFormat: "dpf-correlation",
        predicate: rule.predicate as object,
        mitreTechniques: rule.mitreTechniques as object,
        severity: rule.severity,
        scopeKey: "kernel",
        enabled: true,
        tuning: {},
      },
    });
    created++;
  }
  return { created, total: KERNEL_DETECTION_PACK.length };
}

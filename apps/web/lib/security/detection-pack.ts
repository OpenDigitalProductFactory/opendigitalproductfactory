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
export const KERNEL_DETECTION_PACK_VERSION = "1.0.0";

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

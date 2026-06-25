// EP-SOVEREIGN-SOC — pure extractor tests for the Security Operations SysML
// projection. No DB: drives buildSecurityPostureModel directly.
import { describe, expect, it } from "vitest";

import { KERNEL_DETECTION_PACK } from "@/lib/security/detection-pack";

import {
  SECURITY_PACKAGE_KEY,
  SECURITY_PLANES,
  SOC_ROSTER,
  buildSecurityPostureModel,
} from "./security-posture-extract";

describe("buildSecurityPostureModel", () => {
  const m = buildSecurityPostureModel();

  it("emits a package, one part_definition per plane, and a part_usage per rule + coworker", () => {
    const pkg = m.elements.find((e) => e.sysmlKey === SECURITY_PACKAGE_KEY);
    expect(pkg?.typeSlug).toBe("package");
    expect(m.elements.filter((e) => e.typeSlug === "part_definition")).toHaveLength(SECURITY_PLANES.length);
    expect(m.elements.filter((e) => e.typeSlug === "part_usage")).toHaveLength(
      KERNEL_DETECTION_PACK.length + SOC_ROSTER.length,
    );
  });

  it("traces each plane to its security data-model node(s)", () => {
    const traces = m.crossLayerRelationships ?? [];
    expect(traces.every((r) => r.relSlug === "traces")).toBe(true);
    expect(new Set(traces.map((r) => r.toKey))).toEqual(
      new Set([
        "prisma:model:SecurityEvent",
        "prisma:model:Detection",
        "prisma:model:DetectionRule",
        "prisma:model:ThreatIndicator",
        "prisma:model:SecurityCase",
      ]),
    );
  });

  it("contains every plane under the package and every rule/coworker under a plane", () => {
    const contains = m.relationships.filter((r) => r.relSlug === "contains");
    for (const plane of SECURITY_PLANES) {
      expect(contains).toContainEqual({ fromKey: SECURITY_PACKAGE_KEY, toKey: plane.key, relSlug: "contains" });
    }
    // every rule is contained by the detection plane
    for (const rule of KERNEL_DETECTION_PACK) {
      expect(contains).toContainEqual({
        fromKey: "security:plane:detection",
        toKey: `security:rule:${rule.ruleKey}`,
        relSlug: "contains",
      });
    }
    // every coworker is contained by the roster plane
    for (const cw of SOC_ROSTER) {
      expect(contains).toContainEqual({
        fromKey: "security:plane:roster",
        toKey: `security:coworker:${cw.agentId}`,
        relSlug: "contains",
      });
    }
  });

  it("uses the security: soft-remove prefix so stale nodes are pruned", () => {
    expect(m.softRemovePrefix).toBe("security:");
    expect(m.elements.every((e) => e.sysmlKey.startsWith("security:"))).toBe(true);
  });
});

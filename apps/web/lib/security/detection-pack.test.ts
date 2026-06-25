// EP-SOVEREIGN-SOC P1 content — kernel detection pack fires on sample events.
import { describe, expect, it } from "vitest";

import { evaluateRulesForEvent, type SecurityEventView } from "./detection";
import { KERNEL_DETECTION_PACK, kernelRuleToView } from "./detection-pack";
import { buildIndicatorIndex } from "./threat-intel";

const NOW = new Date("2026-06-25T12:00:00.000Z");
const RULES = KERNEL_DETECTION_PACK.map(kernelRuleToView);

function evt(overrides: Partial<SecurityEventView>): SecurityEventView {
  return {
    eventKey: "e1",
    ocsfClassUid: 3002,
    severityId: 3,
    sourceKind: "windows.security",
    scopeKey: "customer:acct_1",
    customerAccountId: "acct_1",
    customerSiteId: null,
    time: NOW,
    observables: [],
    normalized: {},
    ...overrides,
  };
}

describe("KERNEL_DETECTION_PACK", () => {
  it("has stable, namespaced rule keys and kernel scope", () => {
    expect(KERNEL_DETECTION_PACK).toHaveLength(3);
    for (const v of RULES) {
      expect(v.ruleKey).toMatch(/^dpf-kernel:/);
      expect(v.scopeKey).toBe("kernel");
      expect(v.enabled).toBe(true);
    }
  });

  it("fires windows-failed-logon on a 4625-class Windows auth event", () => {
    const out = evaluateRulesForEvent(RULES, evt({}), {});
    expect(out.map((d) => d.detectionKey)).toContain("dpf-kernel:windows-failed-logon:e1");
    expect(out.find((d) => d.detectionKey.startsWith("dpf-kernel:windows-failed-logon"))!.severity).toBe("medium");
  });

  it("fires threat-intel-hit when an observable matches an indicator", () => {
    const index = buildIndicatorIndex(
      [{ indicatorKey: "i1", indicatorType: "ip", value: "9.9.9.9", source: "feed", confidence: "high" }],
      NOW,
    );
    const event = evt({
      sourceKind: "aws.cloudtrail",
      ocsfClassUid: 6003,
      severityId: 1,
      observables: [{ name: "src_endpoint.ip", type: "IP Address", value: "9.9.9.9" }],
    });
    const out = evaluateRulesForEvent(RULES, event, { indicatorIndex: index });
    expect(out.map((d) => d.detectionKey)).toContain("dpf-kernel:threat-intel-hit:e1");
  });

  it("fires internal-authorization-denied on a denied internal authz event", () => {
    const event = evt({ sourceKind: "dpf.internal", ocsfClassUid: 6003, severityId: 3 });
    const out = evaluateRulesForEvent(RULES, event, {});
    expect(out.map((d) => d.detectionKey)).toContain("dpf-kernel:internal-authorization-denied:e1");
  });

  it("does not fire on a benign low-severity internal event", () => {
    const event = evt({ sourceKind: "dpf.internal", ocsfClassUid: 6003, severityId: 1, observables: [] });
    const out = evaluateRulesForEvent(RULES, event, {});
    expect(out).toHaveLength(0);
  });
});

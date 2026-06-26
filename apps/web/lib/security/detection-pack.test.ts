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
    expect(KERNEL_DETECTION_PACK).toHaveLength(14);
    const keys = RULES.map((v) => v.ruleKey);
    expect(new Set(keys).size).toBe(keys.length); // keys are unique
    for (const v of RULES) {
      expect(v.ruleKey).toMatch(/^dpf-kernel:/);
      expect(v.scopeKey).toBe("kernel");
      expect(v.enabled).toBe(true);
    }
  });

  it("every rule carries at least one MITRE technique (except the upstream-finding relay)", () => {
    for (const r of KERNEL_DETECTION_PACK) {
      if (r.ruleKey === "dpf-kernel:third-party-high-severity-finding") continue;
      expect(r.mitreTechniques.length).toBeGreaterThan(0);
      for (const t of r.mitreTechniques) expect(t).toMatch(/^T\d{4}(\.\d{3})?$/);
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

  it("fires windows-audit-log-cleared on Event ID 1102 (anti-forensics)", () => {
    const event = evt({ severityId: 1, normalized: { windowsEventId: 1102 } });
    const out = evaluateRulesForEvent(RULES, event, {});
    const hit = out.find((d) => d.detectionKey.startsWith("dpf-kernel:windows-audit-log-cleared"));
    expect(hit?.severity).toBe("high");
  });

  it("fires windows-privileged-group-change on any of 4728/4732/4756 (anyOf)", () => {
    for (const id of [4728, 4732, 4756]) {
      const out = evaluateRulesForEvent(RULES, evt({ severityId: 1, normalized: { windowsEventId: id } }), {});
      expect(out.map((d) => d.detectionKey)).toContain(`dpf-kernel:windows-privileged-group-change:e1`);
    }
    // a sibling group-management ID we did not list must NOT fire it.
    const miss = evaluateRulesForEvent(RULES, evt({ severityId: 1, normalized: { windowsEventId: 4733 } }), {});
    expect(miss.some((d) => d.detectionKey.startsWith("dpf-kernel:windows-privileged-group-change"))).toBe(false);
  });

  it("does not fire a windows event-id rule when windowsEventId is absent", () => {
    // A plain failed-logon (no normalized.windowsEventId) must not trip the ID rules.
    const out = evaluateRulesForEvent(RULES, evt({ normalized: {} }), {});
    const idRuleHit = out.some((d) =>
      /windows-(audit-log-cleared|account-created|privileged-group-change)/.test(d.detectionKey),
    );
    expect(idRuleHit).toBe(false);
  });

  it("fires aws-cloudtrail-tampering on StopLogging/DeleteTrail (defense evasion)", () => {
    for (const op of ["StopLogging", "DeleteTrail", "UpdateTrail"]) {
      const event = evt({ sourceKind: "aws.cloudtrail", ocsfClassUid: 6003, severityId: 1, normalized: { api: { operation: op } } });
      const out = evaluateRulesForEvent(RULES, event, {});
      const hit = out.find((d) => d.detectionKey.startsWith("dpf-kernel:aws-cloudtrail-tampering"));
      expect(hit?.severity).toBe("high");
    }
  });

  it("fires aws-mfa-weakened and aws-access-key-created on their operations", () => {
    const mfa = evaluateRulesForEvent(
      RULES,
      evt({ sourceKind: "aws.cloudtrail", ocsfClassUid: 6003, severityId: 1, normalized: { api: { operation: "DeactivateMFADevice" } } }),
      {},
    );
    expect(mfa.map((d) => d.detectionKey)).toContain("dpf-kernel:aws-mfa-weakened:e1");

    const key = evaluateRulesForEvent(
      RULES,
      evt({ sourceKind: "aws.cloudtrail", ocsfClassUid: 6003, severityId: 1, normalized: { api: { operation: "CreateAccessKey" } } }),
      {},
    );
    expect(key.map((d) => d.detectionKey)).toContain("dpf-kernel:aws-access-key-created:e1");
  });

  it("does not fire CloudTrail rules on an unrelated read operation", () => {
    const out = evaluateRulesForEvent(
      RULES,
      evt({ sourceKind: "aws.cloudtrail", ocsfClassUid: 6003, severityId: 1, normalized: { api: { operation: "DescribeInstances" } } }),
      {},
    );
    expect(out.some((d) => /aws-(cloudtrail-tampering|mfa-weakened|access-key-created)/.test(d.detectionKey))).toBe(false);
  });

  it("fires execution/persistence rules on scheduled-task + service event IDs", () => {
    const task = evaluateRulesForEvent(RULES, evt({ severityId: 1, normalized: { windowsEventId: 4698 } }), {});
    expect(task.map((d) => d.detectionKey)).toContain("dpf-kernel:windows-scheduled-task-created:e1");
    for (const id of [4697, 7045]) {
      const svc = evaluateRulesForEvent(RULES, evt({ severityId: 1, normalized: { windowsEventId: id } }), {});
      expect(svc.map((d) => d.detectionKey)).toContain("dpf-kernel:windows-service-installed:e1");
    }
  });

  it("fires AWS identity rules on CreateUser + policy attachment", () => {
    const user = evaluateRulesForEvent(
      RULES,
      evt({ sourceKind: "aws.cloudtrail", ocsfClassUid: 6003, severityId: 1, normalized: { api: { operation: "CreateUser" } } }),
      {},
    );
    expect(user.map((d) => d.detectionKey)).toContain("dpf-kernel:aws-iam-user-created:e1");
    for (const op of ["AttachUserPolicy", "AttachRolePolicy", "PutUserPolicy", "PutRolePolicy"]) {
      const pol = evaluateRulesForEvent(
        RULES,
        evt({ sourceKind: "aws.cloudtrail", ocsfClassUid: 6003, severityId: 1, normalized: { api: { operation: op } } }),
        {},
      );
      expect(pol.map((d) => d.detectionKey)).toContain("dpf-kernel:aws-iam-policy-attached:e1");
    }
  });

  it("fires third-party-high-severity-finding only at severityId >= 4", () => {
    const high = evaluateRulesForEvent(RULES, evt({ sourceKind: "cef", ocsfClassUid: 2001, severityId: 4 }), {});
    expect(high.map((d) => d.detectionKey)).toContain("dpf-kernel:third-party-high-severity-finding:e1");
    const low = evaluateRulesForEvent(RULES, evt({ sourceKind: "cef", ocsfClassUid: 2001, severityId: 3 }), {});
    expect(low.some((d) => d.detectionKey.startsWith("dpf-kernel:third-party-high-severity-finding"))).toBe(false);
  });
});

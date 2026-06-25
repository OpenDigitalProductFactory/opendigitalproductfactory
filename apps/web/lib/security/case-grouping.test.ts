// EP-SOVEREIGN-SOC P2 — detection → case grouping unit tests.
import { describe, expect, it } from "vitest";

import {
  deriveGroupingKey,
  groupDetectionsIntoCases,
  maxSeverity,
  type DetectionForGrouping,
} from "./case-grouping";

const T0 = new Date("2026-06-25T12:00:00.000Z");
const T1 = new Date("2026-06-25T12:05:00.000Z");
const T2 = new Date("2026-06-25T12:10:00.000Z");

function det(overrides: Partial<DetectionForGrouping>): DetectionForGrouping {
  return {
    detectionKey: "pack:r:e1",
    scopeKey: "customer:acct_1",
    customerAccountId: "acct_1",
    customerSiteId: null,
    severity: "medium",
    groupingKey: deriveGroupingKey({ scopeKey: "customer:acct_1", entityKey: "HOST1", family: "credential-access" }),
    title: "Suspicious logon",
    firstSeenAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

describe("maxSeverity / deriveGroupingKey", () => {
  it("ranks severities", () => {
    expect(maxSeverity("low", "critical")).toBe("critical");
    expect(maxSeverity("high", "medium")).toBe("high");
    expect(maxSeverity("info", "info")).toBe("info");
  });
  it("derives a stable grouping key", () => {
    const k = deriveGroupingKey({ scopeKey: "customer:acct_1", entityKey: "HOST1", family: "x" });
    expect(k).toBe("customer:acct_1|HOST1|x");
  });
});

describe("groupDetectionsIntoCases", () => {
  it("merges detections sharing a grouping key into one stable case", () => {
    const gk = deriveGroupingKey({ scopeKey: "customer:acct_1", entityKey: "HOST1", family: "credential-access" });
    const out = groupDetectionsIntoCases([
      det({ detectionKey: "pack:r:e1", severity: "medium", firstSeenAt: T0, lastSeenAt: T0, title: "logon a" }),
      det({ detectionKey: "pack:r:e2", severity: "high", firstSeenAt: T1, lastSeenAt: T2, title: "logon b (high)" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      caseKey: `case:${gk}`,
      severity: "high", // max
      title: "logon b (high)", // highest-severity title
      detectionKeys: ["pack:r:e1", "pack:r:e2"],
      firstSeenAt: T0,
      lastSeenAt: T2,
    });
  });

  it("keeps distinct grouping keys in separate cases", () => {
    const out = groupDetectionsIntoCases([
      det({ detectionKey: "d1", groupingKey: "customer:acct_1|HOST1|x" }),
      det({ detectionKey: "d2", groupingKey: "customer:acct_1|HOST2|x" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("is order-independent (deterministic)", () => {
    const a = det({ detectionKey: "d1", severity: "low", title: "a" });
    const b = det({ detectionKey: "d2", severity: "critical", title: "b" });
    const forward = groupDetectionsIntoCases([a, b])[0]!;
    const reverse = groupDetectionsIntoCases([b, a])[0]!;
    expect(forward.severity).toBe("critical");
    expect(reverse.severity).toBe("critical");
    expect(forward.title).toBe("b");
    expect(reverse.title).toBe("b");
    expect(forward.detectionKeys.sort()).toEqual(reverse.detectionKeys.sort());
  });
});

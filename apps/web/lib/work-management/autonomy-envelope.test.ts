import { describe, expect, it } from "vitest";

import { resolveWorkCaseAutonomyEnvelope } from "./autonomy-envelope";

describe("resolveWorkCaseAutonomyEnvelope", () => {
  it("maps autopilot trust on low-risk work to an autonomous Work Case envelope", () => {
    expect(
      resolveWorkCaseAutonomyEnvelope({
        action: "respond",
        sourceKey: "engagement",
        trustLevel: "autopilot",
        risk: "read-only",
        agreementWindow: { samples: 80, agreements: 78 },
      }),
    ).toMatchObject({
      autonomyMode: "autonomous",
      decisionMode: "autonomous-action",
      effectiveTrustLevel: "autopilot",
      requiresCoworkerEnvelope: false,
      envelope: {
        autonomyMode: "autonomous",
        receiptPolicy: {
          kind: "observed-event",
        },
      },
    });
  });

  it("caps outbound or floor-risk work at propose/supervised even when trust is high", () => {
    expect(
      resolveWorkCaseAutonomyEnvelope({
        action: "complete",
        sourceKey: "backlog-item",
        trustLevel: "autopilot",
        risk: "outbound-or-floor",
        agreementWindow: { samples: 120, agreements: 120 },
      }),
    ).toMatchObject({
      autonomyMode: "supervised",
      decisionMode: "propose-for-approval",
      effectiveTrustLevel: "propose",
      requiresCoworkerEnvelope: false,
      ceiling: "propose",
    });
  });

  it("explains when a regulatory ceiling caps otherwise autonomous work", () => {
    expect(
      resolveWorkCaseAutonomyEnvelope({
        action: "respond",
        sourceKey: "engagement",
        trustLevel: "autopilot",
        risk: "read-only",
        regulatoryCeiling: "supervised",
        agreementWindow: { samples: 120, agreements: 120 },
      }).reason,
    ).toMatch(/regulatory policy/);
  });

  it("uses the existing trust graduation core to explain holds and promotions", () => {
    expect(
      resolveWorkCaseAutonomyEnvelope({
        action: "delegate",
        sourceKey: "manual-task",
        trustLevel: "propose",
        risk: "internal-reversible",
        agreementWindow: { samples: 24, agreements: 23 },
      }).trustRecommendation,
    ).toMatchObject({
      action: "promote",
      from: "propose",
      to: "supervised",
    });
  });

  it("marks supervised delegate/handoff actions as needing an approved coworker envelope", () => {
    expect(
      resolveWorkCaseAutonomyEnvelope({
        action: "delegate",
        sourceKey: "manual-task",
        trustLevel: "supervised",
        risk: "internal-reversible",
        agreementWindow: { samples: 10, agreements: 9 },
      }),
    ).toMatchObject({
      autonomyMode: "supervised",
      decisionMode: "supervised-action",
      requiresCoworkerEnvelope: true,
    });
  });

  it("falls back to governed-action receipt policy for unknown source keys", () => {
    expect(
      resolveWorkCaseAutonomyEnvelope({
        action: "respond",
        sourceKey: "future-source",
        trustLevel: "shadow",
        risk: "read-only",
        agreementWindow: { samples: 0, agreements: 0 },
      }),
    ).toMatchObject({
      autonomyMode: "observed",
      decisionMode: "shadow-only",
      envelope: {
        receiptPolicy: {
          kind: "governed-action",
        },
      },
    });
  });
});

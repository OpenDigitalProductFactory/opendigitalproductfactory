import { describe, expect, it } from "vitest";

import { healthAlertToAttentionItem, type OpenHealthAlertIssue } from "./platform-health";

describe("healthAlertToAttentionItem", () => {
  const base: OpenHealthAlertIssue = {
    issueKey: "health-alert-ContainerDown:sandbox",
    severity: "error",
    summary: "Service sandbox is down",
    details: {
      alertName: "ContainerDown",
      labels: { alertname: "ContainerDown", job: "sandbox", severity: "critical" },
      source: "prometheus",
    },
    firstDetectedAt: new Date("2026-07-07T09:00:00.000Z"),
  };

  it("projects a critical health alert in plain language, not Prometheus jargon", () => {
    const item = healthAlertToAttentionItem(base);
    expect(item.id).toBe("platform-health:health-alert-ContainerDown:sandbox");
    expect(item.source).toBe("platform-health");
    expect(item.title).toBe("Sandbox is offline");
    expect(item.context).toContain("Builds");
    expect(item.riskClass).toBe("high-risk");
    expect(item.triage.residueReason).toBe("no-self-heal");
    expect(item.triage.blastRadius).toBe("Sandbox");
    expect(item.deepLink).toBe("/ops/health");
    expect(item.createdAtIso).toBe("2026-07-07T09:00:00.000Z");
    expect(item.audience.operator).toBe(true);
  });

  it("maps warn severity to bounded-write risk", () => {
    const item = healthAlertToAttentionItem({
      ...base,
      issueKey: "health-alert-VoiceServiceDown",
      severity: "warn",
      summary: "Voice narration enabled but the TTS service is down",
      details: {
        alertName: "VoiceServiceDown",
        labels: { alertname: "VoiceServiceDown", severity: "warning" },
        source: "prometheus",
      },
    });
    expect(item.riskClass).toBe("bounded-write");
    expect(item.title).toBe("Voice narration is unavailable");
  });

  it("survives details rows without labels (falls back to the stored summary)", () => {
    const item = healthAlertToAttentionItem({
      ...base,
      details: null,
      summary: "Something is degraded",
    });
    expect(item.title).toBe("Unknown alert");
    expect(item.context).toBe("Something is degraded");
  });
});

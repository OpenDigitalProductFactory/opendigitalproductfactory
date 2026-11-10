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

  // BI-F8F8C383: a wedged Docker VM needs the operator's approval, so its card
  // goes straight to the restart control rather than the general health page.
  it("sends a wedged Docker VM to the restart control", () => {
    const item = healthAlertToAttentionItem({
      ...base,
      issueKey: "substrate:docker-vm-wedged",
      summary: "2 processes in happy_agnesi have been stuck in uninterruptible I/O for over 10 minutes.",
      details: { source: "substrate-reconciler" },
    });
    expect(item.actions).toEqual([
      { kind: "open-in-context", label: "Review Docker VM restart", href: "/ops/health#docker-vm-restart" },
    ]);
  });
});

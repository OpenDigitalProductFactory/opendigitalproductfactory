import { describe, expect, it } from "vitest";

import {
  buildHealthAlertCoworkerPrompt,
  friendlyServiceName,
  humanizeHealthAlert,
} from "./alert-humanize";
import type { MonitoringAlert } from "./health-summary";

function alert(
  labels: Record<string, string>,
  annotations: Record<string, string> = {},
): MonitoringAlert {
  return { labels, annotations, state: "firing", activeAt: "2026-07-10T18:00:00Z" };
}

describe("humanizeHealthAlert", () => {
  it("translates ContainerDown on the sandbox into plain language", () => {
    const h = humanizeHealthAlert(alert({ alertname: "ContainerDown", job: "sandbox", severity: "critical" }));
    expect(h.title).toBe("Sandbox is offline");
    expect(h.explanation).toContain("Builds");
    expect(h.alertName).toBe("ContainerDown");
    expect(h.serviceName).toBe("Sandbox");
  });

  it("translates VoiceServiceDown without needing a service label", () => {
    const h = humanizeHealthAlert(alert({ alertname: "VoiceServiceDown", severity: "warning" }));
    expect(h.title).toBe("Voice narration is unavailable");
    expect(h.explanation).toContain("speech service");
  });

  it("falls back to a de-camel-cased title + summary for unknown alerts", () => {
    const h = humanizeHealthAlert(
      alert({ alertname: "SomeNewRule" }, { summary: "Something is odd" }),
    );
    expect(h.title).toBe("Some New Rule");
    expect(h.explanation).toBe("Something is odd");
  });

  it("uses the generic impact line for ContainerDown on an unmapped job", () => {
    const h = humanizeHealthAlert(alert({ alertname: "ContainerDown", job: "new-service" }));
    expect(h.title).toBe("new-service is offline");
    expect(h.explanation).toContain("won't work until it's back");
  });
});

describe("friendlyServiceName", () => {
  it("prefers the JOB_PRESENTATION friendly name", () => {
    expect(friendlyServiceName({ job: "postgres" })).toBe("PostgreSQL");
  });

  it("falls back to the instance host when no job label exists", () => {
    expect(friendlyServiceName({ instance: "sandbox:3000" })).toBe("sandbox");
  });

  it("returns null when nothing identifies a service", () => {
    expect(friendlyServiceName({})).toBeNull();
  });
});

describe("buildHealthAlertCoworkerPrompt", () => {
  it("carries the raw alert facts so the user never transcribes jargon", () => {
    const prompt = buildHealthAlertCoworkerPrompt([
      alert(
        { alertname: "ContainerDown", job: "sandbox", severity: "critical" },
        { summary: "Service sandbox is down" },
      ),
      alert({ alertname: "VoiceServiceDown", severity: "warning" }),
    ]);
    expect(prompt).toContain("Sandbox is offline");
    expect(prompt).toContain("alert: ContainerDown");
    expect(prompt).toContain("service: Sandbox");
    expect(prompt).toContain("Service sandbox is down");
    expect(prompt).toContain("[critical]");
    expect(prompt).toContain("Voice narration is unavailable");
    expect(prompt).toContain("next step");
  });
});

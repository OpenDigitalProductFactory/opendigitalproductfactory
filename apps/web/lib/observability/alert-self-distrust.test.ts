import { describe, expect, it, vi } from "vitest";
import { screenAlertsForSelfDistrust } from "./alert-self-distrust";
import type { PlatformAlert } from "./alert-sources";

function alert(name: string): PlatformAlert {
  return {
    labels: { alertname: name, severity: "warning" },
    annotations: { summary: name },
    state: "firing",
    sourceSystem: "prometheus",
    activeAt: "2026-07-14T02:00:00Z",
  };
}

describe("screenAlertsForSelfDistrust", () => {
  it("keeps VoiceServiceDown when live feature state says narration is enabled", async () => {
    const screened = await screenAlertsForSelfDistrust([alert("VoiceServiceDown")], {
      isVoiceNarrationEnabled: async () => true,
    });

    expect(screened[0].labels.alertname).toBe("VoiceServiceDown");
    expect(screened[0].labels.detector_self_distrust).toBeUndefined();
  });

  it("converts VoiceServiceDown into a detector contradiction when narration is disabled", async () => {
    const screened = await screenAlertsForSelfDistrust([alert("VoiceServiceDown")], {
      isVoiceNarrationEnabled: async () => false,
    });

    expect(screened[0].labels.alertname).toBe("DetectorSelfDistrust");
    expect(screened[0].labels.service).toBe("VoiceServiceDown");
    expect(screened[0].labels.contradicted_alert).toBe("VoiceServiceDown");
    expect(screened[0].labels.detector_self_distrust).toBe("true");
    expect(screened[0].annotations.description).toMatch(/no ready voice profile/i);
  });

  it("keeps the original alert if the live-state checker is unavailable", async () => {
    const checker = vi.fn(async () => {
      throw new Error("db unavailable");
    });

    const screened = await screenAlertsForSelfDistrust([alert("VoiceServiceDown")], {
      isVoiceNarrationEnabled: checker,
    });

    expect(screened[0].labels.alertname).toBe("VoiceServiceDown");
    expect(screened[0].labels.detector_self_distrust).toBeUndefined();
  });

  it("does not run the voice checker for unrelated alerts", async () => {
    const checker = vi.fn(async () => false);

    const screened = await screenAlertsForSelfDistrust([alert("PostgresDown")], {
      isVoiceNarrationEnabled: checker,
    });

    expect(screened[0].labels.alertname).toBe("PostgresDown");
    expect(checker).not.toHaveBeenCalled();
  });
});

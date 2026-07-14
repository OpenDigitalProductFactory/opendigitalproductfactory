import { type PlatformAlert } from "@/lib/observability/alert-sources";
import { isVoiceNarrationEnabled } from "@/lib/voice-synthesis/service-status";

const DETECTOR_SELF_DISTRUST_ALERT = "DetectorSelfDistrust";

export interface AlertSelfDistrustDeps {
  isVoiceNarrationEnabled?: () => Promise<boolean>;
}

function detectorContradictionAlert(alert: PlatformAlert, reason: string): PlatformAlert {
  const contradictedAlert = alert.labels.alertname ?? "unknown";
  const sourceLabel = alert.labels.service || alert.labels.instance || alert.labels.job || contradictedAlert;
  return {
    ...alert,
    labels: {
      ...alert.labels,
      alertname: DETECTOR_SELF_DISTRUST_ALERT,
      severity: alert.labels.severity ?? "warning",
      service: sourceLabel,
      contradicted_alert: contradictedAlert,
      detector_self_distrust: "true",
    },
    annotations: {
      ...alert.annotations,
      summary: `Monitoring contradiction: ${contradictedAlert}`,
      description: reason,
    },
  };
}

async function screenOneAlert(
  alert: PlatformAlert,
  deps: Required<AlertSelfDistrustDeps>,
): Promise<PlatformAlert> {
  if (alert.labels.alertname !== "VoiceServiceDown") return alert;

  try {
    const narrationEnabled = await deps.isVoiceNarrationEnabled();
    if (narrationEnabled) return alert;
  } catch {
    // If the checker cannot read feature state, keep the original alert. A
    // self-distrust finding is only useful when grounded in contradictory live
    // evidence, not when the validator itself is blind.
    return alert;
  }

  return detectorContradictionAlert(
    alert,
    "Prometheus reported VoiceServiceDown, but the platform currently has no ready voice profile with narration enabled. Treat the monitor/gauge path as suspect instead of reporting a true TTS outage.",
  );
}

/**
 * Convert firing alerts that contradict live platform feature state into
 * detector-contradiction alerts. This keeps the monitor failure visible while
 * preventing a broken detector from masquerading as the feature's real state.
 */
export async function screenAlertsForSelfDistrust(
  alerts: PlatformAlert[],
  deps: AlertSelfDistrustDeps = {},
): Promise<PlatformAlert[]> {
  const resolvedDeps: Required<AlertSelfDistrustDeps> = {
    isVoiceNarrationEnabled: deps.isVoiceNarrationEnabled ?? isVoiceNarrationEnabled,
  };

  return await Promise.all(alerts.map((alert) => screenOneAlert(alert, resolvedDeps)));
}

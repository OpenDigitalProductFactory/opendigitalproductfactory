import { NextResponse } from "next/server";
import { fetchAlertSources, isMonitoringConfigured } from "@/lib/observability/alert-sources";
import { screenAlertsForSelfDistrust } from "@/lib/observability/alert-self-distrust";

export const dynamic = "force-dynamic";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
};

// Unified firing-alerts endpoint for the System Health UI (AlertBanner,
// PlatformHealthIndicator shell-nav dot, RecentAlertsPanel — all via
// useAlertQuery). Merges BOTH evaluators: Prometheus metric alerts AND the Loki
// ruler's log-rate/storm alerts (EP-FULL-OBS Tier 2, BI-5FE8656F item #6). This
// is what flips the shell-nav health dot on a container log storm — previously
// the dot only saw Prometheus and was blind to log-rate alerts.
//
// Resilient: one source being down never blanks the other. Only when BOTH are
// unreachable do we report the monitoring stack offline (503), matching the
// frontend's offline handling.

export async function GET() {
  const { alerts: rawAlerts, reached } = await fetchAlertSources();
  const alerts = await screenAlertsForSelfDistrust(rawAlerts);

  if (!reached.prometheus && !reached["loki-ruler"]) {
    // Distinguish "no monitoring stack configured on this topology" (expected on
    // a fresh/local install — neutral, non-alarming) from "configured but
    // unreachable" (a real outage worth a 503 + offline banner). BI-63FF58D2:
    // a persistent "Monitoring offline" chrome on an install that simply never
    // wired up Prometheus/Loki is a false-alarm default for a product we sell.
    if (!isMonitoringConfigured()) {
      return NextResponse.json(
        { status: "not-configured", data: { alerts: [] } },
        { headers: NO_CACHE_HEADERS },
      );
    }
    return NextResponse.json(
      { status: "error", error: "Monitoring stack unreachable", data: { alerts: [] } },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }

  return NextResponse.json(
    { status: "success", data: { alerts } },
    { headers: NO_CACHE_HEADERS },
  );
}

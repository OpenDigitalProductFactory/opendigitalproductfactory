import { NextResponse } from "next/server";
import { metricsRegistry } from "@/lib/metrics";
import { refreshVoiceTtsMetrics } from "@/lib/voice-synthesis/service-status";
import { refreshDependencyMetrics } from "@/lib/operate/dependency-health";
import { arrivedViaPublicHost } from "@/lib/canonical-host";

// Force dynamic: each scrape must reflect current state, and we refresh
// point-in-time health gauges below before serializing.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Metrics are for the internal Prometheus scraper (portal:3000). A request
  // that came in through the public hostname gets a 404, so an install made
  // reachable from the internet does not publish its operational detail.
  // Second layer behind the reachability ingress deny; see
  // docs/security/tool-evaluations/2026-09-29-cloudflare-tunnel.md (P3).
  if (
    arrivedViaPublicHost({
      host: request.headers.get("host"),
      forwardedHost: request.headers.get("x-forwarded-host"),
      canonicalUrl: process.env.PUBLIC_URL,
    })
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Refresh point-in-time service-health gauges (dpf_voice_tts_up/_enabled)
  // before serializing so a down /health-only sidecar (which can't be its own
  // scrape target) is visible to Prometheus. Fully guarded internally.
  await Promise.all([refreshVoiceTtsMetrics(), refreshDependencyMetrics()]);

  const metrics = await metricsRegistry.metrics();
  return new NextResponse(metrics, {
    headers: { "Content-Type": metricsRegistry.contentType },
  });
}

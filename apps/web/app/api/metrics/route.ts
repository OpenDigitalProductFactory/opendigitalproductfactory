import { NextResponse } from "next/server";
import { metricsRegistry } from "@/lib/metrics";
import { refreshVoiceTtsMetrics } from "@/lib/voice-synthesis/service-status";

// Force dynamic: each scrape must reflect current state, and we refresh
// point-in-time health gauges below before serializing.
export const dynamic = "force-dynamic";

export async function GET() {
  // Refresh point-in-time service-health gauges (dpf_voice_tts_up/_enabled)
  // before serializing so a down /health-only sidecar (which can't be its own
  // scrape target) is visible to Prometheus. Fully guarded internally.
  await refreshVoiceTtsMetrics();

  const metrics = await metricsRegistry.metrics();
  return new NextResponse(metrics, {
    headers: { "Content-Type": metricsRegistry.contentType },
  });
}

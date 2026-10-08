// Browser journey and web-vital samples (BI-BD0B0DCC). The portal measures
// operator journeys from interaction to first painted frame and posts them
// here in batches via navigator.sendBeacon; this route validates each sample
// against the closed vocabulary and records it into the shared prom-client
// registry scraped at /api/metrics.

import { auth } from "@/lib/auth";
import { apiErrorResponse } from "@/lib/api/error";
import { journeyDurationSeconds, webVitalCls, webVitalSeconds } from "@/lib/metrics";
import { parseJourneyBatch } from "@/lib/telemetry/parse-journey-batch";
import { portalSections } from "@/lib/telemetry/portal-sections";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return apiErrorResponse("UNAUTHORIZED", "Sign in to report telemetry", 401);
  }

  let body: unknown;
  try {
    // sendBeacon posts text/plain to avoid a CORS preflight; parse either way.
    body = JSON.parse(await request.text());
  } catch {
    return new Response(null, { status: 204 });
  }

  for (const sample of parseJourneyBatch(body, portalSections())) {
    if (sample.kind === "journey") {
      journeyDurationSeconds.observe({ journey: sample.journey, phase: "total" }, sample.totalMs / 1000);
      if (sample.serverMs !== undefined) {
        journeyDurationSeconds.observe({ journey: sample.journey, phase: "server" }, sample.serverMs / 1000);
      }
    } else if (sample.metric === "CLS") {
      webVitalCls.observe({ section: sample.section }, sample.value);
    } else {
      webVitalSeconds.observe({ metric: sample.metric, section: sample.section }, sample.value / 1000);
    }
  }
  return new Response(null, { status: 204 });
}

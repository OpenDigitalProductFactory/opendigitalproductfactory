import { NextResponse } from "next/server";

// Proxies Prometheus's /api/v1/targets so the portal can render the platform
// Health tab's Service Status grid driven by the actual scrape config — not a
// hardcoded list that drifts out of sync. Each "active target" carries
// instance + job labels, health (up/down/unknown), last scrape timestamp, and
// last error — everything the grid needs to render per-instance tiles.

export const dynamic = "force-dynamic";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  Pragma: "no-cache",
};

export async function GET() {
  try {
    const res = await fetch(`${PROMETHEUS_URL}/api/v1/targets?state=active`, {
      signal: AbortSignal.timeout(2_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      {
        status: "error",
        error: "Monitoring stack unreachable",
        data: { activeTargets: [] },
      },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
}

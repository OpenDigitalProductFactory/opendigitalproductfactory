import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
};

export async function GET() {
  try {
    const res = await fetch(`${PROMETHEUS_URL}/api/v1/alerts`, {
      signal: AbortSignal.timeout(2_000),
    });
    const data = await res.json();
    return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { status: "error", error: "Monitoring stack unreachable", data: { alerts: [] } },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
}

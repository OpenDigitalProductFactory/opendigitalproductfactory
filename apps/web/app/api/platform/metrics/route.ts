import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";
const NO_CACHE_HEADERS = {
  "Cache-Control": "no-cache, no-store, must-revalidate",
  "Pragma": "no-cache",
};

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400, headers: NO_CACHE_HEADERS });

  const type = req.nextUrl.searchParams.get("type") || "instant";
  const endpoint = type === "range" ? "/api/v1/query_range" : "/api/v1/query";

  const promUrl = new URL(endpoint, PROMETHEUS_URL);
  promUrl.searchParams.set("query", query);
  for (const [key, val] of req.nextUrl.searchParams.entries()) {
    if (key !== "type" && key !== "query") promUrl.searchParams.set(key, val);
  }

  try {
    const res = await fetch(promUrl.toString(), { signal: AbortSignal.timeout(2_000) });
    const data = await res.json();
    return NextResponse.json(data, { headers: NO_CACHE_HEADERS });
  } catch {
    return NextResponse.json(
      { status: "error", error: "Monitoring stack unreachable" },
      { status: 503, headers: NO_CACHE_HEADERS },
    );
  }
}

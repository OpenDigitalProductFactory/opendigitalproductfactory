import { NextRequest, NextResponse } from "next/server";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });

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
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { status: "error", error: "Monitoring stack unreachable" },
      { status: 503 },
    );
  }
}

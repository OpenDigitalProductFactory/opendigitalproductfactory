import { NextResponse } from "next/server";

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "http://prometheus:9090";

export async function GET() {
  try {
    const res = await fetch(`${PROMETHEUS_URL}/api/v1/targets`, {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { status: "error", error: "Monitoring stack unreachable" },
      { status: 503 },
    );
  }
}

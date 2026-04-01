import { NextResponse } from "next/server";
import { metricsRegistry } from "@/lib/metrics";

export async function GET() {
  const metrics = await metricsRegistry.metrics();
  return new NextResponse(metrics, {
    headers: { "Content-Type": metricsRegistry.contentType },
  });
}

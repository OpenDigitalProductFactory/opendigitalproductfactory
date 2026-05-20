// POST /api/v1/edge/metrics — receive network telemetry from edge nodes.
// GET  /api/v1/edge/metrics — retrieve cached metrics (portal / monitoring).
//
// POST is authenticated with a dpfedge_ bearer token (scope: edge:metrics).
// GET  is authenticated with a standard session or API key.
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   § REST ingestion controls, § Metrics endpoint

import { NextResponse, type NextRequest } from "next/server";

import { edgeMetricsPayloadSchema } from "@dpf/validators";

import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { metricsCache } from "@/lib/edge/metrics-cache";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authResult = await resolveEdgeNodeAuth(
    request.headers.get("authorization"),
    "edge:metrics",
  );
  if (!authResult.ok) {
    const status = authResult.error === "scope_disallowed" ? 403 : 401;
    return NextResponse.json(
      { ok: false, error: authResult.error, message: authResult.message },
      { status },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const parsed = edgeMetricsPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_payload",
        issues: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  const payload = parsed.data;

  // Enforce: the nodeId in the payload must match the authenticated node.
  if (payload.nodeId !== authResult.nodeId) {
    return NextResponse.json(
      {
        ok: false,
        error: "node_id_mismatch",
        message: "Payload nodeId does not match authenticated node",
      },
      { status: 403 },
    );
  }

  metricsCache.set(payload.nodeId, {
    ...payload,
    receivedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      ok: true,
      nodeId: payload.nodeId,
      received: true,
      metricsCount: payload.metrics?.network?.length ?? 0,
      peersCount: payload.discovery?.lldp?.length ?? 0,
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Metrics read is portal-only (session auth). Edge nodes don't read
  // back their own metrics — they only POST.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const nodeId = request.nextUrl.searchParams.get("nodeId");

  if (nodeId) {
    const metrics = metricsCache.get(nodeId);
    if (!metrics) {
      return NextResponse.json(
        { ok: false, error: "not_found", message: "No cached metrics for this node" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, metrics }, { status: 200 });
  }

  const allMetrics = metricsCache.getAll();
  return NextResponse.json(
    { ok: true, nodes: allMetrics.length, metrics: allMetrics },
    { status: 200 },
  );
}

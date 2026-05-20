// POST /api/v1/edge/heartbeat
//
// Edge Node keep-alive. Updates lastSeenAt; flips a pending node to
// active on first call. Optionally accepts per-capability self-reports
// from the agent. Returns the current Authority-decided intervals and
// the accepted-capability set so the agent can adjust on the fly.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Edge Node lifecycle (heartbeat).

import { NextResponse, type NextRequest } from "next/server";

import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { writeEdgeNodeAudit } from "@/lib/edge-node/audit";
import { recordHeartbeat } from "@/lib/edge-node/enrollment";
import { checkEdgeRateLimit } from "@/lib/edge-node/rate-limit";
import { HeartbeatBody } from "@/lib/edge-node/wire-contract";

const ROUTE_CONTEXT = "/api/v1/edge/heartbeat";

// HeartbeatBody schema lives at @/lib/edge-node/wire-contract so both
// this route and the cross-runtime parity test import the same shape.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const authResult = await resolveEdgeNodeAuth(
    request.headers.get("authorization"),
    "edge:heartbeat",
  );
  if (!authResult.ok) {
    const status = heartbeatAuthStatus(authResult.error);
    await writeEdgeNodeAudit({
      route: "edge.heartbeat",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
      status,
      success: false,
      error: authResult.error,
      summary: { scope: "edge:heartbeat" },
    });
    return NextResponse.json(
      { ok: false, error: authResult.error, message: authResult.message },
      { status },
    );
  }

  // Per-node rate limit: 12/min per the spec § REST ingestion controls.
  // Fires AFTER auth so we can attribute to a specific Edge Node.
  const rateLimit = checkEdgeRateLimit(
    "edge.heartbeat",
    authResult.edgeNodeRowId,
  );
  if (!rateLimit.allowed) {
    await writeEdgeNodeAudit({
      route: "edge.heartbeat",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: authResult.edgeNodeRowId,
      nodeId: authResult.nodeId,
      principalId: null,
      status: 429,
      success: false,
      error: "rate_limited",
      summary: { retryAfter: rateLimit.retryAfter, ceiling: "12/min" },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "rate_limited",
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) },
      },
    );
  }

  // Body is optional — heartbeat with no body is valid (just an
  // I'm-still-here ping).
  let body: unknown = {};
  try {
    const text = await request.text();
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    await writeEdgeNodeAudit({
      route: "edge.heartbeat",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: authResult.edgeNodeRowId,
      nodeId: authResult.nodeId,
      principalId: null,
      status: 400,
      success: false,
      error: "invalid_json",
    });
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const parsed = HeartbeatBody.safeParse(body);
  if (!parsed.success) {
    await writeEdgeNodeAudit({
      route: "edge.heartbeat",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: authResult.edgeNodeRowId,
      nodeId: authResult.nodeId,
      principalId: null,
      status: 400,
      success: false,
      error: "invalid_body",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_body",
        issues: parsed.error.format(),
      },
      { status: 400 },
    );
  }

  const result = await recordHeartbeat({
    edgeNodeId: authResult.edgeNodeRowId,
    ...(parsed.data.capabilityReports !== undefined
      ? { capabilityReports: parsed.data.capabilityReports }
      : {}),
  });

  await writeEdgeNodeAudit({
    route: "edge.heartbeat",
    routeContext: ROUTE_CONTEXT,
    startedAt,
    edgeNodeId: authResult.edgeNodeRowId,
    nodeId: authResult.nodeId,
    principalId: null,
    status: 200,
    success: true,
    summary: {
      trustState: authResult.trustState,
      capabilityReportCount: parsed.data.capabilityReports?.length ?? 0,
      acceptedCapabilities: result.acceptedCapabilities,
    },
  });
  return NextResponse.json(
    {
      ok: true,
      heartbeatIntervalSec: result.heartbeatIntervalSec,
      sweepIntervalSec: result.sweepIntervalSec,
      acceptedCapabilities: result.acceptedCapabilities,
      trustState: authResult.trustState,
    },
    { status: 200 },
  );
}

function heartbeatAuthStatus(
  error:
    | "missing_authorization"
    | "invalid_scheme"
    | "invalid_token_format"
    | "token_not_found"
    | "node_revoked"
    | "scope_disallowed",
): number {
  if (error === "scope_disallowed") return 403;
  return 401;
}

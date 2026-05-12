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
import { z } from "zod";

import {
  EDGE_NODE_CAPABILITY_STATUSES,
  RESERVED_CAPABILITIES,
} from "@dpf/db/edge-node-types";

import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { writeEdgeNodeAudit } from "@/lib/edge-node/audit";
import { recordHeartbeat } from "@/lib/edge-node/enrollment";

const ROUTE_CONTEXT = "/api/v1/edge/heartbeat";

const HeartbeatBody = z
  .object({
    capabilityReports: z
      .array(
        z.object({
          capability: z.enum(RESERVED_CAPABILITIES),
          status: z.enum(EDGE_NODE_CAPABILITY_STATUSES),
          evidence: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
  })
  .default({});

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

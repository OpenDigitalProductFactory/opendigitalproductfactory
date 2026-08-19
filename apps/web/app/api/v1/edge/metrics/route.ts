// POST /api/v1/edge/metrics — receive network telemetry from edge nodes.
// GET  /api/v1/edge/metrics — retrieve cached metrics (portal / monitoring).
//
// Security controls per spec §6.2 and §11:
//   - POST authenticated with dpfedge_ bearer token (scope: edge:metrics, trust=trusted)
//   - Body size cap: 64 KB
//   - Payload freshness: observedAt within 5 minutes of server time
//   - Per-node rate limit: ≥ 5 s between accepted requests
//   - nodeId: resolved from token; body nodeId is ignored
//
// Spec: docs/superpowers/specs/2026-05-19-edge-node-network-telemetry-adapters-design.md
//   §6.1 MetricsEnvelope, §6.2 Portal Ingestion, §11 Security

import { NextResponse, type NextRequest } from "next/server";

import { metricsEnvelopeSchema } from "@dpf/validators";

import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { metricsCache } from "@/lib/edge-node/metrics-cache";
import {
  getEdgeMetricsRateLimit,
  markEdgeMetricsAccepted,
} from "@/lib/edge-node/metrics-rate-limit";

const BODY_SIZE_CAP_BYTES = 64 * 1024; // 64 KB per spec §11
const FRESHNESS_WINDOW_MS = 5 * 60 * 1000; // 5 minutes per spec §11

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Body size check (before auth — avoids large JSON.parse on denial)
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > BODY_SIZE_CAP_BYTES) {
    return NextResponse.json(
      { ok: false, error: "payload_too_large", maxBytes: BODY_SIZE_CAP_BYTES },
      { status: 413 },
    );
  }

  // 2. Auth
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

  const { nodeId } = authResult;

  // 3. Per-node rate limit
  const rateLimit = getEdgeMetricsRateLimit(nodeId);
  if (rateLimit.limited) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", retryAfterSec: rateLimit.retryAfterSec },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSec) },
      },
    );
  }

  // 4. Parse body (guarded by size cap above)
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  // 5. Validate envelope shape
  const parsed = metricsEnvelopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid_envelope",
        issues: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  // 6. Freshness check
  const observedAgeMs = Math.abs(Date.now() - new Date(parsed.data.observedAt).getTime());
  if (observedAgeMs > FRESHNESS_WINDOW_MS) {
    return NextResponse.json(
      {
        ok: false,
        error: "stale_payload",
        message: `observedAt is ${Math.round(observedAgeMs / 1000)} s from server time; max ${FRESHNESS_WINDOW_MS / 1000} s`,
      },
      { status: 422 },
    );
  }

  // 7. Accept and cache (nodeId always from token, never from body)
  markEdgeMetricsAccepted(nodeId);
  metricsCache.set(nodeId, parsed.data);

  // 8. TODO(spec §6.3): broadcast topology:metrics:update WebSocket event
  // broadcastTopologyMetrics({ nodeId, interfaces: parsed.data.interfaces, observedAt: parsed.data.observedAt });

  return NextResponse.json(
    {
      ok: true,
      runKey: parsed.data.runKey,
      nodeId,
      interfaceCount: parsed.data.interfaces.length,
    },
    { status: 200 },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Portal-only read — session auth.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const nodeId = request.nextUrl.searchParams.get("nodeId");

  if (nodeId) {
    const entry = metricsCache.get(nodeId);
    if (!entry) {
      return NextResponse.json(
        { ok: false, error: "not_found", message: "No cached metrics for this node" },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, metrics: entry }, { status: 200 });
  }

  const all = metricsCache.getAll();
  return NextResponse.json(
    { ok: true, nodes: all.length, metrics: all },
    { status: 200 },
  );
}

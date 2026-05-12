// POST /api/v1/edge/heartbeat
//
// Authenticated heartbeat + token rotation. The Edge Node posts:
//   - Authorization: Bearer dpfedge_<current-node-token>
//   - body: { agentVersion, reportedReachability? }
//
// The Authority Core validates the current token, rotates it (issues a
// fresh node token, stamps `rotatedAt` on the previous one — accepted
// within the rotation-grace window so a lost heartbeat response doesn't
// lock the node out), updates `EdgeNode.lastSeenAt` + `version`, and
// returns the fresh token.
//
// Quarantined nodes are explicitly allowed to call heartbeat (so the
// operator can see the node is alive) but blocked from every other route
// per the spec's quarantine policy.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// (Token namespaces and lifecycle + Quarantine).

import { NextResponse, type NextRequest } from "next/server";

import { authenticateEdgeRequest } from "@/lib/edge-nodes/auth";
import { heartbeatEdgeNode } from "@/lib/edge-nodes/heartbeat";

export const dynamic = "force-dynamic";

function extractBearer(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/.exec(header);
  return match ? (match[1] ?? null) : null;
}

export async function POST(request: NextRequest) {
  const auth = await authenticateEdgeRequest(request, "edge:heartbeat");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const agentVersion = typeof payload.agentVersion === "string" ? payload.agentVersion : "";
  if (!agentVersion) {
    return NextResponse.json({ ok: false, error: "missing_agent_version" }, { status: 400 });
  }

  const currentToken = extractBearer(request);
  if (!currentToken) {
    // Caught by authenticateEdgeRequest already, but defense-in-depth.
    return NextResponse.json({ ok: false, error: "missing_bearer" }, { status: 401 });
  }

  const reportedReachability =
    payload.reportedReachability === "ok"
    || payload.reportedReachability === "degraded"
    || payload.reportedReachability === "offline"
      ? (payload.reportedReachability as "ok" | "degraded" | "offline")
      : undefined;

  const result = await heartbeatEdgeNode({
    authContext: auth.context,
    currentTokenPlaintext: currentToken,
    agentVersion,
    ...(reportedReachability ? { reportedReachability } : {}),
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    trustState: result.trustState,
    lastSeenAt: result.lastSeenAt.toISOString(),
    rotatedToken: {
      token: result.rotatedToken.plaintext,
      prefix: result.rotatedToken.prefix,
      expiresAt: result.rotatedToken.expiresAt.toISOString(),
      scopes: result.rotatedToken.scopes,
    },
  });
}

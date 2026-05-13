// POST /api/v1/edge/enroll
//
// Edge Node enrollment endpoint. Accepts a bootstrap token (Authorization:
// Bearer dpfboot_<secret>) plus the agent's environment fingerprint and
// advertised capability set. Returns the new EdgeNode's stable nodeId,
// a plaintext machine-bound dpfedge_* node token (shown exactly once),
// and Authority-decided heartbeat + sweep intervals.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Enrollment, rotation, and lifecycle
//
// Phase 0 limits per the roadmap (PR #493):
//   - Only `discovery.network` capability accepted
//   - Auto-approval is OFF by default; the bootstrap token's issuance
//     context (operator action vs installer-issued local-host) decides
//     via the `autoApprove` flag in the issuance call

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  EDGE_NODE_INSTALL_MODES,
  EDGE_NODE_PLATFORMS,
} from "@dpf/db/edge-node-types";

import { writeEdgeNodeAudit } from "@/lib/edge-node/audit";
import { enrollEdgeNode } from "@/lib/edge-node/enrollment";

const ROUTE_CONTEXT = "/api/v1/edge/enroll";

// We expect the bootstrap token in the Authorization: Bearer header
// (consistent with the rest of the dpf*_ token family) AND we accept
// the request body with the agent's enrollment claims.
//
// We DO NOT accept the bootstrap token in the request body to avoid
// the operator-pasted-token-leaking-into-logs anti-pattern.

const EnrollBody = z.object({
  displayName: z.string().min(1).max(200),
  platform: z.enum(EDGE_NODE_PLATFORMS),
  installMode: z.enum(EDGE_NODE_INSTALL_MODES),
  version: z.string().min(1).max(40),
  advertisedCapabilities: z.array(z.string().min(1)).min(1),
  hostFingerprint: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  // Bootstrap-token extraction — header only.
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    await writeEdgeNodeAudit({
      route: "edge.enroll",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
      status: 401,
      success: false,
      error: "missing_authorization",
    });
    return NextResponse.json(
      { ok: false, error: "missing_authorization" },
      { status: 401 },
    );
  }
  const match = /^Bearer\s+(.+)$/.exec(authHeader.trim());
  if (!match) {
    await writeEdgeNodeAudit({
      route: "edge.enroll",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
      status: 401,
      success: false,
      error: "invalid_scheme",
    });
    return NextResponse.json(
      { ok: false, error: "invalid_scheme" },
      { status: 401 },
    );
  }
  const bootstrapToken = match[1]!.trim();

  // Body validation.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await writeEdgeNodeAudit({
      route: "edge.enroll",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
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
  const parsed = EnrollBody.safeParse(body);
  if (!parsed.success) {
    await writeEdgeNodeAudit({
      route: "edge.enroll",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
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

  // Phase 0 does not auto-approve via this route — the bootstrap-token
  // metadata decides. Local-host installer-issued tokens carry an
  // implicit auto-approve flag in the issuance path; for Phase 0 we
  // default to operator-approval (`autoApprove: false`). Future
  // refinement may read a flag off the BootstrapToken row to make this
  // explicit per token; punting until A7's portal UI lands.
  const result = await enrollEdgeNode({
    bootstrapToken,
    displayName: parsed.data.displayName,
    platform: parsed.data.platform,
    installMode: parsed.data.installMode,
    version: parsed.data.version,
    advertisedCapabilities: parsed.data.advertisedCapabilities,
    ...(parsed.data.hostFingerprint !== undefined
      ? { hostFingerprint: parsed.data.hostFingerprint }
      : {}),
    ...(parsed.data.metadata !== undefined
      ? { metadata: parsed.data.metadata }
      : {}),
    autoApprove: false,
  });

  if (!result.ok) {
    const status = mapEnrollErrorStatus(result.error);
    await writeEdgeNodeAudit({
      route: "edge.enroll",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
      status,
      success: false,
      error: result.error,
      summary: {
        platform: parsed.data.platform,
        installMode: parsed.data.installMode,
        // Bootstrap-token-related errors carry the prefix only — never
        // log the plaintext bearer. The token is hashed at lookup so we
        // could log the hash if needed; declining for now to keep audit
        // rows lean.
      },
    });
    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status },
    );
  }

  await writeEdgeNodeAudit({
    route: "edge.enroll",
    routeContext: ROUTE_CONTEXT,
    startedAt,
    edgeNodeId: result.edgeNodeId,
    nodeId: result.nodeId,
    principalId: null, // enrollEdgeNode result does not currently expose principalId; can wire in later
    status: 200,
    success: true,
    summary: {
      platform: parsed.data.platform,
      installMode: parsed.data.installMode,
      trustState: result.trustState,
      acceptedCapabilities: result.acceptedCapabilities,
    },
  });
  return NextResponse.json(
    {
      ok: true,
      nodeId: result.nodeId,
      nodeToken: result.nodeToken,
      trustState: result.trustState,
      heartbeatIntervalSec: result.heartbeatIntervalSec,
      sweepIntervalSec: result.sweepIntervalSec,
      acceptedCapabilities: result.acceptedCapabilities,
    },
    { status: 200 },
  );
}

function mapEnrollErrorStatus(
  error:
    | "invalid_token_format"
    | "token_not_found"
    | "token_expired"
    | "token_already_consumed"
    | "token_revoked"
    | "invalid_platform"
    | "invalid_install_mode"
    | "no_acceptable_capabilities",
): number {
  switch (error) {
    case "invalid_token_format":
    case "token_not_found":
    case "token_expired":
    case "token_already_consumed":
    case "token_revoked":
      return 401;
    case "invalid_platform":
    case "invalid_install_mode":
    case "no_acceptable_capabilities":
      return 400;
  }
}

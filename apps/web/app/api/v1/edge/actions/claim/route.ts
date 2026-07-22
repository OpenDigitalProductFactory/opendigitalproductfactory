// POST /api/v1/edge/actions/claim — EP-REMOTE-ACTION P2 (read-only pull channel).
//
// A trusted, action.execute-enabled Edge Node POLLS for the queued read-only
// RemoteActions in its estate scope and atomically claims them (PULL, not a
// downward push — no inbound-to-Edge port). Flag-gated OFF
// (DPF_REMOTE_ACTION_DISPATCH_ENABLED) so the channel is unreachable until the
// founder turns it on for the two-instance verification. Read-only inventory is
// the default; the two closed organization-join actions additionally require a
// named node, host role, high-risk approval, and an approved ChangeRequest.
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";
import { isDispatchActionType, type ClaimingNodeView } from "@dpf/db/remote-action-dispatch";

import { resolveEdgeNodeMtls, type EdgeNodeMtlsDb } from "@/lib/auth/edge-node-mtls";
import { loadEdgeMtlsProxySecret } from "@/lib/auth/edge-mtls-proxy-secret";
import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { claimActionsForNode, type DispatchOrchestratorDb } from "@/lib/remote-action/dispatch-orchestrator";
import { loadEdgeActionSigner } from "@/lib/remote-action/action-signing-key";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

const BODY_SIZE_CAP_BYTES = 4 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) {
    return NextResponse.json({ ok: false, error: "remote_action_dispatch_disabled" }, { status: 404 });
  }

  const authz = await resolveEdgeNodeAuth(request.headers.get("authorization"), "edge:actions:claim");
  if (!authz.ok) {
    return NextResponse.json(
      { ok: false, error: authz.error, message: authz.message },
      { status: authz.error === "scope_disallowed" ? 403 : 401 },
    );
  }

  let proxySecret: string;
  try {
    proxySecret = loadEdgeMtlsProxySecret();
  } catch {
    return NextResponse.json({ ok: false, error: "machine_authentication_unavailable" }, { status: 503 });
  }
  const mtls = await resolveEdgeNodeMtls(
    request.headers,
    authz.edgeNodeRowId,
    prisma as unknown as EdgeNodeMtlsDb,
    { proxySecret },
  );
  if (!mtls.ok) {
    return NextResponse.json({ ok: false, error: "machine_authentication_failed" }, { status: 401 });
  }

  // Optional { limit } body; absent/invalid/oversized → default batch.
  let limit: number | undefined;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 0 && contentLength <= BODY_SIZE_CAP_BYTES) {
    try {
      const body = (await request.json()) as { limit?: unknown };
      if (typeof body?.limit === "number" && Number.isFinite(body.limit)) limit = body.limit;
    } catch {
      /* empty/invalid JSON → default limit */
    }
  }

  // action.execute must be EXPLICITLY enabled for this node (default off — threat
  // model §5 R3). No row in mode=enabled ⇒ the node claims nothing.
  const cap = await prisma.edgeNodeCapability.findFirst({
    where: { edgeNodeId: authz.edgeNodeRowId, capability: "action.execute", mode: "enabled" },
    select: { id: true, evidence: true },
  });

  const configuredActionTypes = Array.isArray(authz.scopePolicy?.actionTypes)
    ? authz.scopePolicy.actionTypes.filter(
        (value): value is string => typeof value === "string" && isDispatchActionType(value),
      )
    : [];

  const node: ClaimingNodeView = {
    edgeNodeId: authz.edgeNodeRowId,
    nodeId: authz.nodeId,
    trustState: authz.trustState,
    customerAccountId: authz.customerAccountId,
    customerSiteId: authz.customerSiteId,
    actionExecuteEnabled: cap !== null,
    allowedActionTypes: configuredActionTypes,
    organizationTrustRole: organizationTrustRole(cap?.evidence),
  };

  let signer;
  try {
    signer = loadEdgeActionSigner();
  } catch {
    return NextResponse.json({ ok: false, error: "action_signing_unavailable" }, { status: 503 });
  }

  const result = await claimActionsForNode(
    prisma as unknown as DispatchOrchestratorDb,
    node,
    limit !== undefined ? { limit, signer } : { signer },
  );

  return NextResponse.json(
    { ok: true, nodeId: authz.nodeId, claimed: result.claimed, skipped: result.skipped },
    { status: 200 },
  );
}

function organizationTrustRole(value: unknown): "authority" | "member" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const role = (value as Record<string, unknown>).organizationTrustRole;
  return role === "authority" || role === "member" ? role : null;
}

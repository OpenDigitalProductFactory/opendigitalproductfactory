// GET /api/v1/edge/adapters
//
// Returns the active DiscoveryConnection rows the calling Edge Node
// should run, with `apiKey` decrypted server-side using the portal's
// CREDENTIAL_ENCRYPTION_KEY. Replaces the legacy bind-mounted
// /etc/dpf-edge/adapters.json — see BI-35de9ce8 for the consolidation
// rationale.
//
// Trust gate: scope=edge:adapters requires trustState=trusted. Pending
// and quarantined nodes cannot read adapter credentials.
//
// Rate limit: 12/min per node (same as heartbeat). Adapter polling is
// once per sweep (~5 min) so this is generous.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";

import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { writeEdgeNodeAudit } from "@/lib/edge-node/audit";
import { checkEdgeRateLimit } from "@/lib/edge-node/rate-limit";
import { decryptSecret } from "@/lib/govern/credential-crypto";

const ROUTE_CONTEXT = "/api/v1/edge/adapters";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const authResult = await resolveEdgeNodeAuth(
    request.headers.get("authorization"),
    "edge:adapters",
  );
  if (!authResult.ok) {
    const status = adapterAuthStatus(authResult.error);
    await writeEdgeNodeAudit({
      route: "edge.adapters",
      routeContext: ROUTE_CONTEXT,
      startedAt,
      edgeNodeId: null,
      nodeId: null,
      principalId: null,
      status,
      success: false,
      error: authResult.error,
      summary: { scope: "edge:adapters" },
    });
    return NextResponse.json(
      { ok: false, error: authResult.error, message: authResult.message },
      { status },
    );
  }

  const rateLimit = checkEdgeRateLimit("edge.adapters", authResult.edgeNodeRowId);
  if (!rateLimit.allowed) {
    await writeEdgeNodeAudit({
      route: "edge.adapters",
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
      { ok: false, error: "rate_limited", retryAfter: rateLimit.retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter ?? 60) },
      },
    );
  }

  // For Phase 0 every trusted node sees every active unifi connection.
  // BI-35de9ce8 follow-up adds targetEdgeNodeId routing; until then
  // operators with multiple edge nodes will see duplicate work, which
  // is observable + harmless (idempotent upserts on InventoryEntity).
  const rows = await prisma.discoveryConnection.findMany({
    where: { collectorType: "unifi", status: "active" },
    select: {
      id: true,
      connectionKey: true,
      name: true,
      collectorType: true,
      endpointUrl: true,
      encryptedApiKey: true,
      configuration: true,
    },
  });

  const adapters: Array<{
    id: string;
    connectionKey: string;
    name: string;
    collectorType: "unifi";
    endpointUrl: string;
    apiKey: string;
    configuration: { site: string; discoverClients: boolean; tlsInsecure: boolean };
  }> = [];
  let skippedNoKey = 0;
  let skippedUndecryptable = 0;

  for (const row of rows) {
    if (!row.encryptedApiKey) {
      skippedNoKey++;
      continue;
    }
    const apiKey = decryptSecret(row.encryptedApiKey);
    if (!apiKey) {
      skippedUndecryptable++;
      continue;
    }
    const cfg = (row.configuration ?? {}) as Record<string, unknown>;
    adapters.push({
      id: row.id,
      connectionKey: row.connectionKey,
      name: row.name,
      collectorType: "unifi",
      endpointUrl: row.endpointUrl,
      apiKey,
      configuration: {
        site: (cfg.site as string | undefined) ?? "default",
        discoverClients: (cfg.discoverClients as boolean | undefined) ?? true,
        tlsInsecure: (cfg.tlsInsecure as boolean | undefined) ?? false,
      },
    });
  }

  await writeEdgeNodeAudit({
    route: "edge.adapters",
    routeContext: ROUTE_CONTEXT,
    startedAt,
    edgeNodeId: authResult.edgeNodeRowId,
    nodeId: authResult.nodeId,
    principalId: null,
    status: 200,
    success: true,
    summary: {
      adapterCount: adapters.length,
      skippedNoKey,
      skippedUndecryptable,
    },
  });

  return NextResponse.json({ ok: true, adapters }, { status: 200 });
}

function adapterAuthStatus(
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

// POST /api/v1/edge/discovery-runs
//
// Discovery observation ingestion. The Edge Node posts:
//   - Authorization: Bearer dpfedge_<node-token> (requires discovery:submit scope)
//   - body: { nodeId, agentMode, agentVersion, observedAt, capabilities,
//            items, relationships?, warnings? }
//
// The server does NOT rerun collectors — it normalizes the submitted
// envelope and persists with `edgeNodeId` stamped on the resulting
// DiscoveryRun row so observations are attributable.
//
// Trust-state gating: a quarantined node returns 403 (per the spec's
// quarantine policy — submissions never enter trusted inventory from a
// quarantined node).
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
// (Ingestion contract: submit observations, don't trigger sweeps).

import { NextResponse, type NextRequest } from "next/server";

import { authenticateEdgeRequest } from "@/lib/edge-nodes/auth";
import { submitObservations } from "@/lib/edge-nodes/submit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await authenticateEdgeRequest(request, "discovery:submit");
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const envelope = {
    nodeId: typeof payload.nodeId === "string" ? payload.nodeId : "",
    agentMode: typeof payload.agentMode === "string" ? payload.agentMode : "",
    agentVersion: typeof payload.agentVersion === "string" ? payload.agentVersion : "",
    observedAt: typeof payload.observedAt === "string" ? payload.observedAt : "",
    capabilities: Array.isArray(payload.capabilities)
      ? (payload.capabilities as unknown[]).filter((c): c is string => typeof c === "string")
      : [],
    items: Array.isArray(payload.items) ? (payload.items as unknown[]) : [],
    relationships: Array.isArray(payload.relationships)
      ? (payload.relationships as unknown[])
      : [],
    warnings: Array.isArray(payload.warnings) ? (payload.warnings as unknown[]) : [],
  };

  const result = await submitObservations({
    authContext: auth.context,
    envelope,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    {
      ok: true,
      runId: result.runId,
      itemCount: result.itemCount,
      relationshipCount: result.relationshipCount,
      summary: result.summary,
    },
    { status: 201 },
  );
}

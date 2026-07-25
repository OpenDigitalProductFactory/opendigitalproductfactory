// POST /api/v1/edge/actions/result — EP-REMOTE-ACTION P2 (read-only pull channel).
//
// A node reports the outcome of a RemoteAction it CLAIMED: a `running` heartbeat
// or a terminal `succeeded`/`failed` with evidence. recordActionResult verifies
// the action is bound to THIS node (claim ownership) and the transition is legal.
// Flag-gated OFF (DPF_REMOTE_ACTION_DISPATCH_ENABLED). This route only records
// what the node did; the native Edge handler owns any host mutation.
//
// Spec: docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md.

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@dpf/db";

import { resolveEdgeNodeMtls, type EdgeNodeMtlsDb } from "@/lib/auth/edge-node-mtls";
import { loadEdgeMtlsProxySecret } from "@/lib/auth/edge-mtls-proxy-secret";
import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { recordActionResult, type DispatchOrchestratorDb } from "@/lib/remote-action/dispatch-orchestrator";
import { envFlagEnabled } from "@/lib/runtime/env-flags";

const BODY_SIZE_CAP_BYTES = 96 * 1024; // accommodates the bounded 64 KiB join package plus JSON framing
const OUTCOMES = ["running", "succeeded", "failed"] as const;

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) {
    return NextResponse.json({ ok: false, error: "remote_action_dispatch_disabled" }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > BODY_SIZE_CAP_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large", maxBytes: BODY_SIZE_CAP_BYTES }, { status: 413 });
  }

  const authz = await resolveEdgeNodeAuth(request.headers.get("authorization"), "edge:actions:report");
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

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody, "utf8") > BODY_SIZE_CAP_BYTES) {
    return NextResponse.json({ ok: false, error: "payload_too_large", maxBytes: BODY_SIZE_CAP_BYTES }, { status: 413 });
  }
  let body: { actionKey?: unknown; outcome?: unknown; evidence?: unknown; result?: unknown };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const actionKey = typeof body?.actionKey === "string" ? body.actionKey : "";
  const outcome = (OUTCOMES as readonly string[]).includes(body?.outcome as string)
    ? (body.outcome as "running" | "succeeded" | "failed")
    : null;
  if (!actionKey || !outcome) {
    return NextResponse.json(
      { ok: false, error: "invalid_body", message: "actionKey + outcome (running|succeeded|failed) required" },
      { status: 422 },
    );
  }
  const evidence =
    body?.evidence && typeof body.evidence === "object" ? (body.evidence as Record<string, unknown>) : undefined;

  const result =
    body?.result && typeof body.result === "object" && !Array.isArray(body.result)
      ? (body.result as Record<string, unknown>)
      : undefined;

  const res = await recordActionResult(prisma as unknown as DispatchOrchestratorDb, {
    actionKey,
    edgeNodeRowId: authz.edgeNodeRowId,
    outcome,
    ...(evidence ? { evidence } : {}),
    ...(result ? { result } : {}),
  });
  if (!res.ok) {
    const status =
      res.reason === "action-not-found" ? 404 : res.reason === "not-claimed-by-this-node" ? 403 : 409;
    return NextResponse.json({ ok: false, error: res.reason }, { status });
  }

  return NextResponse.json({ ok: true, actionKey, status: res.status }, { status: 200 });
}

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@dpf/db";
import type { SignedEdgeActionEnvelope } from "@dpf/db/edge-action-envelope";
import { parseManagedInferenceTransitionParameters } from "@dpf/db/remote-action-dispatch";
import { resolveEdgeNodeMtls, type EdgeNodeMtlsDb } from "@/lib/auth/edge-node-mtls";
import { loadEdgeMtlsProxySecret } from "@/lib/auth/edge-mtls-proxy-secret";
import { resolveEdgeNodeAuth } from "@/lib/auth/edge-node-token";
import { loadEdgeActionSigner } from "@/lib/remote-action/action-signing-key";
import { issueManagedInferenceAdmission, managedInferenceProviderDigest, parseManagedInferenceAdmissionBinding } from "@/lib/remote-action/managed-inference-admission";
import { envFlagEnabled } from "@/lib/runtime/env-flags";
import { isRecord } from "@/lib/shared/coerce";
import { parseQuiescenceConfig } from "@/lib/self-upgrade/quiescence";

// No lease renewal or host effect. The existing host keeper must retain its
// actual running reservation; this route only signs a short-lived observation.
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!envFlagEnabled(process.env, "DPF_REMOTE_ACTION_DISPATCH_ENABLED")) {
    return NextResponse.json({ ok: false, error: "remote_action_dispatch_disabled" }, { status: 404 });
  }
  const auth = await resolveEdgeNodeAuth(request.headers.get("authorization"), "edge:actions:claim");
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.error === "scope_disallowed" ? 403 : 401 });
  try {
    const mtls = await resolveEdgeNodeMtls(request.headers, auth.edgeNodeRowId, prisma as unknown as EdgeNodeMtlsDb,
      { proxySecret: loadEdgeMtlsProxySecret() });
    if (!mtls.ok) return NextResponse.json({ ok: false, error: "machine_authentication_failed" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, error: "machine_authentication_unavailable" }, { status: 503 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16384) {
    return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
  }
  let envelope: SignedEdgeActionEnvelope;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 16384) return NextResponse.json({ ok: false, error: "payload_too_large" }, { status: 413 });
    const body: unknown = JSON.parse(text);
    if (!isRecord(body) || Object.keys(body).join(",") !== "envelope" || !isRecord(body.envelope)
      || body.envelope.nodeId !== auth.nodeId || typeof body.envelope.actionKey !== "string"
      || !/^[A-Za-z][A-Za-z0-9_-]{1,95}$/.test(body.envelope.actionKey)) throw new Error("invalid");
    envelope = body.envelope as unknown as SignedEdgeActionEnvelope;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_envelope" }, { status: 422 });
  }
  try {
    const signer = loadEdgeActionSigner();
    const admission = await prisma.$transaction(async tx => {
      const now = new Date();
      const row = await tx.remoteAction.findUnique({ where: { actionKey: envelope.actionKey } });
      if (!row || row.edgeNodeId !== auth.edgeNodeRowId || !row.changeRequestId || !isRecord(row.evidence)) throw new Error("unavailable");
      const binding = parseManagedInferenceAdmissionBinding(row.evidence.nativeAdmission);
      const parameters = parseManagedInferenceTransitionParameters(row.parameters);
      if (!binding || !parameters || !row.dispatchNonce || !row.dispatchIssuedAt || !row.dispatchExpiresAt
        || !row.dispatchSigningKeyId || !row.dispatchSignature) throw new Error("unavailable");
      const [node, cap, change, lease, quiescence, provider, fence] = await Promise.all([
        tx.edgeNode.findUnique({ where: { id: auth.edgeNodeRowId } }),
        tx.edgeNodeCapability.findUnique({ where: { edgeNodeId_capability: { edgeNodeId: auth.edgeNodeRowId, capability: "action.execute" } } }),
        tx.changeRequest.findUnique({ where: { id: row.changeRequestId }, select: { id: true, status: true, approvedAt: true, approvedById: true } }),
        tx.nonProductionEnvironmentLease.findUnique({ where: { leaseId: parameters.leaseId } }),
        tx.quiescenceRun.findUnique({ where: { runId: binding.quiescenceRunId } }),
        tx.modelProvider.findUnique({ where: { providerId: "local" } }),
        tx.platformConfig.findUnique({ where: { key: "portal.quiescence" } }),
      ]);
      if (!node || node.platform !== "darwin" || node.installMode !== "native" || !node.lastSeenAt || +now - +node.lastSeenAt > 120000
        || !cap || +now - +cap.reportedAt > 120000 || !isRecord(cap.evidence)) throw new Error("unavailable");
      const controller = isRecord(cap.evidence.managedInference) ? cap.evidence.managedInference : {};
      const policy = isRecord(node.scopePolicy) ? node.scopePolicy : {};
      return issueManagedInferenceAdmission({ envelope, signer, now, nonce: randomBytes(24).toString("base64url"), snapshot: {
        envelope: { version: "dpf.edge-action/1", signingKeyId: row.dispatchSigningKeyId, actionKey: row.actionKey,
          actionType: row.actionType, nodeId: node.nodeId, parameters: row.parameters, nonce: row.dispatchNonce,
          issuedAt: row.dispatchIssuedAt.toISOString(), expiresAt: row.dispatchExpiresAt.toISOString(), signature: row.dispatchSignature },
        status: row.status, riskClass: row.riskClass, approvalState: row.approvalState, approvedByPrincipalId: row.approvedByPrincipalId,
        node: { nodeId: node.nodeId, trustState: node.trustState, internal: node.customerAccountId === null && node.customerSiteId === null,
          enabled: cap.mode === "enabled", allowedActionTypes: Array.isArray(policy.actionTypes) ? policy.actionTypes.filter((x): x is string => typeof x === "string") : [],
          controllerSourceSha: typeof controller.sourceSha === "string" ? controller.sourceSha : null,
          controllerManifestSha256: typeof controller.controllerManifestSha256 === "string" ? controller.controllerManifestSha256 : null },
        change, lease, quiescence, admission: binding, currentProviderDigest: managedInferenceProviderDigest(provider),
        globalFence: parseQuiescenceConfig(fence?.value ?? null),
      } });
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json({ ok: true, admission }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "native_inference_admission_unavailable" }, { status: 409 });
  }
}

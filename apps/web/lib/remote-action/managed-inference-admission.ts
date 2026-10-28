import { createHash } from "node:crypto";
import { canonicalizeEdgeActionEnvelope, type SignedEdgeActionEnvelope } from "@dpf/db/edge-action-envelope";
import { MANAGED_INFERENCE_ACTION_TYPE, parseManagedInferenceTransitionParameters } from "@dpf/db/remote-action-dispatch";
import type { EdgeActionEnvelopeSigner } from "./dispatch-orchestrator";

// This snapshot must be loaded from current records in one DB transaction by
// the authenticated route. It is never accepted from a caller's request body.
export interface ManagedInferenceAdmissionSnapshot {
  envelope: SignedEdgeActionEnvelope;
  status: string; approvalState: string; riskClass: string; approvedByPrincipalId: string | null;
  node: { nodeId: string; trustState: string; internal: boolean; enabled: boolean; allowedActionTypes: string[];
    controllerSourceSha: string | null; controllerManifestSha256: string | null };
  change: { id: string; status: string; approvedAt: Date | null; approvedById: string | null } | null;
  lease: { leaseId: string; environmentKey: string; resourceClass: string | null; status: string; activeKey: string | null;
    releasedAt: Date | null; expiresAt: Date; phase: string | null; ownerSessionId: string; branchName: string | null;
    ownerPid: number | null; ownerProcessIdentity: string | null; ports: number[] } | null;
  quiescence: { runId: string; status: string; trigger: string; triggerRefId: string | null; targetVersion: string | null;
    targetBundleHash: string | null; swapStartedAt: Date | null } | null;
  admission: { ownerSessionId: string; branchName: string; ownerPid: number; ownerProcessIdentity: string;
    quiescenceRunId: string; controllerManifestSha256: string; providerDigest: string };
  currentProviderDigest: string;
  globalFence: { level: string; runId: string | null };
}
const check = (ok: unknown): void => { if (!ok) throw new Error("Managed inference admission is unavailable; no host effect is authorized."); };
const hex64 = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const bounded = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v);

export function parseManagedInferenceAdmissionBinding(value: unknown): ManagedInferenceAdmissionSnapshot["admission"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(",") !== ["ownerSessionId", "branchName", "ownerPid", "ownerProcessIdentity", "quiescenceRunId", "controllerManifestSha256", "providerDigest"].sort().join(",")
    || !bounded(v.ownerSessionId) || typeof v.branchName !== "string" || typeof v.ownerProcessIdentity !== "string"
    || !Number.isSafeInteger(v.ownerPid) || Number(v.ownerPid) <= 0 || typeof v.quiescenceRunId !== "string"
    || !hex64(v.controllerManifestSha256) || !hex64(v.providerDigest)) return null;
  return value as ManagedInferenceAdmissionSnapshot["admission"];
}

/** Capture the existing provider settings without consulting the temporarily
 * fenced selection or changing environment, rows, model or thinking policy. */
export function managedInferenceProviderDigest(provider: unknown, env: Record<string, string | undefined> = process.env): string {
  const p = provider && typeof provider === "object" && !Array.isArray(provider) ? provider as Record<string, unknown> : {};
  const compatible = new Set(["http://model-runner.docker.internal/v1", "http://host.docker.internal:12436/v1"]);
  for (const value of [env.LLM_BASE_URL, env.OLLAMA_INTERNAL_URL, p.baseUrl, p.endpoint]) {
    check(!value || (typeof value === "string" && compatible.has(value.replace(/\/+$/, ""))));
  }
  return createHash("sha256").update(JSON.stringify({
    llmBaseUrl: env.LLM_BASE_URL ?? null, ollamaInternalUrl: env.OLLAMA_INTERNAL_URL ?? null,
    baseUrl: p.baseUrl ?? null, endpoint: p.endpoint ?? null,
    maxContextTokens: p.maxContextTokens ?? null, maxOutputTokens: p.maxOutputTokens ?? null,
    modelRestrictions: p.modelRestrictions ?? null, enabledFamilies: p.enabledFamilies ?? null,
    maxConcurrency: p.maxConcurrency ?? null, retiredAt: p.retiredAt ?? null, retiredReason: p.retiredReason ?? null,
  })).digest("hex");
}

export function issueManagedInferenceAdmission(input: {
  envelope: SignedEdgeActionEnvelope; snapshot: ManagedInferenceAdmissionSnapshot;
  signer: EdgeActionEnvelopeSigner; now: Date; nonce: string;
}): SignedEdgeActionEnvelope {
  const { envelope, snapshot: s, signer, now, nonce } = input;
  const p = parseManagedInferenceTransitionParameters(envelope.parameters);
  const saved = s.envelope;
  check(p && envelope.actionType === MANAGED_INFERENCE_ACTION_TYPE && envelope.version === "dpf.edge-action/1"
    && /^[A-Za-z][A-Za-z0-9_-]{1,95}$/.test(envelope.actionKey));
  check(canonicalizeEdgeActionEnvelope(envelope) === canonicalizeEdgeActionEnvelope(saved)
    && envelope.signature === saved.signature && envelope.signingKeyId === signer.signingKeyId);
  // Ed25519 signatures are deterministic. Re-sign the persisted envelope with
  // the currently configured key, never a caller-selected key or certificate.
  check(signer.sign(saved).signature === saved.signature);
  const issued = Date.parse(saved.issuedAt), expires = Date.parse(saved.expiresAt);
  check(Number.isFinite(+now) && issued <= +now && expires > +now && expires - issued <= 300000);
  check(["claimed", "running"].includes(s.status) && s.approvalState === "approved" && s.riskClass === "high"
    && bounded(s.approvedByPrincipalId));
  check(s.node.nodeId === saved.nodeId && s.node.trustState === "trusted" && s.node.internal && s.node.enabled
    && s.node.allowedActionTypes.includes(MANAGED_INFERENCE_ACTION_TYPE));
  check(s.change?.status === "approved" && s.change.approvedAt && s.change.approvedAt <= now && s.change.approvedById);
  check(p && (p.operation === "rollback" || s.node.controllerSourceSha === p.sourceSha)
    && hex64(s.node.controllerManifestSha256) && s.node.controllerManifestSha256 === s.admission.controllerManifestSha256);
  const lease = s.lease;
  check(p && lease && lease.leaseId === p.leaseId && lease.environmentKey === "host-heavy-resource"
    && lease.resourceClass === "inference" && lease.status === "active" && lease.phase === "running"
    && lease.activeKey?.startsWith("host-heavy-resource:") && lease.releasedAt === null && lease.expiresAt > now
    && lease.ports.length === 0 && bounded(lease.ownerSessionId) && lease.ownerSessionId === s.admission.ownerSessionId
    && lease.branchName === s.admission.branchName && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(lease.branchName ?? "")
    && !lease.branchName?.includes("..") && !lease.branchName?.includes("//")
    && Number.isSafeInteger(lease.ownerPid) && lease.ownerPid! > 0 && lease.ownerPid === s.admission.ownerPid
    && typeof lease.ownerProcessIdentity === "string" && lease.ownerProcessIdentity.length > 0
    && lease.ownerProcessIdentity === s.admission.ownerProcessIdentity);
  const drain = s.quiescence;
  check(["draining", "swapping"].includes(s.globalFence.level) && s.globalFence.runId === s.admission.quiescenceRunId);
  check(p && drain && drain.runId === s.admission.quiescenceRunId && /^QR-[A-Za-z0-9_-]{1,120}$/.test(drain.runId)
    && ["ready-to-swap", "swapping"].includes(drain.status) && drain.swapStartedAt && drain.swapStartedAt <= now
    && drain.trigger === "manual" && drain.triggerRefId === `inference-runtime:${saved.actionKey}`
    && drain.targetVersion === p.sourceSha && drain.targetBundleHash === p.profileSha256);
  check(hex64(s.admission.providerDigest) && s.admission.providerDigest === s.currentProviderDigest);
  const expiresAt = new Date(Math.min(+now + 30000, expires, +lease!.expiresAt));
  check(expiresAt > now);
  return signer.sign({
    version: "dpf.edge-action/1", signingKeyId: signer.signingKeyId, actionKey: saved.actionKey, nodeId: saved.nodeId,
    actionType: "inference.runtime.admission", nonce, issuedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
    parameters: { schemaVersion: 1, ready: true,
      requestDigest: createHash("sha256").update(canonicalizeEdgeActionEnvelope(saved)).digest("hex"),
      leaseId: lease!.leaseId, ownerSessionId: lease!.ownerSessionId, branchName: lease!.branchName,
      quiescenceRunId: drain!.runId, approvedChangeRequestId: s.change!.id },
  });
}

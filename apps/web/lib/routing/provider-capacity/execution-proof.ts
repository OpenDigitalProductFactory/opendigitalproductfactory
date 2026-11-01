export const QUOTA_PROOF_TTL_MS = 60 * 60 * 1000;
export type ExecutionProofBinding = {
  providerId: string; connectionId: string; modelId: string; adapter: string;
  accountVersion: string; credentialRevision: string; modelRevision: string;
  endpointRevision: string; quotaRevision: string;
};
export type ExecutionProof = ExecutionProofBinding & { version: 1; observedAt: number; expiresAt: number };
const identityKeys = ["providerId", "connectionId", "modelId", "adapter"] as const;
const revisionKeys = ["accountVersion", "credentialRevision", "modelRevision", "endpointRevision", "quotaRevision"] as const;
const keys = [...identityKeys, ...revisionKeys, "version", "observedAt", "expiresAt"];

/** An exact observation is a short-lived candidate fact, never a shared quota reset. */
export function currentExecutionProof(value: unknown, binding: ExecutionProofBinding, now: number): ExecutionProof | null {
  if (!isRecord(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || value.version !== 1 || value.adapter !== "responses" || !["chatgpt", "codex"].includes(String(value.providerId))
    || identityKeys.some(key => typeof value[key] !== "string" || !value[key] || value[key] !== binding[key])
    || revisionKeys.some(key => typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key] as string) || value[key] !== binding[key])
    || !Number.isSafeInteger(now) || !Number.isSafeInteger(value.observedAt) || !Number.isSafeInteger(value.expiresAt)) return null;
  const observedAt = value.observedAt as number, expiresAt = value.expiresAt as number;
  if (observedAt > now || expiresAt !== observedAt + QUOTA_PROOF_TTL_MS || expiresAt <= now) return null;
  return value as ExecutionProof;
}
import { isRecord } from "@/lib/shared/coerce";


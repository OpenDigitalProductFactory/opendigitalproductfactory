import { createHmac, timingSafeEqual } from "node:crypto";

import { MIN_HOLD_MS, type TeardownScope } from "./contract";

export interface TeardownChallengePayload {
  schemaVersion: 1;
  kind: "teardown-ui-challenge";
  runId: string;
  actorRef: string;
  scope: TeardownScope;
  installPath: string;
  backupsPath: string;
  composeProject: string;
  composeFiles: string[];
  previewDigest: string;
  salvageDigest: string;
  issuedAt: string;
  expiresAt: string;
}

const CHALLENGE_TTL_MS = 5 * 60_000;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function signature(body: string, secret: string): string {
  if (secret.length < 32) throw new Error("teardown_signing_secret_invalid");
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function issueTeardownChallenge(
  input: Omit<TeardownChallengePayload, "schemaVersion" | "kind" | "issuedAt" | "expiresAt">,
  secret: string,
  nowMs = Date.now(),
): string {
  const payload: TeardownChallengePayload = {
    schemaVersion: 1,
    kind: "teardown-ui-challenge",
    ...input,
    issuedAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + CHALLENGE_TTL_MS).toISOString(),
  };
  const body = Buffer.from(JSON.stringify(stable(payload))).toString("base64url");
  return `${body}.${signature(body, secret)}`;
}

export type VerifyChallengeResult =
  | { valid: true; payload: TeardownChallengePayload }
  | { valid: false; code: string };

export function verifyTeardownChallenge(
  token: string,
  secret: string,
  actorRef: string,
  nowMs = Date.now(),
): VerifyChallengeResult {
  const [body, supplied, extra] = token.split(".");
  if (!body || !supplied || extra || !/^[a-f0-9]{64}$/.test(supplied)) return { valid: false, code: "teardown_challenge_malformed" };
  let expected: string;
  try { expected = signature(body, secret); } catch { return { valid: false, code: "teardown_challenge_signature_invalid" }; }
  if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))) return { valid: false, code: "teardown_challenge_signature_invalid" };
  let payload: TeardownChallengePayload;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TeardownChallengePayload; } catch { return { valid: false, code: "teardown_challenge_malformed" }; }
  if (payload.schemaVersion !== 1 || payload.kind !== "teardown-ui-challenge") return { valid: false, code: "teardown_challenge_schema_invalid" };
  if (payload.actorRef !== actorRef) return { valid: false, code: "teardown_challenge_actor_mismatch" };
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt - issuedAt !== CHALLENGE_TTL_MS) return { valid: false, code: "teardown_challenge_time_invalid" };
  if (nowMs > expiresAt) return { valid: false, code: "teardown_challenge_expired" };
  if (nowMs < issuedAt) return { valid: false, code: "teardown_challenge_not_yet_valid" };
  if (payload.scope !== "containers" && nowMs - issuedAt < MIN_HOLD_MS) return { valid: false, code: "teardown_hold_incomplete" };
  return { valid: true, payload };
}

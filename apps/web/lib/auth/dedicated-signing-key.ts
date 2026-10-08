// Dedicated HMAC signing keys with a bounded AUTH_SECRET grace window (BI-F6929F50).
//
// Attention reach links (lib/attention/reach-link.ts) and coworker delegation
// receipts (lib/coworker-service-catalog/delegation-receipt.ts) were signed with
// the session secret on every install, because no install path provisioned
// DPF_ATTENTION_REACH_SECRET or DPF_DELEGATION_RECEIPT_SECRET. Every install path
// now provisions both (scripts/installer/dedicated-signing-keys-contract.test.mjs),
// so one secret no longer signs sessions, reach links and receipts.
//
// BI-231A4BC7 extends the same contract to self-upgrade target bindings
// (lib/self-upgrade/target-binding.ts, DPF_SELF_UPGRADE_TARGET_BINDING_SECRET)
// and delivery task hub cursors (lib/work-capsules/delivery-task-hub-store.ts,
// DPF_DELIVERY_TASK_CURSOR_SECRET), with one cutoff for all four handle kinds.
//
// Rotation follows WWMD DI-BE92FB0A3417:
// - Dedicated key set: SIGN with it. VERIFY with it first; a handle that fails
//   is re-checked under AUTH_SECRET / NEXTAUTH_SECRET only before
//   SESSION_SECRET_GRACE_CUTOFF, and only if the caller's per-handle bound holds.
//   A handle that verifies that way reports `session-secret-grace`, and the use is
//   logged (no secret, no token), so the fallback is observable.
// - Dedicated key unset (an install not yet upgraded): today's behaviour - sign
//   and verify with the session secret, no window, reported as `session-secret`.
//
// A blank value counts as unset. docker-compose.yml passes `${KEY:-}`, so an
// install whose .env lacks the key receives an empty string, which must not
// shadow the session secret.
//
// FOLLOW-UP: remove the session-secret fallback in a later release, once the
// cutoff has passed on the release train.

/** Which secret signed or verified a handle. */
export type SigningKeySource = "dedicated" | "session-secret" | "session-secret-grace";

export type SigningKeyCandidate = { secret: string; source: SigningKeySource };

/**
 * End of the grace window: about 30 days after this change ships. After it a
 * handle signed with the session secret is refused on any install that has a
 * dedicated key. One constant for every handle kind, so the window is stated once.
 */
export const SESSION_SECRET_GRACE_CUTOFF = new Date("2026-11-09T00:00:00.000Z");

function nonBlank(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function sessionSecret(): string | null {
  return nonBlank(process.env.AUTH_SECRET) ?? nonBlank(process.env.NEXTAUTH_SECRET);
}

function dedicatedSecret(envName: string): string | null {
  return nonBlank(process.env[envName]);
}

/** The key new handles are signed with, or null when no source is configured. */
export function signingKey(envName: string): SigningKeyCandidate | null {
  const dedicated = dedicatedSecret(envName);
  if (dedicated) return { secret: dedicated, source: "dedicated" };
  const session = sessionSecret();
  return session ? { secret: session, source: "session-secret" } : null;
}

/**
 * Keys a handle may verify under, in order. The grace candidate is offered only
 * before the cutoff; the caller must still apply its own per-handle bound before
 * accepting a match on it.
 */
export function verificationKeys(envName: string, now: Date): SigningKeyCandidate[] {
  const dedicated = dedicatedSecret(envName);
  const session = sessionSecret();
  if (!dedicated) return session ? [{ secret: session, source: "session-secret" }] : [];
  const keys: SigningKeyCandidate[] = [{ secret: dedicated, source: "dedicated" }];
  if (session && session !== dedicated && now.getTime() < SESSION_SECRET_GRACE_CUTOFF.getTime()) {
    keys.push({ secret: session, source: "session-secret-grace" });
  }
  return keys;
}

/** Record that a handle verified only under the session-secret grace fallback. */
export function noteSessionSecretGraceUse(surface: string): void {
  console.warn(
    `[${surface}] handle verified under the AUTH_SECRET grace fallback (BI-F6929F50); accepted until ${SESSION_SECRET_GRACE_CUTOFF.toISOString()}`,
  );
}

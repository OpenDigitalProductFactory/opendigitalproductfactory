"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  pollAccessToken,
  requestDeviceCode,
} from "@/lib/integrate/github-oauth";
import { validateGitHubToken } from "@/lib/actions/platform-dev-config";
import { encryptSecret } from "@/lib/credential-crypto";

// Server-side orchestration for the OAuth Device Flow path described in
// docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md
// (§Tier 1: OAuth Device Flow).
//
// `initiateDeviceFlow` mints a session and returns the user-visible code +
// verification URL. `pollDeviceFlow` is called by the UI on the GitHub-supplied
// interval until GitHub releases an access_token, at which point the token is
// validated, encrypted, and stored to CredentialEntry[hive-contribution].

export interface InitiateResult {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type InitiateActionResult =
  | { success: true; data: InitiateResult }
  | { success: false; error: string };

/**
 * Start an OAuth Device Flow session. Persists the GitHub-issued
 * `device_code` server-side; returns the short user-visible code so the UI
 * can show "Visit github.com/login/device and enter <code>".
 *
 * Caller must hold `manage_platform`. Same gate as `savePlatformDevConfig`.
 */
export async function initiateDeviceFlow(): Promise<InitiateActionResult> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { success: false, error: "Not authenticated" };

  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    return { success: false, error: "Unauthorized" };
  }

  let code: Awaited<ReturnType<typeof requestDeviceCode>>;
  try {
    code = await requestDeviceCode("public_repo");
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Could not reach GitHub.",
    };
  }

  const record = await prisma.deviceCodeSession.create({
    data: {
      deviceCode: code.device_code,
      userCode: code.user_code,
      interval: code.interval,
      expiresAt: new Date(Date.now() + code.expires_in * 1000),
      createdBy: user.id,
      consumed: false,
    },
  });

  return {
    success: true,
    data: {
      sessionId: record.id,
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      expiresIn: code.expires_in,
      interval: code.interval,
    },
  };
}

export type PollActionResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "success"; username: string }
  | { status: "error"; error: string };

/**
 * Poll an in-flight Device Flow session for completion. UI calls this every
 * `interval` seconds. On success, validates the token's scope via
 * `validateGitHubToken({ requiredScope: "public_repo", authMethod:
 * "oauth-device" })`, encrypts the resulting `gho_` token, and stores it in
 * the CredentialEntry[hive-contribution] slot.
 *
 * Session-binding check (`createdBy === userId`) prevents one admin from
 * polling another admin's session. Validation failure leaves the session
 * unconsumed so the user can retry without restarting the device-code
 * exchange.
 */
export async function pollDeviceFlow(sessionId: string): Promise<PollActionResult> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { status: "error", error: "Not authenticated" };

  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    return { status: "error", error: "Unauthorized" };
  }

  const devCodeSession = await prisma.deviceCodeSession.findUnique({
    where: { id: sessionId },
  });
  if (!devCodeSession) {
    return { status: "error", error: "Session not found or expired" };
  }
  if (devCodeSession.createdBy !== user.id) {
    return { status: "error", error: "Session does not belong to caller" };
  }
  if (devCodeSession.consumed) {
    return { status: "error", error: "Session already consumed" };
  }
  if (devCodeSession.expiresAt < new Date()) {
    await prisma.deviceCodeSession
      .delete({ where: { id: sessionId } })
      .catch(() => {});
    return { status: "error", error: "Code expired, start over" };
  }

  const pollResult = await pollAccessToken(devCodeSession.deviceCode);

  if (pollResult.status === "pending") return { status: "pending" };
  if (pollResult.status === "slow_down") {
    return { status: "slow_down", interval: pollResult.interval };
  }
  if (pollResult.status === "expired") {
    await prisma.deviceCodeSession
      .delete({ where: { id: sessionId } })
      .catch(() => {});
    return { status: "error", error: "Code expired, start over" };
  }
  if (pollResult.status === "denied") {
    await prisma.deviceCodeSession
      .delete({ where: { id: sessionId } })
      .catch(() => {});
    return { status: "error", error: "Authorization denied" };
  }
  if (pollResult.status === "error") {
    return { status: "error", error: pollResult.error };
  }

  // Success: validate scope, encrypt token, persist credential, consume session.
  const validation = await validateGitHubToken({
    token: pollResult.token,
    requiredScope: "public_repo",
    authMethod: "oauth-device",
  });
  if (!validation.valid) {
    // Leave the session un-consumed; user can retry with a fresh authorization.
    return {
      status: "error",
      error: validation.error ?? "Token validation failed",
    };
  }

  const encrypted = encryptSecret(pollResult.token);
  await prisma.credentialEntry.upsert({
    where: { providerId: "hive-contribution" },
    create: {
      providerId: "hive-contribution",
      secretRef: encrypted,
      status: "active",
      scope: pollResult.scope,
    },
    update: {
      secretRef: encrypted,
      status: "active",
      scope: pollResult.scope,
      // Device Flow user-to-server tokens have no expiry; clear any stale value
      // left by a prior fine-grained-PAT save.
      tokenExpiresAt: null,
    },
  });
  await prisma.deviceCodeSession.update({
    where: { id: sessionId },
    data: { consumed: true },
  });

  return { status: "success", username: validation.username ?? "unknown" };
}

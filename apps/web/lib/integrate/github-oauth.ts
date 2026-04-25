// OAuth Device Flow client for GitHub (RFC 8628).
//
// Backs the Tier 1 path of the 2026-04-24 GitHub auth 2FA readiness spec:
// the user authorizes our OAuth App by entering a short user_code at
// github.com/login/device. We never see the user's GitHub password or 2FA
// challenge — that lives entirely between the user and GitHub.
//
// Two stateless helpers (request + poll) plus a cleanup sweeper for the
// transient DeviceCodeSession table. Server-action orchestration lives in
// `apps/web/lib/actions/github-device-flow.ts`.

import { prisma } from "@dpf/db";

// Public OAuth App Client ID — safe to embed; appears in every Device Flow request.
// Registered at github.com/organizations/OpenDigitalProductFactory/settings/applications
// Device Flow per RFC 8628.
export const GITHUB_OAUTH_CLIENT_ID = "Ov23li7IwqNeX9nKizQs";

const DEVICE_CODE_ENDPOINT = "https://github.com/login/device/code";
const ACCESS_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export type PollResult =
  | { status: "pending" }
  | { status: "slow_down"; interval: number }
  | { status: "success"; token: string; scope: string }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; error: string };

/** Initiate Device Flow — request a device_code from GitHub. */
export async function requestDeviceCode(scope = "public_repo"): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ client_id: GITHUB_OAUTH_CLIENT_ID, scope }),
  });
  if (!response.ok) {
    throw new Error(`GitHub device_code endpoint returned ${response.status}`);
  }
  return response.json() as Promise<DeviceCodeResponse>;
}

/**
 * Poll for the access_token. GitHub returns one of:
 *   - { error: "authorization_pending" } — user hasn't authorized yet
 *   - { error: "slow_down", interval } — we polled too fast; back off
 *   - { error: "expired_token" } — device code TTL elapsed; start over
 *   - { error: "access_denied" } — user clicked Cancel
 *   - { access_token, scope, token_type } — success
 *
 * We map every shape into a discriminated PollResult so callers don't have to
 * re-implement RFC 8628's error-code semantics.
 */
export async function pollAccessToken(deviceCode: string): Promise<PollResult> {
  const response = await fetch(ACCESS_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GITHUB_OAUTH_CLIENT_ID,
      device_code: deviceCode,
      grant_type: DEVICE_GRANT_TYPE,
    }),
  });
  if (!response.ok) {
    return { status: "error", error: `GitHub returned ${response.status}` };
  }
  const data = (await response.json()) as {
    error?: string;
    error_description?: string;
    interval?: number;
    access_token?: string;
    scope?: string;
  };
  if (data.access_token) {
    return { status: "success", token: data.access_token, scope: data.scope ?? "" };
  }
  switch (data.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down", interval: data.interval ?? 10 };
    case "expired_token":
      return { status: "expired" };
    case "access_denied":
      return { status: "denied" };
    default:
      return {
        status: "error",
        error: data.error_description ?? data.error ?? "Unknown",
      };
  }
}

/**
 * Sweep expired DeviceCodeSession rows. Called by the weekly infra-prune
 * cron. Returns the row count for logging. Safe to call any time — the
 * pollDeviceFlow path also self-deletes on its own discovery of an expired
 * session, so this is a defense-in-depth backstop for sessions whose owner
 * never came back to poll.
 */
export async function cleanupExpiredDeviceCodeSessions(): Promise<number> {
  const result = await prisma.deviceCodeSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

"use server";

// Grok (xAI) device-code OAuth — the "sign in with Google" alternative to pasting an xAI
// API key. These server actions are the operator (UI) entry points: they add the
// manage_provider_connections session check, then delegate to the shared, auth-free core
// in lib/build/grok-device-login-core.ts. The same core is reused by the MCP tools
// (grok_signin_start / grok_signin_status), which gate on the same capability via the
// bearer token before dispatch.
//
// Flow:
//   1. startGrokDeviceLogin() runs `grok login --device-auth` in the sandbox and returns
//      the accounts.x.ai/oauth2/device URL + user code.
//   2. The operator signs in with the account method enabled at xAI (Google / X / Apple).
//   3. completeGrokDeviceLogin() captures ~/.grok/auth.json and stores it as the xAI
//      credential; the build dispatch injects it (see grok-dispatch ensureGrokAuth).
//
// See docs/superpowers/specs/2026-06-07-grok-device-code-oauth-design.md.

import { requireCapability } from "@/lib/actions/shared/guards";
import {
  grokDeviceLoginStart,
  grokDeviceLoginComplete,
} from "@/lib/build/grok-device-login-core";

async function requireManageProviders(): Promise<void> {
  await requireCapability("manage_provider_connections");
}

export async function startGrokDeviceLogin(): Promise<
  { verificationUrl: string; userCode: string } | { error: string }
> {
  try {
    await requireManageProviders();
  } catch {
    return { error: "Your admin session expired — sign in again and retry." };
  }
  return grokDeviceLoginStart();
}

export async function completeGrokDeviceLogin(): Promise<
  { status: "ok" } | { status: "pending" } | { status: "failed"; detail: string }
> {
  try {
    await requireManageProviders();
  } catch {
    return { status: "failed", detail: "Your admin session expired — sign in again and retry." };
  }
  return grokDeviceLoginComplete();
}

"use server";

import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { provisionServiceAccount } from "@/lib/browser-drive/provisioning";
import {
  serviceAccountPrincipalId,
  resolveServiceAccountPrincipal,
} from "@/lib/browser-drive/identity";
import type { BrowserCredentialFields } from "@/lib/browser-drive/credentials";
import { getErrorMessage } from "@/lib/shared/get-error-message";

// Persist a freshly bootstrapped service-account profile (EP-BROWSER-DRIVE §9.2).
// The attended login that produces `credential` (Playwright storageState, or
// opt-in stored credentials) happens against a live browser — the runtime step
// that pairs with the proving install. This action only persists the result.
export type ProvisionResult =
  | { ok: true; principalId: string; credentialId: string }
  | { ok: false; error: string };

export async function provisionServiceAccountAction(input: {
  siteKey: string;
  accountKey: string;
  targetDomains: string[];
  credential: BrowserCredentialFields;
}): Promise<ProvisionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated" };
  if (!input.targetDomains.length) {
    return { ok: false, error: "A target-domain allowlist is required for a service account." };
  }

  const principalId = serviceAccountPrincipalId(input.siteKey, input.accountKey);
  try {
    const res = await provisionServiceAccount({
      siteKey: input.siteKey,
      accountKey: input.accountKey,
      targetDomains: input.targetDomains,
      delegatingUserId: session.user.id,
      profileRef: `/profiles/${principalId}/${input.siteKey}/`,
      credential: input.credential,
      sessionId: randomUUID(),
    });
    return { ok: true, ...res };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

// Begin the one-time attended setup for a service account (EP-BROWSER-DRIVE §9.2).
// Registers the service Principal now (real, idempotent) and returns the next
// step. The attended login that captures the profile's storageState runs against
// a live browser — the spec-Q2 runtime interaction validated on portal rebuild;
// once captured, the runtime calls provisionServiceAccountAction to persist it.
export type BeginSetupResult =
  | { ok: true; principalId: string; profileRef: string; loginUrl: string | null }
  | { ok: false; error: string };

export async function beginServiceAccountSetupAction(input: {
  siteKey: string;
  accountKey: string;
  targetDomains: string[];
  loginUrl?: string;
  displayName?: string;
}): Promise<BeginSetupResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not authenticated" };
  const siteKey = input.siteKey.trim();
  const accountKey = (input.accountKey || "default").trim();
  const targetDomains = input.targetDomains.map((d) => d.trim()).filter(Boolean);
  if (!siteKey) return { ok: false, error: "A site key is required." };
  if (!targetDomains.length) return { ok: false, error: "At least one target domain is required." };

  try {
    const { principalId } = await resolveServiceAccountPrincipal({
      siteKey,
      accountKey,
      displayName: input.displayName,
      // The operator running the attended setup owns the account (BI-3181909E).
      accountableOwnerUserId: session.user.id,
    });
    return {
      ok: true,
      principalId,
      profileRef: `/profiles/${principalId}/${siteKey}/`,
      loginUrl: input.loginUrl?.trim() || null,
    };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}

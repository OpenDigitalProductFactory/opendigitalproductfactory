"use server";

import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { provisionServiceAccount } from "@/lib/browser-drive/provisioning";
import { serviceAccountPrincipalId } from "@/lib/browser-drive/identity";
import type { BrowserCredentialFields } from "@/lib/browser-drive/credentials";

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
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

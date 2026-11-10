// BI-F586F8A5 — the platform automation persona never takes over a person's
// interactive OAuth consent.
//
// The automation sign-in (BI-9369DEB5) leaves a real browser session behind.
// A person who later connects an interactive client in that browser saw the
// persona on the consent page like any account, ticked it (BI-07D21B4A), and
// their assistant then acted as the persona. The persona may still consent, but
// only to the one authorization request its one-time sign-in link was minted
// for: the governed acceptance flow names that request as the link's nextPath,
// and an interactive client's request (its own client and PKCE challenge)
// never matches.

import { isPlatformAutomationPersona } from "@/lib/govern/automation-persona-identity";
import { OAUTH_AUTHORIZE_PATH } from "@/lib/auth/oauth-metadata";

/** The authorization request an automation session was minted to approve. */
export type AutomationOAuthConsent = { clientId: string; codeChallenge: string };

/** The request a sign-in nextPath names, or null when it names none exactly. */
export function automationOAuthConsentFor(nextPath: string): AutomationOAuthConsent | null {
  const [path, query = ""] = nextPath.split("?", 2);
  if (path !== OAUTH_AUTHORIZE_PATH) return null;
  const params = new URLSearchParams(query);
  const clientId = params.get("client_id") ?? "";
  const codeChallenge = params.get("code_challenge") ?? "";
  return clientId && codeChallenge ? { clientId, codeChallenge } : null;
}

/**
 * Whether this session may consent to this request. Every account except the
 * automation persona may; the persona only to its own minted request.
 */
export function automationConsentPermitted(
  user: { email?: string | null; automationOAuthConsent?: AutomationOAuthConsent | null },
  request: { clientId: string; codeChallenge: string },
): boolean {
  if (!isPlatformAutomationPersona(user.email)) return true;
  const minted = user.automationOAuthConsent;
  return Boolean(minted && minted.clientId === request.clientId && minted.codeChallenge === request.codeChallenge);
}

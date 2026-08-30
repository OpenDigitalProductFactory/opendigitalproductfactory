// Client registration and redirect-URI validation for the MCP authorization
// server.
//
// Three mechanisms, matching the spec's three (`authorization.mdx:196-209`).
// Which one an install can actually use is a property of the install, not a
// preference: a Client ID Metadata Document `client_id` is an https URL the AS
// must FETCH (`:227-236`), so CIMD is correct for an install the operator has
// exposed and unusable for a fully-local one. DCR needs no outbound fetch and
// is the local path. Both are supported because DPF installs are both kinds.
//
// Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.4, §4.5

import { prisma } from "@dpf/db";
import { isLoopbackHostname } from "@/lib/auth/oauth-metadata";
import { isPublicScope, type PublicScope } from "@/lib/auth/oauth-scope-map";

export type RegistrationKind = "dcr" | "cimd" | "preregistered" | "credentials";

export type RegisteredClient = {
  rowId: string;
  clientId: string;
  clientName: string;
  registrationKind: RegistrationKind;
  redirectUris: string[];
  allowedScopes: PublicScope[];
  ownerUserId: string | null;
  agentId: string | null;
  clientSecretHash: string | null;
  /** True when the client chose its own display name (DCR). The consent screen
   *  must mark these, because a self-registered client can name itself
   *  anything — that is the phishing surface DCR opens. */
  selfAsserted: boolean;
};

export async function findClientByClientId(clientId: string): Promise<RegisteredClient | null> {
  if (!clientId) return null;
  const row = await prisma.oAuthClient.findUnique({ where: { oAuthClientId: clientId } });
  if (!row || row.revokedAt) return null;
  return {
    rowId: row.id,
    clientId: row.oAuthClientId,
    clientName: row.clientName,
    registrationKind: row.registrationKind as RegistrationKind,
    redirectUris: row.redirectUris,
    allowedScopes: row.allowedScopes.filter(isPublicScope),
    ownerUserId: row.ownerUserId,
    agentId: row.agentId,
    clientSecretHash: row.clientSecretHash,
    selfAsserted: row.registrationKind === "dcr",
  };
}

/**
 * Is this redirect URI acceptable for this client?
 *
 * Loopback gets the RFC 8252 §7.3 native-app carve-out: a CLI cannot know in
 * advance which ephemeral port it will get, so the PORT is ignored while
 * scheme, host and path must still match a registered entry. Everything else
 * is compared exactly — no prefix matching, no wildcards. Loose redirect
 * matching is the classic OAuth authorization-code interception bug, and the
 * loopback exception is the only one the spec sanctions.
 */
export function isRedirectUriAllowed(client: RegisteredClient, candidate: string): boolean {
  let target: URL;
  try {
    target = new URL(candidate);
  } catch {
    return false;
  }
  // A redirect carrying a fragment is never valid: the authorization response
  // appends its own query, and a fragment would swallow it.
  if (target.hash) return false;

  for (const registered of client.redirectUris) {
    let known: URL;
    try {
      known = new URL(registered);
    } catch {
      continue;
    }
    if (known.protocol !== target.protocol) continue;
    if (known.hostname.toLowerCase() !== target.hostname.toLowerCase()) continue;
    if (known.pathname !== target.pathname) continue;

    if (isLoopbackHostname(target.hostname)) {
      // Port intentionally not compared — that is the whole carve-out.
      return true;
    }
    if (known.port !== target.port) continue;
    if (known.search !== target.search) continue;
    return true;
  }
  return false;
}

/** A redirect URI a client may register at all. Non-loopback http is refused:
 *  an authorization code travelling over plaintext to a remote host is
 *  interceptable, and OAuth 2.1 requires TLS everywhere except loopback. */
export function isRegisterableRedirectUri(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") return isLoopbackHostname(url.hostname);
  // A custom scheme (myapp://callback) is the other native-app pattern; it
  // must have a scheme-specific part to be addressable at all.
  return /^[a-z][a-z0-9+.-]*:$/i.test(url.protocol) && url.href.length > url.protocol.length + 2;
}

export type DcrRegistrationInput = {
  clientName: string;
  redirectUris: string[];
  metadata: unknown;
};

export type DcrRegistrationResult =
  | { registered: true; clientId: string; clientName: string; redirectUris: string[] }
  | {
      registered: false;
      error: "invalid_redirect_uri" | "invalid_client_metadata";
      detail: string;
    };

/**
 * RFC 7591 dynamic registration.
 *
 * Registration grants NOTHING on its own: no scopes are attached, and every
 * token still requires an authenticated human to consent. What it creates is a
 * name that will later appear on a consent screen, which is why
 * `registrationKind` is recorded and surfaced as self-asserted.
 */
export async function registerDynamicClient(
  input: DcrRegistrationInput,
): Promise<DcrRegistrationResult> {
  const name = input.clientName.trim();
  if (!name || name.length > 120) {
    return { registered: false, error: "invalid_client_metadata", detail: "client_name is required" };
  }
  if (!Array.isArray(input.redirectUris) || input.redirectUris.length === 0) {
    return { registered: false, error: "invalid_redirect_uri", detail: "redirect_uris is required" };
  }
  if (input.redirectUris.length > 8) {
    return { registered: false, error: "invalid_redirect_uri", detail: "too many redirect_uris" };
  }
  for (const uri of input.redirectUris) {
    if (typeof uri !== "string" || !isRegisterableRedirectUri(uri)) {
      return { registered: false, error: "invalid_redirect_uri", detail: `unusable redirect_uri: ${uri}` };
    }
  }

  const clientId = `dpfoc_${crypto.randomUUID().replace(/-/g, "")}`;
  await prisma.oAuthClient.create({
    data: {
      oAuthClientId: clientId,
      clientName: name,
      registrationKind: "dcr",
      redirectUris: input.redirectUris,
      // No scopes at registration. Consent is where authority is granted.
      allowedScopes: [],
      metadataJson: (input.metadata ?? {}) as object,
    },
  });
  return { registered: true, clientId, clientName: name, redirectUris: input.redirectUris };
}

/**
 * Resolve a Client ID Metadata Document client (SEP-991) — LOOKUP ONLY.
 *
 * **This deliberately does not fetch the document.** Resolving a CIMD client
 * "properly" means the authorization server performing an HTTP request to a URL
 * the CLIENT chose, which is server-side request forgery by construction:
 * `client_id=https://169.254.169.254/latest/meta-data` or any internal service
 * becomes a probe of the operator's network, executed by the one endpoint that
 * must be reachable before authentication.
 *
 * An earlier revision of this file did fetch, behind an address guard. CodeQL
 * flagged it `js/request-forgery` (critical) and kept flagging it even through
 * the platform's own `assertSafeOutboundUrl` sanitizer — which
 * `.github/codeql/codeql-config.yml` already lists among the helpers whose JS/TS
 * findings cannot be modelled away, because GitHub honours CodeQL data-extension
 * packs only for C/C++, C#, Java, Python, Ruby and Rust. The documented fallback
 * is dismissal with justification, and a standing dismissed critical alert on an
 * authorization endpoint is a worse artifact than not having the feature.
 *
 * It is also a feature this platform cannot use: a CIMD `client_id` is an https
 * URL the AS must retrieve, and a fully-local install has no route to it. DCR
 * (`registerDynamicClient`) is the mechanism that works here, and operator
 * pre-registration covers a client an operator wants pinned.
 *
 * So a CIMD-shaped `client_id` resolves only if some other path already recorded
 * it — pre-registration, or a prior DCR. Nothing is fetched, and the SSRF sink
 * does not exist. If an install ever genuinely needs live CIMD resolution, it
 * belongs behind a fetch performed by a dedicated egress-controlled service, not
 * inline in the authorization endpoint.
 *
 * Design: docs/superpowers/specs/2026-08-26-mcp-client-self-authentication-design.md §4.4, §7.3b
 */
export async function resolveCimdClient(clientIdUrl: string): Promise<RegisteredClient | null> {
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return null;
  }
  // Spec shape: https with a path component. A bare origin is not a CIMD id.
  if (url.protocol !== "https:") return null;
  if (url.pathname === "/" || url.pathname === "") return null;

  // Lookup only — see the note above. An unknown CIMD client is simply unknown.
  return await findClientByClientId(clientIdUrl);
}

/** Stamp last-used so the admin list can show dormant clients honestly.
 *  Never awaited by a request path: telemetry must not add latency. */
export function touchClient(rowId: string): void {
  void prisma.oAuthClient
    .update({ where: { id: rowId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

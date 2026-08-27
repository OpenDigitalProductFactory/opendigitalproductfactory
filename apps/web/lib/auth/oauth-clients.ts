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
 * Resolve a Client ID Metadata Document client (SEP-991).
 *
 * The AS fetches the URL, and the document's own `client_id` MUST equal that
 * URL exactly (`:236-239`) — without that check anyone could host a document
 * claiming to be someone else's client. Records the client on first sight so
 * the consent screen and the admin list can show it like any other.
 */
export async function resolveCimdClient(clientIdUrl: string): Promise<RegisteredClient | null> {
  let url: URL;
  try {
    url = new URL(clientIdUrl);
  } catch {
    return null;
  }
  // Spec: https scheme with a path component. A bare origin is not a CIMD id.
  if (url.protocol !== "https:") return null;
  if (url.pathname === "/" || url.pathname === "") return null;

  const existing = await findClientByClientId(clientIdUrl);
  if (existing) return existing;

  let doc: Record<string, unknown>;
  try {
    const res = await fetch(clientIdUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!res.ok) return null;
    doc = (await res.json()) as Record<string, unknown>;
  } catch {
    // An air-gapped install cannot fetch, and that is expected rather than
    // exceptional — DCR is the path there.
    return null;
  }

  if (doc.client_id !== clientIdUrl) return null;
  const clientName = typeof doc.client_name === "string" ? doc.client_name.trim() : "";
  const redirectUris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (!clientName || redirectUris.length === 0) return null;
  if (!redirectUris.every(isRegisterableRedirectUri)) return null;

  const row = await prisma.oAuthClient.create({
    data: {
      oAuthClientId: clientIdUrl,
      clientName,
      registrationKind: "cimd",
      redirectUris,
      allowedScopes: [],
      metadataJson: doc as object,
    },
  });
  return {
    rowId: row.id,
    clientId: row.oAuthClientId,
    clientName: row.clientName,
    registrationKind: "cimd",
    redirectUris: row.redirectUris,
    allowedScopes: [],
    ownerUserId: null,
    agentId: null,
    clientSecretHash: null,
    // A CIMD name is asserted by a document at a URL the operator can inspect,
    // which is weaker than pre-registration but stronger than pure self-claim.
    selfAsserted: false,
  };
}

/** Stamp last-used so the admin list can show dormant clients honestly.
 *  Never awaited by a request path: telemetry must not add latency. */
export function touchClient(rowId: string): void {
  void prisma.oAuthClient
    .update({ where: { id: rowId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

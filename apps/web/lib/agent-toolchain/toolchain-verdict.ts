// BI-54469E18 — what a connection says it loaded, and how that compares with
// the toolchain this release ships (design 2026-10-07-agent-toolchain-release-
// delivery §5.2). Pure: no I/O, so every verdict is a unit-tested fixture.
//
// A verdict is computed when it is read and never stored: it depends on the
// release, the floor and time, all of which change after an observation.
//
// A User-Agent is never an input here. It is trivially forged and is also
// what SDK-built customer agents send, so it may only label a row for display.

import { mcpClientBearerHeaderRequired, type McpClient } from "@dpf/integration-shared/mcp-client-credential-policy";
import { GROK_CREDENTIALS_CLIENT_NAME } from "@/lib/auth/grok-credentials-client";

/** Client kinds that load the dpf-platform pack, and their credential-policy key. */
export const DECLARING_CLIENT_KINDS: Readonly<Record<string, McpClient>> = Object.freeze({
  "claude-code": "claude",
  codex: "codex",
  grok: "grok",
  antigravity: "antigravity",
});

export type ToolchainDeclaration = {
  pack: string;
  /** First 16 hex characters of the delivered digest. */
  digest: string;
  client: string;
};

export type ToolchainVerdict = "current" | "stale" | "below-floor" | "undeclared";

export type PublishedToolchain = {
  packVersion: string;
  packDigest: string;
  floor: { minPackVersion: string | null; graceStartsAt: string | null };
};

export type ConnectionCredential = {
  /** How the request authenticated (McpAuthSource). */
  authSource: "oauth" | "pat" | "session-jwt";
  /**
   * What kind of credential this is: McpApiToken.kind ("operator",
   * "oauth_access", ...), or GROK_OWN_CREDENTIAL_KIND for a token issued to
   * Grok's registered OAuth credentials client (connection-observation.ts).
   */
  credentialKind?: string | null;
};

/** A token issued to the "DPF Grok connection" client_credentials client (BI-5BCDB07C). */
export const GROK_OWN_CREDENTIAL_KIND = "grok-credentials-client";

/**
 * The credential kind for a token row: Grok's registered client_credentials
 * client is told apart from every other OAuth client by its registration, not
 * by anything the caller sends.
 */
export function credentialKindOf(
  kind: string | null | undefined,
  oauthClient: { registrationKind: string; clientName: string } | null | undefined,
): string | null {
  if (oauthClient?.registrationKind === "credentials" && oauthClient.clientName === GROK_CREDENTIALS_CLIENT_NAME) {
    return GROK_OWN_CREDENTIAL_KIND;
  }
  return kind ?? null;
}

/** Default grace before a raised floor is enforced (design §5.2d, §11 decision 2). */
export const TOOLCHAIN_FLOOR_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the floor's grace window has ended. With no (or an unreadable)
 * `graceStartsAt`, grace has not started, so it has not ended either.
 */
export function toolchainFloorGraceEnded(floor: PublishedToolchain["floor"], now: Date): boolean {
  if (!floor.graceStartsAt) return false;
  const start = Date.parse(floor.graceStartsAt);
  if (!Number.isFinite(start)) return false;
  return now.getTime() >= start + TOOLCHAIN_FLOOR_GRACE_MS;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const DIGEST_PREFIX_RE = /^[0-9a-f]{16}$/;
export const TOOLCHAIN_HEADER = "x-dpf-toolchain";

function readHeaderDeclaration(value: string | null): Partial<ToolchainDeclaration> {
  if (!value) return {};
  const parts = Object.fromEntries(
    value.split(";").map((part) => part.trim().split("=", 2).map((s) => s.trim())).filter((kv) => kv.length === 2),
  ) as Record<string, string>;
  return { pack: parts.pack, digest: parts.digest, client: parts.client };
}

/**
 * The declaration a connector carries, from the query (`dpf_pack`, `dpf_digest`,
 * `dpf_client`) or the `X-DPF-Toolchain` header. Anything malformed or for an
 * unknown client kind is no declaration at all.
 */
export function parseToolchainDeclaration(url: string, headers: Pick<Headers, "get">): ToolchainDeclaration | null {
  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return null;
  }
  const fromHeader = readHeaderDeclaration(headers.get(TOOLCHAIN_HEADER));
  const pack = params.get("dpf_pack") ?? fromHeader.pack;
  const digest = (params.get("dpf_digest") ?? fromHeader.digest)?.toLowerCase();
  const client = params.get("dpf_client") ?? fromHeader.client;
  if (!pack || !SEMVER_RE.test(pack)) return null;
  if (!digest || !DIGEST_PREFIX_RE.test(digest)) return null;
  if (!client || !Object.hasOwn(DECLARING_CLIENT_KINDS, client)) return null;
  return { pack, digest, client };
}

function compareSemver(left: string, right: string): number {
  const a = SEMVER_RE.exec(left);
  const b = SEMVER_RE.exec(right);
  if (!a || !b) return 0;
  for (let index = 1; index <= 3; index += 1) {
    const diff = Number(a[index]) - Number(b[index]);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type VerdictResult = { verdict: ToolchainVerdict; reasons: string[] };

/**
 * Compare one connection's declaration with the published toolchain.
 *
 * The floor's rules apply only once a release configures one
 * (`floor.minPackVersion`): a declared pack older than it, a bearer where the
 * canonical credential policy says OAuth is available, or Grok on anything but
 * its own OAuth credentials client. Grace changes only the Grok rule: during
 * grace, Grok on another credential is `stale`, and after it `below-floor`
 * (DI-4B843FAF62F9). Refusing writes is BI-DFC0270C's job.
 */
export function resolveToolchainVerdict(input: {
  declaration: ToolchainDeclaration | null;
  credential: ConnectionCredential;
  mcpEndpoint: string;
  published: PublishedToolchain;
  now: Date;
}): VerdictResult {
  const { declaration, credential, mcpEndpoint, published, now } = input;
  if (!declaration) return { verdict: "undeclared", reasons: ["the connection declares no DPF toolchain"] };

  const reasons: string[] = [];
  const staleReasons: string[] = [];
  const min = published.floor.minPackVersion;
  if (min) {
    if (compareSemver(declaration.pack, min) < 0) reasons.push(`pack ${declaration.pack} is below the floor ${min}`);
    const bearer = credential.authSource === "pat";
    const policyClient = DECLARING_CLIENT_KINDS[declaration.client]!;
    if (declaration.client === "grok") {
      const own = credential.authSource === "oauth" && credential.credentialKind === GROK_OWN_CREDENTIAL_KIND;
      if (!own) {
        const reason = "Grok must connect with its own credentials client, not another token";
        (toolchainFloorGraceEnded(published.floor, now) ? reasons : staleReasons).push(reason);
      }
    } else if (bearer && !mcpClientBearerHeaderRequired(mcpEndpoint, policyClient)) {
      reasons.push(`${declaration.client} uses a stored token where this endpoint supports OAuth`);
    }
  }
  if (reasons.length > 0) return { verdict: "below-floor", reasons };

  if (!published.packDigest.startsWith(declaration.digest)) {
    staleReasons.push(`loaded pack ${declaration.pack} (${declaration.digest}) differs from the released ${published.packVersion}`);
  }
  if (staleReasons.length > 0) return { verdict: "stale", reasons: staleReasons };
  return { verdict: "current", reasons: [] };
}

/**
 * The `TOOLCHAIN:` line for the connection instructions. Addressed to the
 * agent: it states the gap and the repair, and never hands the user a command.
 * `probableClient` (a User-Agent hint) only decides whether an undeclared
 * caller looks like a DPF client worth telling; it never decides enforcement.
 */
export function formatToolchainNotice(input: {
  result: VerdictResult;
  declaration: ToolchainDeclaration | null;
  published: PublishedToolchain;
  manifestUrl: string;
  probableClient: string | null;
  /** The full did_… of this installation; the updater pins it (--expect-installation). */
  installationId?: string | null;
}): string | null {
  const { result, declaration, published, manifestUrl, probableClient, installationId } = input;
  if (result.verdict === "current") {
    return `TOOLCHAIN: current — this client loaded the released dpf-platform pack ${published.packVersion}.`;
  }
  if (result.verdict === "undeclared" && !probableClient) return null;
  const what =
    result.verdict === "undeclared"
      ? `this ${probableClient} client loaded a DPF toolchain copy that predates release declarations`
      : `this ${declaration!.client} client loaded pack ${declaration!.pack}; this release ships ${published.packVersion}`;
  const consequence =
    result.verdict === "below-floor"
      ? ` It is below this install's toolchain floor (${result.reasons.join("; ")}), so writes will be refused once the grace period ends.`
      : " Its skills, hooks or connector settings may be out of date.";
  return (
    `TOOLCHAIN: out of date — ${what}.${consequence} ` +
    `Repair: ask the user once, in plain words, for approval to update the DPF tools; then run the DPF toolchain update from this portal (${manifestUrl})` +
    (installationId ? `, expecting installation ${installationId}. ` : ". ") +
    "Never show the user a command. When it finishes, ask them to restart this client."
  );
}

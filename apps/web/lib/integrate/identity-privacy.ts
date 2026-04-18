/**
 * Identity Privacy — sanitizes git metadata to prevent leaking personal
 * information (hostnames, real names, emails) to public repositories.
 *
 * The platform uses pseudonymous identities for all public-facing git operations.
 * Every install carries a stable per-install discriminator (shortId) so the
 * community can recognize repeat contributors without exposing real identity:
 *   - Author name:  "dpf-agent-<shortId>"  (stable pseudonym, distinguishable per install)
 *   - Author email:  agent-<shortId>@hive.dpf  (matches the name)
 *   - Branch names:  dpf/<shortId>/... or build/<buildId>/... (no hostnames)
 *   - DCO signoff:   uses platform pseudonym, not personal identity
 *
 * Personal identity (real name, email) stays in the LOCAL database only.
 *
 * Pseudonymous (default): stable per-install identity, no personal info.
 * Attributed (opt-in, not yet implemented): customer-supplied org name for
 * partners who want recognition. See phase1-identity-privacy-decisions.md.
 */

import { prisma } from "@dpf/db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlatformIdentity {
  authorName: string;      // "dpf-agent-<shortId>" — stable pseudonym per install
  authorEmail: string;     // agent-<shortId>@hive.dpf
  clientId: string;        // UUID from PlatformDevConfig
  shortId: string;         // 8-char SHA256 slice derived from clientId
  dcoSignoff: string;      // "Signed-off-by: dpf-agent-<shortId> <agent-<shortId>@hive.dpf>"
}

// ─── Cached Identity ────────────────────────────────────────────────────────

let _cached: PlatformIdentity | null = null;

/**
 * Derives the 8-char public pseudonym from the seeded `gitAgentEmail`
 * (`agent-<16-char-sha256>@hive.dpf`). Taking 8 chars of the email's 16-char
 * hash keeps author name + email visibly consistent while staying short
 * enough to be readable. 8 hex chars = 2^32 namespace — no practical
 * collision risk at 10k+ installs.
 *
 * Note: `generatePrivateBranchName()` below uses a different 8-char slice
 * (derived from the raw clientId UUID) for branch naming. Branches are
 * internal routing; the display pseudonym here is what the community sees.
 */
function deriveShortIdFromEmail(gitAgentEmail: string): string {
  const localPart = gitAgentEmail.split("@")[0] ?? "";
  const hashPart = localPart.replace(/^agent-/, "");
  if (hashPart.length < 8) {
    throw new Error(
      `gitAgentEmail has unexpected format: ${gitAgentEmail} — expected agent-<hash>@hive.dpf`
    );
  }
  return hashPart.slice(0, 8);
}

/**
 * Returns the pseudonymous platform identity for this install.
 * Used for all git metadata that may flow to public repositories.
 */
export async function getPlatformIdentity(): Promise<PlatformIdentity> {
  if (_cached) return _cached;

  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { clientId: true, gitAgentEmail: true },
  });

  if (!config?.clientId || !config?.gitAgentEmail) {
    throw new Error(
      "Platform identity not initialized. Re-run the seed: docker compose restart portal-init"
    );
  }

  const shortId = deriveShortIdFromEmail(config.gitAgentEmail);
  const authorName = `dpf-agent-${shortId}`;

  _cached = {
    authorName,
    authorEmail: config.gitAgentEmail,
    clientId: config.clientId,
    shortId,
    dcoSignoff: `Signed-off-by: ${authorName} <${config.gitAgentEmail}>`,
  };

  return _cached;
}

/**
 * Returns the install's public pseudonym (e.g. `dpf-agent-a1b2c3d4`).
 * Callers that only need the display handle — UI labels, issue titles, PR
 * body headers — should prefer this over loading the full identity.
 */
export async function getDisplayPseudonym(): Promise<string> {
  const identity = await getPlatformIdentity();
  return identity.authorName;
}

/**
 * Clears the cached identity. Test-only — lets Vitest swap mocked prisma
 * state between cases without leaking the first-call cache.
 * @internal
 */
export function __resetPlatformIdentityCacheForTests(): void {
  _cached = null;
}

// ─── Sanitization ───────────────────────────────────────────────────────────

/** Patterns that indicate hostname/machine-name leaks in git metadata. */
const HOSTNAME_PATTERNS = [
  /\bDESKTOP-[A-Z0-9]+\b/gi,
  /\bWORKSTATION-[A-Z0-9]+\b/gi,
  /\bLAPTOP-[A-Z0-9]+\b/gi,
  /\bWIN-[A-Z0-9]+\b/gi,
  /\bip-\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\b/gi,  // AWS-style hostname
];

/**
 * Checks a string for hostname/machine-name patterns.
 * Returns the matched patterns or empty array if clean.
 */
export function detectHostnameLeaks(text: string): string[] {
  const leaks: string[] = [];
  for (const pattern of HOSTNAME_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) leaks.push(match[0]);
  }
  return leaks;
}

/**
 * Strips hostname patterns from a string, replacing them with "[redacted]".
 */
export function redactHostnames(text: string): string {
  let result = text;
  for (const pattern of HOSTNAME_PATTERNS) {
    result = result.replace(pattern, "[redacted]");
  }
  return result;
}

/**
 * Generates a privacy-safe branch name for upstream contributions.
 * Format: dpf/<clientId-short>/<feature-slug>
 */
export function generatePrivateBranchName(
  clientId: string,
  featureSlug: string,
): string {
  const shortId = clientId.replace(/-/g, "").slice(0, 8);
  const slug = featureSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `dpf/${shortId}/${slug}`;
}

// ─── Hive Token Resolution ──────────────────────────────────────────────────

/**
 * Resolve the token for pushing branches to the upstream hive repo.
 *
 * Priority:
 *   1. HIVE_CONTRIBUTION_TOKEN env var (explicit hive token)
 *   2. hive-contribution CredentialEntry (seeded or admin-configured)
 *   3. GITHUB_TOKEN env var (legacy fallback)
 *   4. git-backup CredentialEntry (customer's own PAT — fork_only backup)
 *
 * Returns null if no token is available.
 */
export async function resolveHiveToken(): Promise<string | null> {
  // 1. Explicit env var
  if (process.env.HIVE_CONTRIBUTION_TOKEN) {
    return process.env.HIVE_CONTRIBUTION_TOKEN;
  }

  // 2. Hive credential from DB
  const hiveCred = await prisma.credentialEntry.findUnique({
    where: { providerId: "hive-contribution" },
    select: { secretRef: true, status: true },
  });
  if (hiveCred?.status === "active" && hiveCred.secretRef) {
    // May be encrypted — try decryption, fall back to raw
    try {
      const { decryptSecret } = await import("@/lib/credential-crypto");
      return decryptSecret(hiveCred.secretRef);
    } catch {
      return hiveCred.secretRef;
    }
  }

  // 3. GITHUB_TOKEN env var (legacy)
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }

  // 4. git-backup credential (customer's own token)
  const backupCred = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { secretRef: true, status: true },
  });
  if (backupCred?.status === "active" && backupCred.secretRef) {
    try {
      const { decryptSecret } = await import("@/lib/credential-crypto");
      return decryptSecret(backupCred.secretRef);
    } catch {
      return backupCred.secretRef;
    }
  }

  return null;
}

/**
 * Generates a commit message using platform identity (no personal info).
 */
export function generateAnonymousCommitMessage(input: {
  title: string;
  buildId: string;
  productId: string | null;
  platformIdentity: PlatformIdentity;
  dcoAcceptedAt?: Date;
}): string {
  const lines = [
    `feat: ${input.title}`,
    "",
    `Build: ${input.buildId}`,
  ];
  if (input.productId) lines.push(`Product: ${input.productId}`);
  lines.push(`Author: ${input.platformIdentity.authorName} (AI Coworker)`);
  lines.push("Change-Type: ai-proposed");
  lines.push("");
  lines.push(input.platformIdentity.dcoSignoff);
  if (input.dcoAcceptedAt) {
    lines.push(`DCO-Accepted: ${input.dcoAcceptedAt.toISOString()}`);
  }
  return lines.join("\n");
}

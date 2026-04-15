/**
 * Identity Privacy — sanitizes git metadata to prevent leaking personal
 * information (hostnames, real names, emails) to public repositories.
 *
 * The platform uses anonymous identities for all public-facing git operations:
 *   - Author name:  "dpf-agent"  (identical across all installs)
 *   - Author email:  agent-<hash>@hive.dpf  (unique per install, anonymous)
 *   - Branch names:  dpf/<instanceId>/... or build/<buildId>/... (no hostnames)
 *   - DCO signoff:   uses platform identity, not personal identity
 *
 * Personal identity (real name, email) stays in the LOCAL database only.
 */

import { prisma } from "@dpf/db";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PlatformIdentity {
  authorName: string;      // Always "dpf-agent"
  authorEmail: string;     // agent-<hash>@hive.dpf
  clientId: string;        // UUID from PlatformDevConfig
  dcoSignoff: string;      // "Signed-off-by: dpf-agent <agent-xxx@hive.dpf>"
}

// ─── Cached Identity ────────────────────────────────────────────────────────

let _cached: PlatformIdentity | null = null;

/**
 * Returns the anonymous platform identity for this install.
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

  _cached = {
    authorName: "dpf-agent",
    authorEmail: config.gitAgentEmail,
    clientId: config.clientId,
    dcoSignoff: `Signed-off-by: dpf-agent <${config.gitAgentEmail}>`,
  };

  return _cached;
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

// apps/web/lib/platform/platform-dev-config-core.ts
//
// Pure (no prisma / auth / Next.js / fs / child_process) domain helpers
// extracted from lib/actions/platform-dev-config.ts (BI-OPT-FAT-ACTIONS,
// platform-dev-config slice). Two themes live here:
//
//   1. GitHub-token validation primitives — auth-method prefix detection,
//      X-OAuth-Scopes header parsing, scope-hierarchy satisfaction, and token
//      expiry header parsing (plus the ValidateToken* shapes they type).
//   2. Git-merge string/error primitives — POSIX single-quote shell escaping,
//      git error-text flattening, and missing-reference error classification.
//
// These functions are side-effect-free (no I/O, no clock reads), so the
// deterministic logic lives in the platform-config domain layer and is
// unit-testable on its own. Behavior-preserving relocation — identical bodies,
// mirroring the EA slice (ea-core.ts), CRM slice (crm-core.ts), and Build slice
// (build-actions-core.ts).
//
// Orchestration (auth() checks, prisma, revalidatePath, fetch(), fs/exec via
// lazy-node, the "use server" wrappers) STAYS in lib/actions/platform-dev-config.ts
// and imports these helpers back.

import { getErrorMessage } from "@/lib/shared/get-error-message";

// ─── GitHub token validation ─────────────────────────────────────────────────

export interface ValidateTokenInput {
  token: string;
  requiredScope?: "public_repo" | "repo" | "contents:write";
  expectedOwner?: string;
  requireNonExpired?: boolean;
  authMethod?: "oauth-device" | "fine-grained-pat" | "classic-pat" | "auto";
  model?: "maintainer-direct" | "fork-pr";
  machineUser?: boolean;
}

export interface ValidateTokenResult {
  valid: boolean;
  username?: string;
  scope?: string;
  expiresAt?: Date | null;
  authMethod?: "oauth-device" | "fine-grained-pat" | "classic-pat";
  error?: string;
}

export function detectAuthMethod(
  token: string,
): "oauth-device" | "fine-grained-pat" | "classic-pat" | null {
  if (token.startsWith("gho_")) return "oauth-device";
  if (token.startsWith("github_pat_")) return "fine-grained-pat";
  if (token.startsWith("ghp_")) return "classic-pat";
  return null; // ghs_ (app install), ghr_ (refresh), or malformed
}

export function parseScopesHeader(headerValue: string | null): Set<string> {
  if (!headerValue) return new Set();
  return new Set(
    headerValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Does the token carry enough scope for the caller's requirement?
 *
 * GitHub's classic-PAT scopes form a small hierarchy: `repo` is a superset of
 * `public_repo`, and (at the repo level) also grants write on file contents
 * which is what `contents:write` represents for fine-grained PATs. We treat
 * `repo` as satisfying any of our three required values.
 */
export function scopeSatisfies(granted: Set<string>, required: ValidateTokenInput["requiredScope"]): boolean {
  if (!required) return true;
  if (granted.has("repo")) return true;
  return granted.has(required);
}

export function parseExpiryHeader(headerValue: string | null): Date | null {
  if (!headerValue) return null;
  const parsed = new Date(headerValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

// ─── Git-merge string / error primitives ─────────────────────────────────────

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function gitErrorText(err: unknown): string {
  if (!err || typeof err !== "object") {
    return getErrorMessage(err);
  }
  const record = err as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [record.message, record.stderr, record.stdout]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

export function isMissingGitReferenceError(err: unknown, ref: string): boolean {
  const text = gitErrorText(err).toLowerCase();
  const normalizedRef = ref.toLowerCase();
  return (
    text.includes(normalizedRef) &&
    (text.includes("pathspec") ||
      text.includes("did not match") ||
      text.includes("not a commit") ||
      text.includes("unknown revision") ||
      text.includes("invalid reference") ||
      text.includes("could not resolve"))
  );
}

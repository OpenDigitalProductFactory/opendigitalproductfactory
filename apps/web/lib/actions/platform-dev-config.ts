"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { requireCapability } from "@/lib/actions/shared/guards";
import { getPlatformDevPolicyState, type PlatformDevPolicyState } from "@/lib/platform-dev-policy";
import {
  detectAuthMethod,
  isMissingGitReferenceError,
  parseExpiryHeader,
  parseScopesHeader,
  scopeSatisfies,
  shellQuote,
  type ValidateTokenInput,
  type ValidateTokenResult,
} from "@/lib/platform/platform-dev-config-core";
import { assertSafeOutboundUrl } from "@/lib/security/safe-fetch";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { lazyChildProcess, lazyFs, lazyPath, lazyUtil } from "@/lib/shared/lazy-node";
import { revalidatePath } from "next/cache";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireManagePlatform(): Promise<string> {
  return (await requireCapability("manage_platform")).userId;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

// Private-paths overrides (EP-1A78BAE1). Operator-managed glob rules that merge
// with the checked-in `.dpf/private-paths` manifest; matched paths never leave
// at public-hive egress.

export interface PrivatePathRuleView {
  id: string;
  pattern: string;
  reason: string | null;
  createdAt: string;
}

export async function listPrivatePathRules(): Promise<PrivatePathRuleView[]> {
  await requireManagePlatform();
  const rows = await prisma.privatePathRule.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, pattern: r.pattern, reason: r.reason, createdAt: r.createdAt.toISOString() }));
}

export async function addPrivatePathRule(pattern: string, reason?: string | null): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireManagePlatform();
  const p = pattern.trim();
  if (!p) return { ok: false, error: "Pattern is required." };
  if (p.length > 200) return { ok: false, error: "Pattern is too long." };
  try {
    await prisma.privatePathRule.create({
      data: { pattern: p, reason: reason?.trim() || null, createdById: userId },
    });
  } catch {
    return { ok: false, error: "That pattern already exists." };
  }
  revalidatePath("/admin/platform-development");
  return { ok: true };
}

export async function removePrivatePathRule(id: string): Promise<{ ok: boolean }> {
  await requireManagePlatform();
  await prisma.privatePathRule.deleteMany({ where: { id } });
  revalidatePath("/admin/platform-development");
  return { ok: true };
}

// 2-state contribution model (EP-1A78BAE1). Per-change sharing is decided by
// the FeatureBuild disposition (suggest-then-confirm), not by this mode.
const VALID_MODES = ["private", "contributing"] as const;
type ContributionMode = (typeof VALID_MODES)[number];

export async function savePlatformDevConfig(mode: ContributionMode) {
  const userId = await requireManagePlatform();

  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid contribution mode: ${mode}`);
  }

  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: {
      contributionMode: mode,
      configuredAt: new Date(),
      configuredById: userId,
    },
    create: {
      id: "singleton",
      contributionMode: mode,
      configuredAt: new Date(),
      configuredById: userId,
    },
  });

  revalidatePath("/admin/platform-development");
}

export async function getPlatformDevConfig() {
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    include: {
      configuredBy: { select: { email: true } },
      dcoAcceptedBy: { select: { email: true } },
    },
  });

  if (!config) return null;

  return {
    ...config,
    policyState: getPlatformDevPolicyState(config),
  };
}

export async function acceptDco(): Promise<{ accepted: boolean; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { accepted: false, error: "Not authenticated" };

  const config = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });

  if (config?.contributionMode === "private") {
    return { accepted: false, error: "DCO is not required for a private install" };
  }

  // Upsert to handle case where singleton doesn't exist yet (e.g., during onboarding)
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: {
      dcoAcceptedAt: new Date(),
      dcoAcceptedById: userId,
    },
    create: {
      id: "singleton",
      contributionMode: "contributing",
      dcoAcceptedAt: new Date(),
      dcoAcceptedById: userId,
      configuredAt: new Date(),
      configuredById: userId,
    },
  });

  revalidatePath("/admin/platform-development");
  return { accepted: true };
}

export async function getUntrackedFeatureCount(): Promise<number> {
  return prisma.featureBuild.count({
    where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
  });
}

export async function saveGitRemoteUrl(url: string | null): Promise<void> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: { gitRemoteUrl: url?.trim() || null },
    create: {
      id: "singleton",
      contributionMode: "private",
      gitRemoteUrl: url?.trim() || null,
      configuredAt: new Date(),
      configuredById: userId,
    },
  });

  revalidatePath("/admin/platform-development");
}

export async function saveGitBackupCredential(token: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  const { encryptSecret } = await import("@/lib/credential-crypto");
  const encrypted = encryptSecret(token);

  await prisma.credentialEntry.upsert({
    where: { providerId: "git-backup" },
    create: {
      providerId: "git-backup",
      secretRef: encrypted,
      status: "active",
    },
    update: {
      secretRef: encrypted,
      status: "active",
    },
  });

  revalidatePath("/admin/platform-development");
}

export async function hasGitBackupCredential(): Promise<boolean> {
  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { status: true },
  });
  return cred?.status === "active";
}

/**
 * True if resolveHiveToken() would return a non-null value from any source.
 *
 * Mirrors the four-priority chain in identity-privacy.ts so the admin UI can
 * tell the user accurately whether hive contributions will work without
 * leaking which slot the token lives in. Use this for CTAs like "Add a token"
 * — never use hasGitBackupCredential for that check, since it only looks at
 * the fork-only backup slot and misses HIVE_CONTRIBUTION_TOKEN /
 * hive-contribution credential.
 */
export async function hasContributionToken(): Promise<boolean> {
  if (process.env.HIVE_CONTRIBUTION_TOKEN) return true;
  if (process.env.GITHUB_TOKEN) return true;
  const hive = await prisma.credentialEntry.findUnique({
    where: { providerId: "hive-contribution" },
    select: { status: true, secretRef: true },
  });
  if (hive?.status === "active" && hive.secretRef) return true;
  const backup = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { status: true, secretRef: true },
  });
  return backup?.status === "active" && !!backup.secretRef;
}

/**
 * Retrieve the stored GitHub token (decrypted). Used by the contribution
 * pipeline when process.env.GITHUB_TOKEN is not set.
 * Returns null if no credential is stored or decryption fails.
 *
 * When the stored value is plaintext (no `enc:` prefix) AND
 * `CREDENTIAL_ENCRYPTION_KEY` is set, the row is opportunistically
 * re-encrypted in place. The `updateMany` guard clause makes the write
 * concurrent-safe — a simultaneous second caller lands a count=0 no-op
 * rather than double-encrypting.
 */
export async function getStoredGitHubToken(): Promise<string | null> {
  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { secretRef: true, status: true },
  });
  if (!cred || cred.status !== "active" || !cred.secretRef) return null;

  const stored = cred.secretRef;
  try {
    const { decryptSecret, encryptSecret } = await import("@/lib/credential-crypto");
    const decrypted = stored.startsWith("enc:") ? decryptSecret(stored) : stored;
    if (decrypted === null) return null;

    if (!stored.startsWith("enc:") && process.env.CREDENTIAL_ENCRYPTION_KEY) {
      const encrypted = encryptSecret(decrypted);
      if (encrypted.startsWith("enc:")) {
        await prisma.credentialEntry.updateMany({
          where: {
            providerId: "git-backup",
            NOT: { secretRef: { startsWith: "enc:" } },
          },
          data: { secretRef: encrypted },
        });
      }
    }

    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Resolve the "Connected as @username, since <date>" snapshot for the admin
 * UI's Connect GitHub card.
 *
 * Returns non-null only when the stored hive-contribution credential is a
 * Device-Flow OAuth token (`gho_` prefix). Paste-mode PATs are deliberately
 * not surfaced as "connected" — we don't want to imply Device-Flow-equivalent
 * status for tokens whose owner we never verified at save time.
 *
 * Probes GET /user to read the authenticated username. If the probe fails
 * (token revoked, network unreachable), returns null so the UI falls back to
 * the disconnected state — safer than misreporting a stale username.
 */
export async function getGitHubConnectedState(): Promise<{
  username: string;
  connectedAt: Date;
} | null> {
  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId: "hive-contribution" },
    select: { secretRef: true, status: true, updatedAt: true },
  });
  if (!cred || cred.status !== "active" || !cred.secretRef) return null;

  let token: string | null;
  try {
    const { decryptSecret } = await import("@/lib/credential-crypto");
    token = decryptSecret(cred.secretRef);
  } catch {
    return null;
  }

  if (!token || !token.startsWith("gho_")) return null;

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { login?: string };
    if (!data.login) return null;
    return { username: data.login, connectedAt: cred.updatedAt };
  } catch {
    return null;
  }
}

// ─── GitHub token validation ─────────────────────────────────────────────────
//
// Extended validator for the 2026-04-24 GitHub auth 2FA readiness spec. The
// single-arg form `validateGitHubToken(token)` is preserved for back-compat;
// the object form gains scope + expiry + prefix-based auth-method detection,
// plus an optional per-repo probe for fine-grained PATs where scopes are
// carried out-of-band (empty X-OAuth-Scopes header).
//
// `model` and `machineUser` are reserved for the 2026-04-23 public-contribution
// -mode plan (Task 5.2), which can land before or after this change. They are
// accepted here so callers that already pass them don't break the compile.

/** Hard-coded fallback when PlatformDevConfig doesn't carry an upstream URL. */
const UPSTREAM_OWNER_REPO_FALLBACK = "OpenDigitalProductFactory/opendigitalproductfactory";

/**
 * Validate a GitHub token by making a test API call.
 *
 * Single-arg form (back-compat): `validateGitHubToken(token)` — returns the
 * minimal legacy shape `{ valid, username?, error? }`.
 *
 * Object form: accepts additional constraints (scope, owner, expiry, auth
 * method) and returns the extended shape.
 */
export async function validateGitHubToken(
  token: string,
): Promise<{ valid: boolean; username?: string; error?: string }>;
export async function validateGitHubToken(
  input: ValidateTokenInput,
): Promise<ValidateTokenResult>;
export async function validateGitHubToken(
  arg: string | ValidateTokenInput,
): Promise<ValidateTokenResult> {
  const input: ValidateTokenInput = typeof arg === "string" ? { token: arg } : arg;
  const { token } = input;

  // Auth-method detection. "auto" (and "undefined" from the single-arg form)
  // both dispatch to the prefix detector; explicit values bypass detection.
  let resolvedAuthMethod: "oauth-device" | "fine-grained-pat" | "classic-pat" | undefined;
  if (input.authMethod && input.authMethod !== "auto") {
    resolvedAuthMethod = input.authMethod;
  } else {
    const detected = detectAuthMethod(token);
    if (input.authMethod === "auto" && !detected) {
      return {
        valid: false,
        error: "Token format not recognized. Expected gho_, github_pat_, or ghp_ prefix.",
      };
    }
    resolvedAuthMethod = detected ?? undefined;
  }

  try {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userResponse.ok) {
      if (userResponse.status === 401) {
        return { valid: false, error: "Token is invalid or expired." };
      }
      return { valid: false, error: `GitHub returned status ${userResponse.status}.` };
    }

    const data = (await userResponse.json()) as { login?: string };
    const username = data.login ?? "unknown";

    const scopesHeader = userResponse.headers.get("X-OAuth-Scopes");
    const grantedScopes = parseScopesHeader(scopesHeader);
    const expiresAt = parseExpiryHeader(
      userResponse.headers.get("github-authentication-token-expiration"),
    );

    // Owner check — unless machineUser opt-out explicitly allows mismatch.
    if (input.expectedOwner && !input.machineUser && username !== input.expectedOwner) {
      return {
        valid: false,
        username,
        authMethod: resolvedAuthMethod,
        error: `Token owner (${username}) does not match expected owner (${input.expectedOwner}). If this token belongs to a machine user, set machineUser: true.`,
      };
    }

    // Scope check (classic PAT). For fine-grained PATs, GitHub does not return
    // scopes via X-OAuth-Scopes; we verify access via a per-repo probe below.
    if (resolvedAuthMethod === "classic-pat" && input.requiredScope) {
      if (!scopeSatisfies(grantedScopes, input.requiredScope)) {
        return {
          valid: false,
          username,
          authMethod: resolvedAuthMethod,
          scope: scopesHeader ?? undefined,
          expiresAt,
          error: `Token is missing required scope '${input.requiredScope}'. Granted: ${scopesHeader || "(none)"}.`,
        };
      }
    }

    // Expiry gate — only enforced if requireNonExpired was passed. A fine-
    // grained PAT expiring in less than 30 days is rejected; we still surface
    // expiresAt so callers can warn the user ahead of time.
    if (input.requireNonExpired && expiresAt) {
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / msPerDay);
      if (daysLeft < 30) {
        return {
          valid: false,
          username,
          authMethod: resolvedAuthMethod,
          scope: scopesHeader ?? undefined,
          expiresAt,
          error: `Token expires in ${daysLeft} day(s). Rotate to a token with at least 30 days remaining.`,
        };
      }
    }

    // Per-repo probe (fine-grained PAT). Fine-grained tokens don't report
    // their scopes via X-OAuth-Scopes — the only reliable signal is whether
    // the token can actually reach the repo it's meant to act on.
    if (resolvedAuthMethod === "fine-grained-pat") {
      const probeOwner = input.expectedOwner ?? UPSTREAM_OWNER_REPO_FALLBACK.split("/")[0];
      const probeRepo = UPSTREAM_OWNER_REPO_FALLBACK.split("/")[1];
      // BI-5E53A265 fix (CodeQL alert #34). Same construction pattern
      // as github-fork.ts: hardcoded host + encodeURIComponent on the
      // user-supplied path parts. CodeQL recognises encodeURIComponent
      // as a path-component sanitiser.
      const probeUrl = `https://api.github.com/repos/${encodeURIComponent(String(probeOwner))}/${encodeURIComponent(String(probeRepo))}`;
      // Defense-in-depth — safe-fetch's full validation runs too.
      assertSafeOutboundUrl(probeUrl, { allowedHosts: ["api.github.com"] });

      const repoResponse = await fetch(probeUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (!repoResponse.ok) {
        return {
          valid: false,
          username,
          authMethod: resolvedAuthMethod,
          scope: scopesHeader ?? undefined,
          expiresAt,
          error: `Token can't access the fork repo ${String(probeOwner)}/${String(probeRepo)} (status ${repoResponse.status}). Check that the fine-grained PAT grants Contents: read/write on that repository.`,
        };
      }
    }

    return {
      valid: true,
      username,
      authMethod: resolvedAuthMethod,
      scope: scopesHeader ?? undefined,
      expiresAt,
    };
  } catch {
    return { valid: false, error: "Could not reach GitHub. Check your internet connection." };
  }
}

/**
 * Save the GitHub token and optionally validate it first.
 * Also sets the upstream remote URL to the platform repo.
 */
export async function saveContributionSetup(input: {
  token: string;
  mode: ContributionMode;
}): Promise<{ success: boolean; username?: string; error?: string }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: "Not authenticated" };

  // Validate token first
  const validation = await validateGitHubToken(input.token);
  if (!validation.valid) return { success: false, error: validation.error };

  // Save contribution mode
  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: {
      contributionMode: input.mode,
      configuredAt: new Date(),
      configuredById: userId,
      upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
    },
    create: {
      id: "singleton",
      contributionMode: input.mode,
      configuredAt: new Date(),
      configuredById: userId,
      upstreamRemoteUrl: "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git",
    },
  });

  // Encrypt and save the token to the hive-contribution slot.
  //
  // resolveHiveToken's priority #2 reads "hive-contribution"; writing there
  // makes the primary contribution path match the primary resolver lookup.
  // The "git-backup" slot remains reserved for saveGitBackupCredential
  // (fork_only backup) — resolveHiveToken still falls back to it at #4 so
  // existing installs that stored tokens via the old code path keep working.
  const { encryptSecret } = await import("@/lib/credential-crypto");
  const encrypted = encryptSecret(input.token);
  await prisma.credentialEntry.upsert({
    where: { providerId: "hive-contribution" },
    create: { providerId: "hive-contribution", secretRef: encrypted, status: "active" },
    update: { secretRef: encrypted, status: "active" },
  });

  revalidatePath("/admin/platform-development");
  return { success: true, username: validation.username };
}

// ─── Fork setup for the fork-pr contribution model ───────────────────────────
//
// Gated on CONTRIBUTION_MODEL_ENABLED at the UI layer; the action itself is
// safe to call regardless — it writes fork metadata but does NOT set
// contributionModel, so it has no dispatch-time effect until a later phase
// wires contribute_to_hive to branch on contributionModel.

const DEFAULT_UPSTREAM_URL =
  "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";

export type ConfigureForkSetupResult =
  | { success: true; status: "ready" | "deferred"; forkOwner: string; forkRepo: string }
  | { success: false; error: string };

export async function configureForkSetup(input: {
  contributorForkOwner: string;
  token: string;
}): Promise<ConfigureForkSetupResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: "Not authenticated" };

  if (!input.contributorForkOwner.trim()) {
    return { success: false, error: "GitHub username is required." };
  }

  // Validate token (reuses the /user call — confirms the token is live and
  // has API access; scope validation is layered in Phase 5).
  const validation = await validateGitHubToken(input.token);
  if (!validation.valid) {
    return { success: false, error: validation.error ?? "Token validation failed." };
  }

  // Parse upstream owner/repo from PlatformDevConfig.upstreamRemoteUrl, with
  // a documented default for installs that haven't been configured yet.
  const cfg = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { upstreamRemoteUrl: true },
  });
  const upstreamUrl = cfg?.upstreamRemoteUrl ?? DEFAULT_UPSTREAM_URL;
  const upstream = (await import("@/lib/forge/github-adapter")).parseGitHubRepositoryUrl(upstreamUrl);
  if (!upstream) {
    return { success: false, error: `Upstream URL is not a recognizable GitHub repo: ${upstreamUrl}` };
  }
  const { owner: upstreamOwner, repo: upstreamRepo } = upstream;

  const { forkExistsAndIsFork, createForkAndWait } = await import("@/lib/build/github-fork");

  // Does the contributor already own a fork? Three cases:
  //   (a) exists + is fork of upstream → use it.
  //   (b) exists but not a fork of upstream → fail actionably.
  //   (c) does not exist → create one and poll for readiness.
  //
  // Fork-rename case (admin renamed the fork repo) is out of scope; this
  // path looks up the fork by upstreamRepo name. If the admin renamed their
  // fork, they must rename it back or delete it before retrying.
  let existing: Awaited<ReturnType<typeof forkExistsAndIsFork>>;
  try {
    existing = await forkExistsAndIsFork({
      owner: input.contributorForkOwner,
      repo: upstreamRepo,
      upstreamOwner,
      upstreamRepo,
      token: input.token,
    });
  } catch (err) {
    return {
      success: false,
      error: `Could not check for an existing fork: ${getErrorMessage(err)}`,
    };
  }

  if (existing.exists && !existing.isFork) {
    return {
      success: false,
      error: `A repo ${input.contributorForkOwner}/${upstreamRepo} exists but is not a fork of ${upstreamOwner}/${upstreamRepo}. Rename it or delete it, then retry.`,
    };
  }

  let forkOwner: string;
  let forkRepo: string;
  let status: "ready" | "deferred";

  if (existing.exists && existing.isFork) {
    forkOwner = input.contributorForkOwner;
    forkRepo = upstreamRepo;
    status = "ready";
  } else {
    try {
      const created = await createForkAndWait({
        upstreamOwner,
        upstreamRepo,
        token: input.token,
      });
      forkOwner = created.forkOwner;
      forkRepo = created.forkRepo;
      status = created.status;
    } catch (err) {
      return {
        success: false,
        error: `Fork creation failed: ${getErrorMessage(err)}`,
      };
    }
  }

  await prisma.platformDevConfig.upsert({
    where: { id: "singleton" },
    update: {
      contributorForkOwner: forkOwner,
      contributorForkRepo: forkRepo,
      forkVerifiedAt: status === "ready" ? new Date() : null,
    },
    create: {
      id: "singleton",
      contributorForkOwner: forkOwner,
      contributorForkRepo: forkRepo,
      forkVerifiedAt: status === "ready" ? new Date() : null,
    },
  });

  revalidatePath("/admin/platform-development");
  return { success: true, status, forkOwner, forkRepo };
}

// ─── Apply Platform Update ──────────────────────────────────────────────────
//
// 2026-05-23 BI-9B77E247: The UpdatePendingBanner directs operators to
// /admin/platform-development to "review" a pending platform update, but the
// destination route previously had no Apply control — the merge logic only
// existed inside the `apply_platform_update` MCP tool case in mcp-tools.ts,
// reachable only via a coworker turn with the right grants. This action
// extracts that logic so both the MCP tool AND the in-portal UI invoke the
// same merge implementation. Single source of truth for "apply the queued
// platform update."
//
// Workflow (Docker portal install pattern):
//   1. Verify a pending update exists in PlatformDevConfig
//   2. If a partial merge is already in progress (.git/MERGE_HEAD exists),
//      return the existing conflict list — do NOT restart the merge.
//   3. Refresh dpf-upstream branch from /app/{apps,packages}-src
//   4. Merge dpf-upstream into my-changes (--no-commit --no-ff)
//   5. On conflicts: return structured list with upstream-vs-local previews;
//      do NOT auto-resolve.
//   6. On clean merge: commit, write .dpf-version sentinel, clear the
//      updatePending flag, return file-change summary.
//
// Maps to commandment-tier kernel principle
// `never-wipe-db-for-code-fixes` — this action touches /workspace only;
// PlatformDevConfig is updated via Prisma update, never delete + recreate.

export type ApplyPlatformUpdateConflict = {
  file: string;
  upstreamChange: string;
  localChange: string;
};

export type ApplyPlatformUpdateResult =
  | { kind: "engine-retired"; message: string }
  | { kind: "no-update-pending"; message: string }
  | { kind: "invalid-version"; message: string; version: string | null }
  | {
      kind: "clean-merge";
      message: string;
      version: string;
      filesUpdated: number;
    }
  | {
      kind: "conflicts";
      message: string;
      version: string;
      resumedMerge: boolean;
      conflicts: ApplyPlatformUpdateConflict[];
    }
  | { kind: "error"; message: string };

type ExecUpdateOptions = { cwd: string; timeout: number };
type ExecUpdate = (
  command: string,
  options: ExecUpdateOptions,
) => Promise<{ stdout: string; stderr: string }>;

const UPDATE_UPSTREAM_BRANCH = "dpf-upstream";
const UPDATE_WORK_BRANCH = "my-changes";
const HOOKLESS_GIT = "git -c core.hooksPath=/dev/null";
const PLATFORM_UPDATE_SOURCE_PATHS = ["apps/web", "packages"] as const;
const STALE_GIT_INDEX_LOCK_MS = 30_000;
const VERSION_SENTINEL_FILE = ".dpf-version";

// BI-4112378F: the image-sync snapshot path that builds `my-changes` and the
// source-copy path that builds `dpf-upstream` normalise line endings
// differently, so two trees that are byte-identical modulo CRLF↔LF diverge
// wholesale (verified: 4,186 files, ~99.96% of which collapse when CR-at-EOL
// is ignored). `-X ignore-cr-at-eol` makes the merge compare content the way
// the clean-check guards already do (see gitDiffHasRealChanges), neutralising
// the phantom conflicts at merge time. The `.gitattributes` policy below
// declares the durable normalisation contract so future commits on both
// branches converge on LF.
const MERGE_EOL_TOLERANT_OPTS = "-X ignore-cr-at-eol";
const GIT_ATTRIBUTES_FILE = ".gitattributes";
const GIT_ATTRIBUTES_POLICY = "* text=auto eol=lf\n";

async function ensureWorkspaceSafeDirectory(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  workspace: string,
): Promise<void> {
  await execUpdate(
    `git config --global --add safe.directory ${shellQuote(workspace)} >/dev/null 2>&1 || true`,
    gitOpts,
  );
}

/**
 * Read the installed-version sentinel (`.dpf-version`) written by the last
 * successful apply. Returns the trimmed contents, or null when the sentinel
 * is absent / unreadable (e.g. a freshly bootstrapped workspace).
 *
 * Used to short-circuit a redundant same-version apply: if the install is
 * already on `pendingVersion`, re-running the merge would only surface the
 * BI-4112378F phantom EOL conflicts, so we treat it as a no-op instead.
 */
function readInstalledVersion(
  workspace: string,
  resolvePath: (...parts: string[]) => string,
): string | null {
  const { readFileSync } = lazyFs();
  const sentinel = resolvePath(workspace, VERSION_SENTINEL_FILE);
  // Read directly and treat any failure (absent / unreadable) as "no sentinel".
  // Reading-then-catching rather than exists-then-read avoids a check-to-use
  // TOCTOU race (CodeQL js/file-system-race).
  try {
    const trimmed = readFileSync(sentinel, "utf-8").trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Ensure the durable line-ending normalisation policy (`.gitattributes`
 * `* text=auto eol=lf`) is present in the workspace and staged. Idempotent —
 * skips the write/add when the policy already matches. Declaring this on the
 * `dpf-upstream` refresh lands it on both managed branches once merged, so the
 * snapshot and source-copy population paths converge on LF going forward.
 */
async function ensureLineEndingPolicy(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  workspace: string,
  resolvePath: (...parts: string[]) => string,
): Promise<void> {
  const { readFileSync, writeFileSync } = lazyFs();
  const target = resolvePath(workspace, GIT_ATTRIBUTES_FILE);
  // Read-or-default rather than exists-then-read — avoids a check-to-use
  // TOCTOU race (CodeQL js/file-system-race). A missing/unreadable file just
  // means the policy isn't present yet, so we write it.
  let current = "";
  try {
    current = readFileSync(target, "utf-8");
  } catch {
    current = "";
  }
  if (current === GIT_ATTRIBUTES_POLICY) return;
  writeFileSync(target, GIT_ATTRIBUTES_POLICY, "utf-8");
  await execUpdate(`git add ${GIT_ATTRIBUTES_FILE}`, gitOpts);
}

function recoverStaleGitIndexLock(
  workspace: string,
  resolvePath: (...parts: string[]) => string,
): void {
  const { existsSync, statSync, unlinkSync } = lazyFs();
  const lockPath = resolvePath(workspace, ".git", "index.lock");
  if (!existsSync(lockPath)) return;

  const ageMs = Date.now() - statSync(lockPath).mtimeMs;
  if (ageMs < STALE_GIT_INDEX_LOCK_MS) {
    throw new Error(
      "Another platform update appears to be running. Wait a minute, then click Apply update again.",
    );
  }

  unlinkSync(lockPath);
}

async function gitBranchExists(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  branch: string,
): Promise<boolean> {
  try {
    await execUpdate(`git show-ref --verify --quiet refs/heads/${branch}`, gitOpts);
    return true;
  } catch {
    return false;
  }
}

async function ensureManagedUpdateBranches(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
): Promise<void> {
  await execUpdate("git rev-parse --is-inside-work-tree", gitOpts);
  await execUpdate('git config user.email "build-studio@dpf.local"', gitOpts);
  await execUpdate('git config user.name "DPF Build Studio"', gitOpts);
  // BI-4112378F: the managed workspace lives on a Windows/WSL bind mount where
  // the filesystem reports every file as executable. With the default
  // core.fileMode=true, the image-sync snapshot path's `git add` records a
  // spurious 100755 bit on ~every source file, while the source-copy path that
  // builds dpf-upstream records 100644 — so the two trees disagree on mode for
  // thousands of otherwise-identical files and the merge conflicts on each.
  // Persisting core.fileMode=false in .git/config stops BOTH population paths
  // from recording the executable bit going forward. (A merge-time -X flag
  // cannot fix this: the mode is baked into the committed trees.)
  await execUpdate("git config core.fileMode false", gitOpts);

  const missingBranches: string[] = [];
  for (const branch of [UPDATE_UPSTREAM_BRANCH, UPDATE_WORK_BRANCH]) {
    if (!(await gitBranchExists(execUpdate, gitOpts, branch))) missingBranches.push(branch);
  }

  if (missingBranches.length > 0) {
    await assertBranchRepairCanUseCurrentHead(execUpdate, gitOpts);
  }

  for (const branch of missingBranches) {
    await execUpdate(`git branch ${branch} HEAD`, gitOpts);
  }
}

async function assertManagedSourceClean(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
): Promise<void> {
  const pathspec = PLATFORM_UPDATE_SOURCE_PATHS.join(" ");
  const { stdout } = await execUpdate(`git status --porcelain -- ${pathspec}`, gitOpts);
  if (stdout.trim()) {
    const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
    const hasUntracked = lines.some((line) => line.startsWith("??"));
    if (!hasUntracked) {
      const hasRealDiff = await gitDiffHasRealChanges(
        execUpdate,
        gitOpts,
        pathspec,
        { cached: false },
      );
      const hasRealCachedDiff = await gitDiffHasRealChanges(
        execUpdate,
        gitOpts,
        pathspec,
        { cached: true },
      );
      if (!hasRealDiff && !hasRealCachedDiff) return;
    }
    throw new Error(
      "Workspace has uncommitted changes in apps/web or packages. Commit or resolve those source changes before applying a platform update.",
    );
  }
}

async function gitDiffHasRealChanges(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  pathspec: string,
  options: { cached: boolean },
): Promise<boolean> {
  const cachedArg = options.cached ? "--cached " : "";
  try {
    await execUpdate(
      `git diff ${cachedArg}--quiet --ignore-cr-at-eol -- ${pathspec}`,
      gitOpts,
    );
    return false;
  } catch {
    return true;
  }
}

async function assertBranchRepairCanUseCurrentHead(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
): Promise<void> {
  try {
    await execUpdate("git rev-parse --verify origin/main", gitOpts);
  } catch {
    return;
  }

  const pathspec = PLATFORM_UPDATE_SOURCE_PATHS.join(" ");
  const { stdout } = await execUpdate(
    `git diff --name-only origin/main...HEAD -- ${pathspec}`,
    gitOpts,
  );
  if (stdout.trim()) {
    throw new Error(
      "Workspace is missing managed update branches and has committed source changes in apps/web or packages. A safe upstream baseline cannot be reconstructed automatically.",
    );
  }
}

async function checkoutManagedUpdateBranch(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  branch: string,
): Promise<void> {
  try {
    await execUpdate(`${HOOKLESS_GIT} checkout -f ${branch}`, gitOpts);
    return;
  } catch (err) {
    if (!isMissingGitReferenceError(err, branch)) {
      throw err;
    }
  }

  await assertBranchRepairCanUseCurrentHead(execUpdate, gitOpts);
  await execUpdate(`git branch -f ${branch} HEAD`, gitOpts);
  await execUpdate(`${HOOKLESS_GIT} checkout -f ${branch}`, gitOpts);
}

async function collectPlatformUpdateConflicts(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  workspace: string,
  resolvePath: (...parts: string[]) => string,
  options: { tolerateDiffFailure?: boolean } = {},
): Promise<ApplyPlatformUpdateConflict[]> {
  let conflicted = "";
  try {
    const result = await execUpdate("git diff --name-only --diff-filter=U", gitOpts);
    conflicted = result.stdout;
  } catch {
    if (options.tolerateDiffFailure) return [];
    throw new Error("Unable to read platform update conflict list.");
  }

  const conflicts: ApplyPlatformUpdateConflict[] = [];
  const { readFileSync } = lazyFs();
  for (const file of conflicted.trim().split("\n").filter(Boolean)) {
    const content = readFileSync(resolvePath(workspace, file), "utf-8");
    const localMatch = content.match(/<<<<<<<[^\r\n]*(?:\r?\n)([\s\S]*?)(?:\r?\n)=======/);
    const upstreamMatch = content.match(/=======(?:\r?\n)([\s\S]*?)(?:\r?\n)>>>>>>>[^\r\n]*/);
    conflicts.push({
      file,
      upstreamChange: upstreamMatch?.[1]?.trim() ?? "(could not parse)",
      localChange: localMatch?.[1]?.trim() ?? "(could not parse)",
    });
  }
  return conflicts;
}

async function finishPlatformUpdateMerge(
  execUpdate: ExecUpdate,
  gitOpts: ExecUpdateOptions,
  workspace: string,
  resolvePath: (...parts: string[]) => string,
  pendingVersion: string,
): Promise<Extract<ApplyPlatformUpdateResult, { kind: "clean-merge" }>> {
  const { stdout: filesChanged } = await execUpdate(
    "git diff --cached --stat",
    gitOpts,
  );
  const fileCount = parseInt(
    (filesChanged.match(/(\d+) files? changed/) || ["0", "0"])[1] ?? "0",
    10,
  );
  await execUpdate(
    `${HOOKLESS_GIT} commit -s -m "chore: merge dpf v${pendingVersion}"`,
    gitOpts,
  );

  const { writeFileSync } = lazyFs();
  writeFileSync(
    resolvePath(workspace, ".dpf-version"),
    pendingVersion,
    "utf-8",
  );
  await execUpdate(
    "git update-index --skip-worktree .dpf-version 2>/dev/null || true",
    gitOpts,
  );

  await prisma.platformDevConfig.update({
    where: { id: "singleton" },
    data: { updatePending: false, pendingVersion: null },
  });

  revalidatePath("/admin/platform-development");
  revalidatePath("/", "layout"); // banner lives in shell layout

  return {
    kind: "clean-merge",
    message: `Platform updated to v${pendingVersion}. ${fileCount} files updated. No conflicts.`,
    version: pendingVersion,
    filesUpdated: fileCount,
  };
}

// ─── Engine B retirement (BI-5B6C1C35) ──────────────────────────────────────
//
// `applyPlatformUpdate` is the in-portal half of the RETIRED `/workspace`
// image-sync source-advance engine (Engine B). Per the governed-platform-upgrade
// spec §5.0 and the unified-delivery-surfaces spec §2 GAP 1, the running install
// advances ONLY via the canonical host-clone self-upgrade pipeline (Engine A:
// apps/web/lib/self-upgrade/*, scripts/promote.sh, Ops → Self-Upgrade). Two
// competing source-advance engines were the root cause of the
// stale-mislabeled-portal bug.
//
// The entrypoint no longer arms this path (it stopped writing
// `PlatformDevConfig.updatePending`; see docker-entrypoint.sh), so in normal
// operation this action is unreachable. We additionally HARD-REFUSE here as a
// belt-and-braces guard: even if a stale `updatePending=true` row survives from
// a pre-retirement image, the `/workspace` `my-changes` merge must not run and
// silently mutate the running container's source behind Engine A's back. The
// implementation below (merge helpers, branch repair, conflict parsing) is kept
// for now only so the deferred-removal diff stays small and reviewable.
//
// TODO(BI-5B6C1C35): once Engine A is confirmed as the sole advance path in
// production telemetry, delete `applyPlatformUpdate` and its merge helpers
// entirely, drop the `apply_platform_update` MCP tool, and remove the
// `PlatformUpdateApplyPanel` surface.
const ENGINE_B_RETIRED_MESSAGE =
  "Applying updates by merging into /workspace is retired. The platform now " +
  "updates only through the Self-Upgrade pipeline (Ops → Self-Upgrade), which " +
  "merges upstream into your install branch and rebuilds the portal from those " +
  "exact bytes. Open Self-Upgrade to check for and apply updates.";

export async function applyPlatformUpdate(): Promise<ApplyPlatformUpdateResult> {
  // Auth first so the refusal can't be used to probe state without permission.
  await requireManagePlatform();

  // Engine B retired (BI-5B6C1C35 / governed-upgrade spec §5.0). Refuse before
  // touching git or the DB so no /workspace source mutation can occur via this
  // path. Engine A (Self-Upgrade) is the sole sanctioned advance path. The
  // original `/workspace` merge implementation is preserved (uncalled) below as
  // `legacyApplyPlatformUpdateImpl` to keep the eventual removal diff small and
  // reviewable; see the TODO(BI-5B6C1C35) above.
  return { kind: "engine-retired", message: ENGINE_B_RETIRED_MESSAGE };
}

/**
 * RETIRED Engine B implementation (BI-5B6C1C35). No longer called — the
 * `/workspace` `my-changes` merge silently mutated the running container's
 * source, racing the canonical host-clone self-upgrade promoter (Engine A,
 * governed-upgrade spec §5.0). Kept verbatim for one release so the
 * deferred-removal diff is mechanical; do NOT re-wire it to any surface.
 */
async function legacyApplyPlatformUpdateImpl(): Promise<ApplyPlatformUpdateResult> {
  await requireManagePlatform();

  const { exec: execCb } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execUpdate = promisify(execCb) as ExecUpdate;

  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
  });
  if (!devConfig?.updatePending) {
    return {
      kind: "no-update-pending",
      message: "No platform update is pending.",
    };
  }

  const pendingVersion = devConfig.pendingVersion;
  if (!pendingVersion || !/^[0-9a-zA-Z._-]+$/.test(pendingVersion)) {
    return {
      kind: "invalid-version",
      message: "Pending version string failed validation.",
      version: pendingVersion ?? null,
    };
  }

  const workspace = process.env["PROJECT_ROOT"] ?? "/workspace";
  const gitOpts = { cwd: workspace, timeout: 180_000 };

  try {
    // Check for in-progress merge from a previous interrupted run
    const { existsSync } = lazyFs();
    const { resolve: resolvePath } = lazyPath();

    await ensureWorkspaceSafeDirectory(execUpdate, gitOpts, workspace);
    recoverStaleGitIndexLock(workspace, resolvePath);

    const mergeInProgress = existsSync(resolvePath(workspace, ".git", "MERGE_HEAD"));

    // BI-4112378F: short-circuit a redundant same-version apply. When the
    // install is already on `pendingVersion` (no merge mid-flight), there is
    // nothing to merge — proceeding would only re-derive the phantom EOL
    // conflicts between the snapshot-built and source-copied trees. Treat it
    // as a clean no-op: clear the pending flag and report zero files changed.
    if (!mergeInProgress) {
      const installedVersion = readInstalledVersion(workspace, resolvePath);
      if (installedVersion !== null && installedVersion === pendingVersion) {
        await prisma.platformDevConfig.update({
          where: { id: "singleton" },
          data: { updatePending: false, pendingVersion: null },
        });
        revalidatePath("/admin/platform-development");
        revalidatePath("/ops/self-upgrade");
        revalidatePath("/", "layout"); // banner lives in shell layout
        return {
          kind: "clean-merge",
          message: `Already on v${pendingVersion}. No changes to merge.`,
          version: pendingVersion,
          filesUpdated: 0,
        };
      }
    }

    if (mergeInProgress) {
      const conflicts = await collectPlatformUpdateConflicts(
        execUpdate,
        gitOpts,
        workspace,
        resolvePath,
      );
      if (conflicts.length === 0) {
        return await finishPlatformUpdateMerge(
          execUpdate,
          gitOpts,
          workspace,
          resolvePath,
          pendingVersion,
        );
      }
      return {
        kind: "conflicts",
        message: `A merge is already in progress. ${conflicts.length} conflict(s) remaining.`,
        version: pendingVersion,
        resumedMerge: true,
        conflicts,
      };
    }

    await assertManagedSourceClean(execUpdate, gitOpts);
    await ensureManagedUpdateBranches(execUpdate, gitOpts);

    // Step 1-3: Refresh dpf-upstream branch with new source
    await checkoutManagedUpdateBranch(execUpdate, gitOpts, UPDATE_UPSTREAM_BRANCH);
    await ensureLineEndingPolicy(execUpdate, gitOpts, workspace, resolvePath);
    await execUpdate("rm -rf apps/web packages", gitOpts);
    await execUpdate("cp -r /app/apps/web-src/. apps/web/", gitOpts);
    await execUpdate("cp -r /app/packages-src/. packages/", gitOpts);
    await execUpdate(`git add -A ${PLATFORM_UPDATE_SOURCE_PATHS.join(" ")}`, gitOpts);

    // Skip the commit if nothing actually changed (idempotent re-run)
    const { stdout: diffCheck } = await execUpdate(
      "git diff --cached --stat",
      gitOpts,
    );
    if (diffCheck.trim()) {
      await execUpdate(
        `${HOOKLESS_GIT} commit -s -m "chore: ${UPDATE_UPSTREAM_BRANCH} v${pendingVersion}"`,
        gitOpts,
      );
    }

    // Step 4: Merge into my-changes. `-X ignore-cr-at-eol` (BI-4112378F)
    // prevents the snapshot-vs-source CRLF↔LF mismatch from manufacturing
    // conflicts on otherwise-identical files. HOOKLESS_GIT keeps host
    // checkout/commit hooks (git-lfs, pre-commit) out of the merge.
    await checkoutManagedUpdateBranch(execUpdate, gitOpts, UPDATE_WORK_BRANCH);
    try {
      await execUpdate(
        `${HOOKLESS_GIT} merge ${MERGE_EOL_TOLERANT_OPTS} ${UPDATE_UPSTREAM_BRANCH} --no-commit --no-ff`,
        gitOpts,
      );
    } catch {
      // Merge conflicts surface as a non-zero exit — expected, handled below
    }

    const conflicts = await collectPlatformUpdateConflicts(
      execUpdate,
      gitOpts,
      workspace,
      resolvePath,
      { tolerateDiffFailure: true },
    );

    if (conflicts.length > 0) {
      return {
        kind: "conflicts",
        message: `Merge has conflicts. ${conflicts.length} file(s) need resolution.`,
        version: pendingVersion,
        resumedMerge: false,
        conflicts,
      };
    }

    // Clean merge — commit, write sentinel, clear pending flag
    return await finishPlatformUpdateMerge(
      execUpdate,
      gitOpts,
      workspace,
      resolvePath,
      pendingVersion,
    );
  } catch (err) {
    // Best-effort: leave my-changes checked out so the operator's working
    // copy is in a known state even when the merge step itself crashes.
    try {
      await checkoutManagedUpdateBranch(execUpdate, gitOpts, UPDATE_WORK_BRANCH);
    } catch {
      /* best effort — original error is already captured below */
    }
    return {
      kind: "error",
      message: `Platform update failed: ${getErrorMessage(err)}`,
    };
  }
}

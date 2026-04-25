"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getPlatformDevPolicyState, type PlatformDevPolicyState } from "@/lib/platform-dev-policy";
import { revalidatePath } from "next/cache";

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function requireManagePlatform(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_platform")) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

const VALID_MODES = ["fork_only", "selective", "contribute_all"] as const;
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

  if (config?.contributionMode === "fork_only") {
    return { accepted: false, error: "DCO is not required for fork_only mode" };
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
      contributionMode: "selective",
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
      contributionMode: "fork_only",
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

/** Hard-coded fallback when PlatformDevConfig doesn't carry an upstream URL. */
const UPSTREAM_OWNER_REPO_FALLBACK = "OpenDigitalProductFactory/opendigitalproductfactory";

function detectAuthMethod(
  token: string,
): "oauth-device" | "fine-grained-pat" | "classic-pat" | null {
  if (token.startsWith("gho_")) return "oauth-device";
  if (token.startsWith("github_pat_")) return "fine-grained-pat";
  if (token.startsWith("ghp_")) return "classic-pat";
  return null; // ghs_ (app install), ghr_ (refresh), or malformed
}

function parseScopesHeader(headerValue: string | null): Set<string> {
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
function scopeSatisfies(granted: Set<string>, required: ValidateTokenInput["requiredScope"]): boolean {
  if (!required) return true;
  if (granted.has("repo")) return true;
  return granted.has(required);
}

function parseExpiryHeader(headerValue: string | null): Date | null {
  if (!headerValue) return null;
  const parsed = new Date(headerValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

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
      const probeUrl = `https://api.github.com/repos/${probeOwner}/${probeRepo}`;

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
          error: `Token can't access the fork repo ${probeOwner}/${probeRepo} (status ${repoResponse.status}). Check that the fine-grained PAT grants Contents: read/write on that repository.`,
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
  const match = upstreamUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
  if (!match) {
    return { success: false, error: `Upstream URL is not a recognizable GitHub repo: ${upstreamUrl}` };
  }
  const [, upstreamOwner, upstreamRepo] = match;

  const { forkExistsAndIsFork, createForkAndWait } = await import("@/lib/integrate/github-fork");

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
      error: `Could not check for an existing fork: ${err instanceof Error ? err.message : String(err)}`,
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
        error: `Fork creation failed: ${err instanceof Error ? err.message : String(err)}`,
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

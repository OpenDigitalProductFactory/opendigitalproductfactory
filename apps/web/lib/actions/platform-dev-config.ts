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
 * Retrieve the stored GitHub token (decrypted). Used by the contribution
 * pipeline when process.env.GITHUB_TOKEN is not set.
 * Returns null if no credential is stored or decryption fails.
 */
export async function getStoredGitHubToken(): Promise<string | null> {
  const cred = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { secretRef: true, status: true },
  });
  if (!cred || cred.status !== "active" || !cred.secretRef) return null;

  try {
    const { decryptSecret } = await import("@/lib/credential-crypto");
    return decryptSecret(cred.secretRef);
  } catch {
    return null;
  }
}

/**
 * Validate a GitHub token by making a test API call.
 * Returns the authenticated username on success, or an error message.
 */
export async function validateGitHubToken(token: string): Promise<{
  valid: boolean;
  username?: string;
  error?: string;
}> {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      if (response.status === 401) return { valid: false, error: "Token is invalid or expired." };
      return { valid: false, error: `GitHub returned status ${response.status}.` };
    }

    const data = await response.json() as { login?: string };
    return { valid: true, username: data.login ?? "unknown" };
  } catch (err) {
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
      upstreamRemoteUrl: "https://github.com/markdbodman/opendigitalproductfactory.git",
    },
    create: {
      id: "singleton",
      contributionMode: input.mode,
      configuredAt: new Date(),
      configuredById: userId,
      upstreamRemoteUrl: "https://github.com/markdbodman/opendigitalproductfactory.git",
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

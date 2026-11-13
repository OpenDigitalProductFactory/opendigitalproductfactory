// Managed repository access (BI-985F4EC9).
// Design: docs/superpowers/specs/2026-10-14-managed-repository-connection-at-setup-design.md §3.3-3.4.
//
// An install that manages a GitHub repository logs in to it once through the
// device flow with the "repository-controller" purpose. This module owns the
// pieces that do not depend on a request: which repository the operator named,
// which OAuth scope that repository's visibility needs, and what a
// `GET /repos/{owner}/{repo}` answer means for the controller.
//
// The token never leaves this module's callers: no status, error or log line
// carries the token, a prefix of it, or anything but scope names.

import type { ForgeRepository } from "./types";
import { parseGitHubRepositoryUrl } from "./github-adapter";

/** CredentialEntry slot for the managed-repository login. */
export const REPOSITORY_CONTROLLER_PROVIDER_ID = "github-repository-controller";

/** CredentialEntry slot for the hive contribution login. */
export const HIVE_CONTRIBUTION_PROVIDER_ID = "hive-contribution";

/** Suggested (never implicitly saved) managed repository: the DPF upstream. */
export const SUGGESTED_MANAGED_REPOSITORY = "OpenDigitalProductFactory/opendigitalproductfactory";

/** How long a status check is reused before GitHub is asked again. */
export const MANAGED_REPOSITORY_STATUS_TTL_MS = 5 * 60 * 1000;

export type DeviceFlowPurpose = "hive-contribution" | "repository-controller";

export const DEVICE_FLOW_PURPOSES: readonly DeviceFlowPurpose[] = ["hive-contribution", "repository-controller"];

/** Prisma enum value for each purpose (the DB stores the hyphenated @map form). */
export const DEVICE_FLOW_PURPOSE_DB = {
  "hive-contribution": "hive_contribution",
  "repository-controller": "repository_controller",
} as const;

export function deviceFlowPurposeFromDb(value: string | null | undefined): DeviceFlowPurpose {
  return value === "repository_controller" ? "repository-controller" : "hive-contribution";
}

export function credentialSlotForPurpose(purpose: DeviceFlowPurpose): string {
  return purpose === "repository-controller" ? REPOSITORY_CONTROLLER_PROVIDER_ID : HIVE_CONTRIBUTION_PROVIDER_ID;
}

export type ManagedRepositoryStatus =
  | "connected"
  | "read-only"
  | "no-access"
  | "login-expired"
  | "not-connected"
  | "check-failed";

/** Operator-facing label per status (spec §3.4). */
export const MANAGED_REPOSITORY_STATUS_LABEL: Record<ManagedRepositoryStatus, string> = {
  connected: "Connected",
  "read-only": "Read only",
  "no-access": "No access",
  "login-expired": "Login expired",
  "not-connected": "Not connected",
  "check-failed": "Couldn't check",
};

export type RepositoryVisibility = "public" | "private" | "unknown";

export type ManagedRepositoryRef = ForgeRepository & { fullName: string };

/**
 * Parse what the operator typed: a GitHub URL, an SSH remote or `owner/name`.
 * Reuses parseGitHubRepositoryUrl; the bare form is expanded to an https URL
 * first so there is one parser.
 */
export function parseManagedRepositoryInput(input: string | null | undefined): ManagedRepositoryRef | null {
  const trimmed = input?.trim() ?? "";
  if (!trimmed) return null;
  const candidate = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(trimmed) ? `https://github.com/${trimmed}` : trimmed;
  const parsed = parseGitHubRepositoryUrl(candidate);
  if (!parsed) return null;
  return { ...parsed, fullName: `${parsed.owner}/${parsed.repo}` };
}

/** Canonical form written to PlatformDevConfig.upstreamRemoteUrl. */
export function managedRepositoryRemoteUrl(repo: Pick<ForgeRepository, "owner" | "repo">): string {
  return `https://github.com/${repo.owner}/${repo.repo}.git`;
}

/**
 * Least-privilege OAuth scope for the controller login: `public_repo` only
 * when every managed repository is known to be public, otherwise `repo`.
 */
export function scopeForVisibilities(visibilities: readonly RepositoryVisibility[]): "public_repo" | "repo" {
  if (visibilities.length === 0) return "repo";
  return visibilities.every((v) => v === "public") ? "public_repo" : "repo";
}

export type GitHubRepoResponse = {
  status: number;
  /** Parsed JSON body, when there was one. */
  body?: unknown;
  /** Lower-cased header lookup. */
  header?: (name: string) => string | null;
};

/** Map an unauthenticated `GET /repos/{owner}/{repo}` answer to a visibility. */
export function visibilityFromResponse(response: GitHubRepoResponse): RepositoryVisibility {
  if (response.status === 404) return "private";
  if (response.status !== 200) return "unknown";
  const body = response.body as { private?: unknown; visibility?: unknown } | undefined;
  if (body?.private === false || body?.visibility === "public") return "public";
  if (body?.private === true) return "private";
  return "unknown";
}

function isRateLimited(response: GitHubRepoResponse): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.header?.("x-ratelimit-remaining") === "0";
}

/**
 * Pure: what a `GET /repos/{owner}/{repo}` answer made WITH the controller
 * credential means (spec §3.4). The controller labels and comments on issues,
 * so it needs triage or higher; pull alone is "read-only".
 */
export function statusFromRepositoryResponse(response: GitHubRepoResponse): ManagedRepositoryStatus {
  if (response.status === 401) return "login-expired";
  if (isRateLimited(response)) return "check-failed";
  if (response.status === 404 || response.status === 403) return "no-access";
  if (response.status !== 200) return "check-failed";
  const permissions = (response.body as { permissions?: Record<string, unknown> } | undefined)?.permissions;
  if (!permissions || permissions.pull !== true) return "no-access";
  const canTriage = ["triage", "push", "maintain", "admin"].some((key) => permissions[key] === true);
  return canTriage ? "connected" : "read-only";
}

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

async function getRepository(
  repo: Pick<ForgeRepository, "owner" | "repo">,
  token: string | null,
  fetchImpl: FetchLike,
): Promise<GitHubRepoResponse> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetchImpl(
    `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`,
    { headers },
  );
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  return { status: res.status, body, header: (name) => res.headers.get(name) };
}

/** Unauthenticated visibility read; any failure is "unknown" (which asks for `repo`). */
export async function readRepositoryVisibility(
  repo: Pick<ForgeRepository, "owner" | "repo">,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<RepositoryVisibility> {
  try {
    return visibilityFromResponse(await getRepository(repo, null, fetchImpl));
  } catch {
    return "unknown";
  }
}

/** Check one repository with the controller credential. Network failure is "check-failed". */
export async function checkRepositoryAccess(
  repo: Pick<ForgeRepository, "owner" | "repo">,
  token: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<ManagedRepositoryStatus> {
  try {
    return statusFromRepositoryResponse(await getRepository(repo, token, fetchImpl));
  } catch {
    return "check-failed";
  }
}

/**
 * Pure: does this install manage a repository (spec §3.1)? Only a valid,
 * confirmed operating intent whose primary purpose is evolve-dpf. A missing,
 * invalid or unconfirmed intent is not enough to show the setup section.
 */
export function isRepositoryManagingInstall(
  loaded:
    | {
      status: "valid";
      intent: { primaryPurpose: string; secondaryPurposes?: readonly string[]; confirmation: { status: string } };
    }
    | { status: "missing" }
    | { status: "invalid"; error: string },
): boolean {
  return loaded.status === "valid"
    && loaded.intent.confirmation.status === "confirmed"
    && declaresRepositoryManagement(loaded.intent);
}

/**
 * `evolve-dpf` as the primary or a declared secondary purpose. An install that
 * operates an organisation can also own platform repository follow-through
 * (kernel decision DI-A6148958CADB).
 */
export function declaresRepositoryManagement(intent: {
  primaryPurpose?: unknown;
  secondaryPurposes?: unknown;
}): boolean {
  if (intent.primaryPurpose === "evolve-dpf") return true;
  return Array.isArray(intent.secondaryPurposes) && intent.secondaryPurposes.includes("evolve-dpf");
}

// ─── Status read model (cached) ─────────────────────────────────────────────

export type ManagedRepositoryStatusView = {
  repository: ManagedRepositoryRef | null;
  status: ManagedRepositoryStatus;
  /** When this status was established (ISO). */
  checkedAt: string;
  /** Last time a check reached GitHub and got an answer (ISO), for "Couldn't check". */
  lastAnsweredAt: string | null;
};

export type ManagedRepositoryDb = {
  platformDevConfig: {
    findUnique(args: { where: { id: string }; select: { upstreamRemoteUrl: true } }): Promise<{ upstreamRemoteUrl: string | null } | null>;
  };
  credentialEntry: {
    findUnique(args: { where: { providerId: string }; select: { secretRef: true; status: true } }): Promise<{ secretRef: string | null; status: string } | null>;
  };
};

type CacheEntry = { key: string; view: ManagedRepositoryStatusView; at: number };
let statusCache: CacheEntry | null = null;
let lastAnswered: { key: string; at: string } | null = null;

/** Drop the cached status (after a login, logout or repository change). */
export function invalidateManagedRepositoryStatus(): void {
  statusCache = null;
}

async function readControllerToken(db: ManagedRepositoryDb): Promise<string | null> {
  const cred = await db.credentialEntry.findUnique({
    where: { providerId: REPOSITORY_CONTROLLER_PROVIDER_ID },
    select: { secretRef: true, status: true },
  });
  if (!cred || cred.status !== "active" || !cred.secretRef) return null;
  try {
    const { decryptSecret } = await import("@/lib/credential-crypto");
    return cred.secretRef.startsWith("enc:") ? decryptSecret(cred.secretRef) : cred.secretRef;
  } catch {
    return null;
  }
}

/**
 * The managed repository's explicit configuration and its status. Never falls
 * back to a hardcoded repository: with nothing saved, `repository` is null.
 * Reuses a check for five minutes unless `force` is set.
 */
export async function loadManagedRepositoryStatus(
  db: ManagedRepositoryDb,
  options: { force?: boolean; now?: Date; fetchImpl?: FetchLike } = {},
): Promise<ManagedRepositoryStatusView> {
  const now = options.now ?? new Date();
  const cfg = await db.platformDevConfig.findUnique({ where: { id: "singleton" }, select: { upstreamRemoteUrl: true } });
  const repository = parseManagedRepositoryInput(cfg?.upstreamRemoteUrl ?? null);
  const token = await readControllerToken(db);

  if (!token) {
    return { repository, status: "not-connected", checkedAt: now.toISOString(), lastAnsweredAt: null };
  }
  if (!repository) {
    // A login with no repository to check is not a connection to anything.
    return { repository: null, status: "not-connected", checkedAt: now.toISOString(), lastAnsweredAt: null };
  }

  const key = repository.fullName.toLowerCase();
  if (!options.force && statusCache && statusCache.key === key && now.getTime() - statusCache.at < MANAGED_REPOSITORY_STATUS_TTL_MS) {
    return statusCache.view;
  }

  const status = await checkRepositoryAccess(repository, token, options.fetchImpl);
  if (status !== "check-failed") lastAnswered = { key, at: now.toISOString() };
  const view: ManagedRepositoryStatusView = {
    repository,
    status,
    checkedAt: now.toISOString(),
    lastAnsweredAt: lastAnswered?.key === key ? lastAnswered.at : null,
  };
  statusCache = { key, view, at: now.getTime() };
  return view;
}

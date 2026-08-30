import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import type { InitiativeArtifactRef } from "./receipt-schema";
import type { InitiativeSubject } from "./types";

type RepositoryLocator = Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>;

const MAX_REPOSITORY_ARTIFACT_BYTES = 1024 * 1024;

type RepositoryArtifactDb = {
  workroom: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{
      capsuleId: string;
      headBranch: string | null;
      headSha: string | null;
      createdByPrincipalId: string | null;
      activities: Array<{ recordedByAgentId: string | null }>;
    }>>;
  };
  principalAlias: {
    findMany: (args: Record<string, unknown>) => Promise<Array<{ principalId?: string; aliasValue?: string }>>;
  };
  credentialEntry: typeof prisma.credentialEntry;
  platformDevConfig: typeof prisma.platformDevConfig;
  scheduledJob: typeof prisma.scheduledJob;
};

export type ResolvedRepositoryArtifact = {
  digest: string;
  bytes: Uint8Array;
  /**
   * The principal accountable for the artifact: the capsule owner, corroborated
   * by the commit's DCO sign-off. Authorship is EVIDENCE about who is answerable
   * for the work, never a claim about which surface produced it (AGENTS.md §12,
   * `governance-approves-evidence-not-provenance`) — BI-B9403248.
   */
  authorPrincipalId: string;
  /** Optional context: the single agent that recorded capsule activity, when there is exactly one bound to the author. */
  authorAgentId: string | null;
  /** The DCO sign-off identity the resolver actually read, retained as evidence. */
  authorEmail: string;
};

export type ResolveRepositoryArtifactResult =
  | { ok: true; artifact: ResolvedRepositoryArtifact }
  | { ok: false; code: "ARTIFACT_AUTHOR_REQUIRED" | "CANONICAL_DESIGN_REQUIRED" | "CANONICAL_DESIGN_AMBIGUOUS"; error: string };

function encodePath(path: string): string | null {
  const pieces = path.split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")) return null;
  return pieces.map(encodeURIComponent).join("/");
}

type RepositoryProviderBlobResult =
  | ActionSuccess<Uint8Array>
  | {
      ok: false;
      code:
        | "CANONICAL_REPOSITORY_REQUIRED"
        | "IMMUTABLE_SOURCE_IDENTITY_INVALID"
        | "IMMUTABLE_SOURCE_UNAVAILABLE"
        | "IMMUTABLE_BLOB_MISMATCH"
        | "IMMUTABLE_SOURCE_TOO_LARGE";
      error: string;
    };

type GithubJsonFailure = {
  ok: false;
  kind: "transport" | "http" | "unreadable";
  attempts: number;
  status?: number;
};

type GithubJsonResult =
  | ActionSuccess<unknown>
  | GithubJsonFailure;

const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_PROVIDER_ATTEMPTS = 2;

function providerAttemptLabel(attempts: number): string {
  return `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
}

function providerFailureMessage(
  failure: GithubJsonFailure,
  labels: { unavailable: string; unreadable: string },
): string {
  const attempts = providerAttemptLabel(failure.attempts);
  if (failure.kind === "transport") {
    return `Repository provider could not resolve ${labels.unavailable} after ${attempts} (transport failure).`;
  }
  if (failure.kind === "http") {
    return `Repository provider could not resolve ${labels.unavailable} after ${attempts} (HTTP ${failure.status}).`;
  }
  return `Repository provider returned unreadable ${labels.unreadable} after ${attempts}.`;
}

async function fetchGithubJson(args: {
  url: string;
  token: string | null;
  fetchImpl: typeof fetch;
}): Promise<GithubJsonResult> {
  for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await args.fetchImpl(args.url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
        },
        cache: "no-store",
      });
    } catch {
      if (attempt < MAX_PROVIDER_ATTEMPTS) continue;
      return { ok: false, kind: "transport", attempts: attempt };
    }
    if (!response.ok) {
      if (attempt < MAX_PROVIDER_ATTEMPTS && RETRYABLE_PROVIDER_STATUSES.has(response.status)) continue;
      return { ok: false, kind: "http", attempts: attempt, status: response.status };
    }
    try {
      const payload: unknown = await response.json();
      return ok(payload);
    } catch {
      return { ok: false, kind: "unreadable", attempts: attempt };
    }
  }
  return { ok: false, kind: "transport", attempts: MAX_PROVIDER_ATTEMPTS };
}

function decodeGithubContent(payload: unknown, expectedBlobId: string): RepositoryProviderBlobResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "Repository provider returned unreadable artifact metadata." };
  }
  const row = payload as Record<string, unknown>;
  if (row.type !== "file" || row.encoding !== "base64" || typeof row.content !== "string") {
    return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "Repository provider returned unreadable artifact metadata." };
  }
  if (row.sha !== expectedBlobId) {
    return { ok: false, code: "IMMUTABLE_BLOB_MISMATCH", error: "Repository provider blob identity does not match the requested locator." };
  }
  if (typeof row.size === "number" && row.size > MAX_REPOSITORY_ARTIFACT_BYTES) {
    return { ok: false, code: "IMMUTABLE_SOURCE_TOO_LARGE", error: "Repository artifact exceeds the 1 MiB immutable reader ceiling." };
  }
  const bytes = Buffer.from(row.content.replace(/\s/g, ""), "base64");
  return bytes.byteLength <= MAX_REPOSITORY_ARTIFACT_BYTES
    ? ok(bytes)
    : { ok: false, code: "IMMUTABLE_SOURCE_TOO_LARGE", error: "Repository artifact exceeds the 1 MiB immutable reader ceiling." };
}

async function fetchRepositoryProviderBlob(args: {
  owner: string;
  repo: string;
  token: string | null;
  commitSha: string;
  path: string;
  expectedBlobId: string;
  fetchImpl: typeof fetch;
}): Promise<RepositoryProviderBlobResult> {
  const encodedPath = encodePath(args.path);
  if (!encodedPath || !/^[a-f0-9]{40}$/i.test(args.commitSha) || !/^[a-f0-9]{40}$/i.test(args.expectedBlobId)) {
    return { ok: false, code: "IMMUTABLE_SOURCE_IDENTITY_INVALID", error: "Repository artifact locator is not a recognized immutable provider blob." };
  }
  const result = await fetchGithubJson({
    url: `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/contents/${encodedPath}?ref=${encodeURIComponent(args.commitSha)}`,
    token: args.token,
    fetchImpl: args.fetchImpl,
  });
  if (!result.ok) {
    return {
      ok: false,
      code: "IMMUTABLE_SOURCE_UNAVAILABLE",
      error: providerFailureMessage(result, {
        unavailable: "the immutable artifact",
        unreadable: "artifact metadata",
      }),
    };
  }
  return decodeGithubContent(result.data, args.expectedBlobId);
}

/**
 * Read one exact immutable blob from the installation's configured canonical
 * repository. This is the source-provider fallback for deployments whose
 * read-only git volume does not contain an open-PR commit object.
 */
export async function readRepositoryProviderBlob(args: {
  repositoryFullName: string;
  commitSha: string;
  path: string;
  expectedBlobId: string;
  db?: Pick<RepositoryArtifactDb, "credentialEntry" | "platformDevConfig" | "scheduledJob">;
  fetchImpl?: typeof fetch;
}): Promise<RepositoryProviderBlobResult> {
  const db = args.db ?? prisma;
  let repo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  let token: string | null;
  try {
    [repo, token] = await Promise.all([resolveRepoIdentity(db), resolveGithubToken(db)]);
  } catch {
    return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "Repository provider configuration is unavailable." };
  }
  if (`${repo.owner}/${repo.name}`.toLocaleLowerCase("en-US") !== args.repositoryFullName.toLocaleLowerCase("en-US")) {
    return { ok: false, code: "CANONICAL_REPOSITORY_REQUIRED", error: "Requested repository is not this installation's canonical repository." };
  }
  return fetchRepositoryProviderBlob({
    owner: repo.owner,
    repo: repo.name,
    token,
    commitSha: args.commitSha,
    path: args.path,
    expectedBlobId: args.expectedBlobId,
    fetchImpl: args.fetchImpl ?? fetch,
  });
}

function dcoEmail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const commit = (payload as Record<string, unknown>).commit;
  if (!commit || typeof commit !== "object" || Array.isArray(commit)) return null;
  const message = (commit as Record<string, unknown>).message;
  if (typeof message !== "string") return null;
  const matches = [...message.matchAll(/^Signed-off-by:\s+.+?\s+<([^<>\s@]+@[^<>\s@]+)>\s*$/gim)];
  const emails = [...new Set(matches.map((match) => match[1]!.toLocaleLowerCase("en-US")))];
  return emails.length === 1 ? emails[0]! : null;
}

/**
 * A subject carries a handful of live capsules (one per branch under work). The
 * cap keeps the ownership read bounded while leaving room to name the candidates
 * back to the caller.
 */
const CAPSULE_CANDIDATE_LIMIT = 20;

function describeCapsuleHead(capsule: { capsuleId: string; headBranch: string | null; headSha: string | null }): string {
  const branch = capsule.headBranch ?? "unknown branch";
  return `${capsule.capsuleId} (${branch}) has ${capsule.headSha ? `head ${capsule.headSha}` : "no recorded head"}`;
}

export async function resolveRepositoryArtifact(args: {
  locator: RepositoryLocator;
  subject: InitiativeSubject;
  db?: RepositoryArtifactDb;
  fetchImpl?: typeof fetch;
}): Promise<ResolveRepositoryArtifactResult> {
  const db = args.db ?? (prisma as unknown as RepositoryArtifactDb);
  let expectedRepo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  try {
    expectedRepo = await resolveRepoIdentity(db);
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Canonical repository identity is unavailable." };
  }
  const expectedFullName = `${expectedRepo.owner}/${expectedRepo.name}`;
  const encodedPath = encodePath(args.locator.path);
  if (args.locator.repositoryFullName.toLocaleLowerCase("en-US") !== expectedFullName.toLocaleLowerCase("en-US")
    || !/^[a-f0-9]{40}$/i.test(args.locator.commitSha)
    || !/^[a-f0-9]{40}$/i.test(args.locator.providerBlobId)
    || !encodedPath) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository artifact locator is not a recognized immutable provider blob." };
  }

  const subjectWhere = args.subject.kind === "backlog-item"
    ? { backlogItemId: args.subject.id }
    : args.subject.kind === "epic"
      ? { epicId: args.subject.id }
      : args.subject.kind === "feature-build"
        ? { featureBuildId: args.subject.id }
        : null;
  if (!subjectWhere) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "Repository artifacts require a capsule-backed initiative subject." };
  }
  // Read every LIVE capsule for the subject rather than only the exact-head one,
  // so a head mismatch can name the stale capsule and its remedy instead of
  // failing as an undifferentiated "missing or ambiguous" (BI-B9403248). Bounded:
  // a subject carries a handful of capsules, and the limit keeps it that way.
  const candidates = await db.workroom.findMany({
    where: {
      ...subjectWhere,
      repositoryFullName: args.locator.repositoryFullName,
      archivedAt: null,
      status: { notIn: ["abandoned", "cancelled"] },
    },
    take: CAPSULE_CANDIDATE_LIMIT,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: {
      capsuleId: true,
      headBranch: true,
      headSha: true,
      createdByPrincipalId: true,
      activities: {
        where: { recordedByAgentId: { not: null } },
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
        select: { recordedByAgentId: true },
      },
    },
  });
  const capsules = candidates.filter(
    (candidate) => (candidate.headSha ?? "").toLocaleLowerCase("en-US") === args.locator.commitSha.toLocaleLowerCase("en-US"),
  );
  if (capsules.length > 1) {
    return {
      ok: false,
      code: "CANONICAL_DESIGN_AMBIGUOUS",
      error: `Commit ${args.locator.commitSha} is claimed by more than one live workroom for this subject (${
        capsules.map(describeCapsuleHead).join("; ")
      }). Complete or abandon the workrooms that no longer own this branch, leaving exactly one.`,
    };
  }
  if (capsules.length === 0) {
    return {
      ok: false,
      code: "CANONICAL_DESIGN_AMBIGUOUS",
      error: candidates.length === 0
        ? `No live workroom for this subject is bound to ${args.locator.repositoryFullName}. Claim or adopt the branch first (claim_backlog_item_for_work or adopt_worktree), then retry.`
        : `No live workroom for this subject records head ${args.locator.commitSha}: ${
          candidates.map(describeCapsuleHead).join("; ")
        }${candidates.length === CAPSULE_CANDIDATE_LIMIT ? ` (first ${CAPSULE_CANDIDATE_LIMIT} shown)` : ""}. Sync the branch head with adopt_worktree(headBranch, headSha=${args.locator.commitSha}) — an amend, rebase, or squash after adoption rewrites the sha — then retry.`,
    };
  }
  let token: string | null;
  try {
    token = await resolveGithubToken(db);
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider credentials are unavailable." };
  }
  const commitResult = await fetchGithubJson({
    url: `https://api.github.com/repos/${encodeURIComponent(expectedRepo.owner)}/${encodeURIComponent(expectedRepo.name)}/commits/${encodeURIComponent(args.locator.commitSha)}`,
    token,
    fetchImpl: args.fetchImpl ?? fetch,
  });
  if (!commitResult.ok) {
    return {
      ok: false,
      code: commitResult.kind === "unreadable" ? "ARTIFACT_AUTHOR_REQUIRED" : "CANONICAL_DESIGN_REQUIRED",
      error: providerFailureMessage(commitResult, {
        unavailable: "immutable commit provenance",
        unreadable: "commit provenance",
      }),
    };
  }
  const commitPayload = commitResult.data;
  const email = dcoEmail(commitPayload);
  if (!email) {
    return {
      ok: false,
      code: "ARTIFACT_AUTHOR_REQUIRED",
      error: `Commit ${args.locator.commitSha} carries no single "Signed-off-by: Name <email>" trailer. Sign the commit off (git commit -s), push the rewritten sha, re-sync the workroom head with adopt_worktree, then retry.`,
    };
  }
  const capsule = capsules[0]!;
  // The accountable author is the capsule owner. The DCO sign-off is the
  // corroborating evidence: where the install has registered that email to a
  // principal, it must be the SAME principal — a mismatch is a real conflict and
  // fails loudly. Where no alias is registered, the absence is not evidence of
  // wrongdoing and does not veto the capsule's own accountability record.
  const authorPrincipalId = capsule.createdByPrincipalId;
  if (!authorPrincipalId) {
    return {
      ok: false,
      code: "ARTIFACT_AUTHOR_REQUIRED",
      error: `Workroom ${capsule.capsuleId} has no accountable principal, so the artifact author cannot be recorded. Re-adopt the branch from an authenticated session (adopt_worktree) and retry.`,
    };
  }
  const principals = await db.principalAlias.findMany({
    where: { aliasType: "email", aliasValue: email, issuer: "" },
    select: { principalId: true },
    take: 2,
  });
  if (principals.length > 1) {
    return {
      ok: false,
      code: "ARTIFACT_AUTHOR_REQUIRED",
      error: `DCO sign-off identity ${email} is registered to more than one principal, so authorship is ambiguous. Merge the duplicate principals or remove the stale email alias, then retry.`,
    };
  }
  const signOffPrincipalId = principals.length === 1 ? principals[0]?.principalId ?? null : null;
  if (signOffPrincipalId && signOffPrincipalId !== authorPrincipalId) {
    return {
      ok: false,
      code: "ARTIFACT_AUTHOR_REQUIRED",
      error: `Commit ${args.locator.commitSha} is signed off by ${email}, registered to principal ${signOffPrincipalId}, but workroom ${capsule.capsuleId} is owned by principal ${authorPrincipalId}. Record the artifact from the workroom whose owner signed the commit, or correct the email alias.`,
    };
  }
  // Agent participation is optional context. An external Claude/Codex/Grok
  // session records its activity under a human principal and has no agent id at
  // all; requiring one asked which surface produced the artifact.
  const participatingAgentIds = new Set(
    capsule.activities.map((activity) => activity.recordedByAgentId).filter((id): id is string => Boolean(id)),
  );
  const soleAgentId = participatingAgentIds.size === 1 ? [...participatingAgentIds][0]! : null;
  const agentAliases = soleAgentId
    ? await db.principalAlias.findMany({
      where: { principalId: authorPrincipalId, aliasType: "agent", aliasValue: soleAgentId, issuer: "" },
      select: { aliasValue: true },
      take: 2,
    })
    : [];
  const authorAgentId = soleAgentId && agentAliases.length === 1 ? soleAgentId : null;

  const providerBlob = await fetchRepositoryProviderBlob({
    owner: expectedRepo.owner,
    repo: expectedRepo.name,
    token,
    commitSha: args.locator.commitSha,
    path: args.locator.path,
    expectedBlobId: args.locator.providerBlobId,
    fetchImpl: args.fetchImpl ?? fetch,
  });
  if (!providerBlob.ok) {
    return {
      ok: false,
      code: providerBlob.code === "IMMUTABLE_BLOB_MISMATCH"
        ? "CANONICAL_DESIGN_AMBIGUOUS"
        : "CANONICAL_DESIGN_REQUIRED",
      error: providerBlob.error,
    };
  }
  return {
    ok: true,
    artifact: {
      digest: `sha256:${createHash("sha256").update(providerBlob.data).digest("hex")}`,
      bytes: providerBlob.data,
      authorPrincipalId,
      authorAgentId,
      authorEmail: email,
    },
  };
}

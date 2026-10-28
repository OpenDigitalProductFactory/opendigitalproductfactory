import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import {
  cancelGithubResponseBody,
  createGithubReadTransport,
  resolveGithubToken,
  resolveRepoIdentity,
  type GithubReadTransport,
} from "@/lib/contributor-change-lanes/github-rest-reader";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import type { InitiativeArtifactRef } from "./receipt-schema";
import type { InitiativeSubject } from "./types";
import type { InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { canonicalPlanMatchesArtifact, type CanonicalPlanSourceProof } from "./canonical-plan-source";
import {
  changesFromProviderCompare,
  commitRangeDigest,
  commitRangeHead,
  parseRepoCommitRangeRef,
  providerPatchText,
  renderCommitRangeText,
  type CommitRange,
  type ProviderRangeFile,
  type RangeChange,
  type RepoCommitRangeRef,
} from "./repo-commit-range";

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
  | (ActionSuccess<Uint8Array> & { /** The blob the provider actually served; equals expectedBlobId when one was given. */ blobId: string })
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
  transportCode?: string;
};

type GithubJsonResult =
  | ActionSuccess<unknown>
  | GithubJsonFailure;

const RETRYABLE_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_PROVIDER_ATTEMPTS = 2;

// Preserve useful transport evidence without returning messages, URLs, headers,
// or arbitrary provider-defined codes that may contain credentials.
const SAFE_TRANSPORT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT",
]);

function safeTransportCode(cause: unknown): string | undefined {
  for (let depth = 0; depth < 4 && cause && typeof cause === "object"; depth += 1) {
    const error = cause as { code?: unknown; cause?: unknown };
    if (typeof error.code === "string" && SAFE_TRANSPORT_CODES.has(error.code)) return error.code;
    cause = error.cause;
  }
  return undefined;
}

function providerAttemptLabel(attempts: number): string {
  return `${attempts} ${attempts === 1 ? "attempt" : "attempts"}`;
}

function providerFailureMessage(
  failure: GithubJsonFailure,
  labels: { unavailable: string; unreadable: string },
): string {
  const attempts = providerAttemptLabel(failure.attempts);
  if (failure.kind === "transport") {
    return `Repository provider could not resolve ${labels.unavailable} after ${attempts} (transport failure${failure.transportCode ? `: ${failure.transportCode}` : ""}).`;
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
    } catch (cause) {
      if (attempt < MAX_PROVIDER_ATTEMPTS) continue;
      return { ok: false, kind: "transport", attempts: attempt, transportCode: safeTransportCode(cause) };
    }
    if (!response.ok) {
      await cancelGithubResponseBody(response);
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

function decodeGithubContent(payload: unknown, expectedBlobId: string | null): RepositoryProviderBlobResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "Repository provider returned unreadable artifact metadata." };
  }
  const row = payload as Record<string, unknown>;
  if (row.type !== "file" || row.encoding !== "base64" || typeof row.content !== "string") {
    return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "Repository provider returned unreadable artifact metadata." };
  }
  if (typeof row.sha !== "string" || !/^[a-f0-9]{40}$/i.test(row.sha)) {
    return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE", error: "Repository provider returned unreadable artifact metadata." };
  }
  // A commit + path locator is already immutable; the blob id is verification
  // when the caller has one, not a precondition for serving the artifact.
  if (expectedBlobId !== null && row.sha !== expectedBlobId) {
    return { ok: false, code: "IMMUTABLE_BLOB_MISMATCH", error: "Repository provider blob identity does not match the requested locator." };
  }
  const blobId = row.sha;
  if (typeof row.size === "number" && row.size > MAX_REPOSITORY_ARTIFACT_BYTES) {
    return { ok: false, code: "IMMUTABLE_SOURCE_TOO_LARGE", error: "Repository artifact exceeds the 1 MiB immutable reader ceiling." };
  }
  const bytes = Buffer.from(row.content.replace(/\s/g, ""), "base64");
  return bytes.byteLength <= MAX_REPOSITORY_ARTIFACT_BYTES
    ? { ...ok(bytes), blobId }
    : { ok: false, code: "IMMUTABLE_SOURCE_TOO_LARGE", error: "Repository artifact exceeds the 1 MiB immutable reader ceiling." };
}

async function fetchRepositoryProviderBlob(args: {
  owner: string;
  repo: string;
  token: string | null;
  commitSha: string;
  path: string;
  expectedBlobId: string | null;
  fetchImpl: typeof fetch;
}): Promise<RepositoryProviderBlobResult> {
  const encodedPath = encodePath(args.path);
  if (
    !encodedPath
    || !/^[a-f0-9]{40}$/i.test(args.commitSha)
    || (args.expectedBlobId !== null && !/^[a-f0-9]{40}$/i.test(args.expectedBlobId))
  ) {
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
  /** Verification when known. A commit + path locator is served without it. */
  expectedBlobId?: string | null;
  db?: Pick<RepositoryArtifactDb, "credentialEntry" | "platformDevConfig" | "scheduledJob">;
  fetchImpl?: typeof fetch;
  transportFactory?: () => GithubReadTransport;
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
  let transport: GithubReadTransport | null = null;
  if (!args.fetchImpl) {
    try {
      transport = (args.transportFactory ?? createGithubReadTransport)();
    } catch {
      return {
        ok: false,
        code: "IMMUTABLE_SOURCE_UNAVAILABLE",
        error: "Repository provider transport is unavailable.",
      };
    }
  }
  try {
    return await fetchRepositoryProviderBlob({
      owner: repo.owner,
      repo: repo.name,
      token,
      commitSha: args.commitSha,
      path: args.path,
      expectedBlobId: args.expectedBlobId ?? null,
      fetchImpl: args.fetchImpl ?? transport!.fetch,
    });
  } finally {
    await transport?.close().catch(() => {});
  }
}

type ProviderCompareResult = { ok: true; files: ProviderRangeFile[] } | { ok: false; error: string };

/** BI-46E344FE: one range's canonical change list, from the provider compare. */
async function fetchProviderCompare(args: {
  owner: string; repo: string; token: string | null; range: CommitRange; fetchImpl: typeof fetch;
}): Promise<ProviderCompareResult> {
  const result = await fetchGithubJson({
    url: `https://api.github.com/repos/${encodeURIComponent(args.owner)}/${encodeURIComponent(args.repo)}/compare/${
      encodeURIComponent(args.range.baseSha)}...${encodeURIComponent(args.range.headSha)}`,
    token: args.token, fetchImpl: args.fetchImpl,
  });
  if (!result.ok) return { ok: false, error: providerFailureMessage(result, { unavailable: "the merged change", unreadable: "comparison metadata" }) };
  const files = changesFromProviderCompare(result.data);
  return files ? { ok: true, files }
    : { ok: false, error: `Repository provider returned an unreadable or truncated file list for ${args.range.baseSha.slice(0, 12)}..${args.range.headSha.slice(0, 12)}.` };
}

/** BI-46E344FE: the reader's provider fallback for a commit range on the canonical repository. */
export async function readRepositoryProviderCompare(args: CommitRange & {
  repositoryFullName: string;
  db?: Pick<RepositoryArtifactDb, "credentialEntry" | "platformDevConfig" | "scheduledJob">;
  fetchImpl?: typeof fetch;
}): Promise<ProviderCompareResult> {
  const db = args.db ?? prisma;
  let repo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  let token: string | null;
  try {
    [repo, token] = await Promise.all([resolveRepoIdentity(db), resolveGithubToken(db)]);
  } catch {
    return { ok: false, error: "Repository provider configuration is unavailable." };
  }
  if (`${repo.owner}/${repo.name}`.toLocaleLowerCase("en-US") !== args.repositoryFullName.toLocaleLowerCase("en-US")) {
    return { ok: false, error: "Requested repository is not this installation's canonical repository." };
  }
  let transport: GithubReadTransport | null = null;
  try {
    if (!args.fetchImpl) transport = createGithubReadTransport();
    return await fetchProviderCompare({ owner: repo.owner, repo: repo.name, token,
      range: { baseSha: args.baseSha, headSha: args.headSha }, fetchImpl: args.fetchImpl ?? transport!.fetch });
  } catch {
    return { ok: false, error: "Repository provider transport is unavailable." };
  } finally {
    await transport?.close().catch(() => {});
  }
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

/**
 * BI-CE661173: the receipt writer's own proof, resolved from the trunk outside
 * any transaction, that a post-implementation review's locator is the merged
 * squash commit that delivered the item, anchored to its delivery room. It lets
 * that room be retired (a merged repair's room normally is) and replaces the
 * "a later branch head still carries this blob" check, because the trunk commit
 * itself is the delivered source. Never accepted from a caller.
 */
export type MergedRepairProof = { workroomId: string; commitSha: string };

export async function resolveRepositoryArtifact(args: {
  /** A repository blob, or (BI-46E344FE) a merged repair's whole commit range. */
  locator: RepositoryLocator | RepoCommitRangeRef;
  subject: InitiativeSubject;
  mergedRepairProof?: MergedRepairProof;
  /** Internal context from the accepted TaskRun; never a caller-selected head. */
  workroomRef?: InitiativeReviewBinding["workroomRef"];
  /** Current baseline/coverage proof resolved internally by the receipt writer. */
  canonicalPlanProof?: CanonicalPlanSourceProof;
  db?: RepositoryArtifactDb;
  fetchImpl?: typeof fetch;
  transportFactory?: () => GithubReadTransport;
}): Promise<ResolveRepositoryArtifactResult> {
  const db = args.db ?? (prisma as unknown as RepositoryArtifactDb);
  let expectedRepo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  try {
    expectedRepo = await resolveRepoIdentity(db);
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Canonical repository identity is unavailable." };
  }
  const expectedFullName = `${expectedRepo.owner}/${expectedRepo.name}`;
  const range = args.locator.kind === "repo-commit-range" ? parseRepoCommitRangeRef(args.locator) : null;
  const blob = args.locator.kind === "repo-blob-at-commit" ? args.locator : null;
  if (args.locator.repositoryFullName.toLocaleLowerCase("en-US") !== expectedFullName.toLocaleLowerCase("en-US")
    || (blob ? !/^[a-f0-9]{40}$/i.test(blob.commitSha) || !/^[a-f0-9]{40}$/i.test(blob.providerBlobId) || !encodePath(blob.path)
      : !range)) {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository artifact locator is not a recognized immutable provider blob or commit range." };
  }
  // The commit the artifact is read at: the blob's commit, or the range's newest head.
  const locatorCommitSha = blob ? blob.commitSha : commitRangeHead(range!.ranges);

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
  const liveCapsule = { archivedAt: null, status: { notIn: ["abandoned", "cancelled"] } };
  const mergedRepair = args.mergedRepairProof && args.workroomRef
    && args.mergedRepairProof.workroomId === args.workroomRef.workroomId
    && args.mergedRepairProof.commitSha.toLowerCase() === locatorCommitSha.toLowerCase()
    ? args.mergedRepairProof : null;
  const candidates = await db.workroom.findMany({
    where: {
      ...subjectWhere,
      repositoryFullName: args.locator.repositoryFullName,
      ...(mergedRepair
        ? { OR: [liveCapsule, { capsuleId: mergedRepair.workroomId, status: { notIn: ["abandoned", "cancelled", "superseded"] } }] }
        : liveCapsule),
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
  const boundRoom = args.workroomRef;
  const planProof = args.canonicalPlanProof;
  if (planProof && (!boundRoom || !blob || args.subject.kind !== "backlog-item" || planProof.itemId !== args.subject.id
    || !planProof.baselineId || !planProof.scopeOwnerItemId || !/^sha256:[a-f0-9]{64}$/i.test(planProof.digest)
    || !canonicalPlanMatchesArtifact(planProof, blob))) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The canonical plan proof does not match this accepted review's subject and immutable artifact." };
  }
  if (boundRoom && (boundRoom.kind !== "workroom-head"
    || boundRoom.repositoryFullName !== args.locator.repositoryFullName
    || !/^[a-f0-9]{40}$/i.test(boundRoom.headSha))) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The accepted review's workroom binding is invalid for this repository artifact." };
  }
  // BI-46E344FE: a merged repair's anchor room that never recorded its head is
  // anchored to the merged head; the writer's trunk proof is what admits it.
  const recordedHead = (candidate: (typeof candidates)[number]) => candidate.headSha
    ?? (mergedRepair && candidate.capsuleId === mergedRepair.workroomId ? mergedRepair.commitSha : null);
  const capsules = candidates.filter((candidate) => boundRoom
    ? candidate.capsuleId === boundRoom.workroomId && candidate.headBranch === boundRoom.branchName
      && recordedHead(candidate)?.toLowerCase() === boundRoom.headSha.toLowerCase()
    : (candidate.headSha ?? "").toLowerCase() === locatorCommitSha.toLowerCase());
  // A live room's multi-file review reads its own range, which ends at its head.
  if (range && boundRoom && !mergedRepair && locatorCommitSha.toLowerCase() !== boundRoom.headSha.toLowerCase()) {
    return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS",
      error: "A commit range review must end at its Workroom's head, or be the item's merged repair proven on the trunk." };
  }
  if (capsules.length > 1) {
    return {
      ok: false,
      code: "CANONICAL_DESIGN_AMBIGUOUS",
      error: `Commit ${locatorCommitSha} is claimed by more than one live workroom for this subject (${
        capsules.map(describeCapsuleHead).join("; ")
      }). Complete or abandon the workrooms that no longer own this branch, leaving exactly one.`,
    };
  }
  if (capsules.length === 0) {
    if (boundRoom) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS",
        error: "The accepted review's exact live workroom, subject, branch or head changed. Reconcile the review packet with the actual workroom; do not rewrite the head to the historical artifact commit." };
    }
    return {
      ok: false,
      code: "CANONICAL_DESIGN_AMBIGUOUS",
      error: candidates.length === 0
        // BI-77C600B2: a plain implementation claim can be refused at the very
        // research gate this receipt satisfies; a design-intent claim cannot.
        ? `No live workroom for this subject is bound to ${args.locator.repositoryFullName}. Bind one first: claim_backlog_item_for_work with workIntent "design" (it does not owe research), or adopt_worktree; then retry.`
        : `No live workroom for this subject records head ${locatorCommitSha}: ${
          candidates.map(describeCapsuleHead).join("; ")
        }${candidates.length === CAPSULE_CANDIDATE_LIMIT ? ` (first ${CAPSULE_CANDIDATE_LIMIT} shown)` : ""}. Sync the branch head with adopt_worktree(headBranch, headSha=${locatorCommitSha}) — an amend, rebase, or squash after adoption rewrites the sha — then retry.`,
    };
  }
  let token: string | null;
  try {
    token = await resolveGithubToken(db);
  } catch {
    return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: "Repository provider credentials are unavailable." };
  }
  let transport: GithubReadTransport | null = null;
  if (!args.fetchImpl) {
    try {
      transport = (args.transportFactory ?? createGithubReadTransport)();
    } catch {
      return {
        ok: false,
        code: "CANONICAL_DESIGN_REQUIRED",
        error: "Repository provider transport is unavailable.",
      };
    }
  }
  const fetchImpl = args.fetchImpl ?? transport!.fetch;
  try {
    if (blob && boundRoom && !planProof && !mergedRepair && boundRoom.headSha.toLowerCase() !== blob.commitSha.toLowerCase()) {
      // The review retains the immutable original locator. A later branch head
      // may own it only when the provider proves the same path/blob is present.
      const currentBlob = await fetchRepositoryProviderBlob({
        owner: expectedRepo.owner, repo: expectedRepo.name, token, commitSha: boundRoom.headSha,
        path: blob.path, expectedBlobId: blob.providerBlobId, fetchImpl,
      });
      if (!currentBlob.ok) return { ok: false,
        code: currentBlob.code === "IMMUTABLE_BLOB_MISMATCH" ? "CANONICAL_DESIGN_AMBIGUOUS" : "CANONICAL_DESIGN_REQUIRED",
        error: currentBlob.error };
    }
    // BI-46E344FE: every commit of a range carries the same sign-off identity,
    // so one accountable author answers for the whole reviewed change.
    let email: string | null = null;
    for (const commitSha of blob ? [blob.commitSha] : range!.ranges.map((r) => r.headSha)) {
      const commitResult = await fetchGithubJson({
        url: `https://api.github.com/repos/${encodeURIComponent(expectedRepo.owner)}/${encodeURIComponent(expectedRepo.name)}/commits/${encodeURIComponent(commitSha)}`,
        token,
        fetchImpl,
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
      const commitEmail = dcoEmail(commitResult.data);
      if (!commitEmail || (email !== null && commitEmail !== email)) {
        return {
          ok: false,
          code: "ARTIFACT_AUTHOR_REQUIRED",
          error: commitEmail
            ? `The reviewed commits carry different sign-off identities (${email}, ${commitEmail}), so one accountable author cannot be recorded for the change.`
            : `Commit ${commitSha} carries no single "Signed-off-by: Name <email>" trailer. Sign the commit off (git commit -s), push the rewritten sha, re-sync the workroom head with adopt_worktree, then retry.`,
        };
      }
      email = commitEmail;
    }
    if (!email) return { ok: false, code: "ARTIFACT_AUTHOR_REQUIRED", error: "The reviewed commit carries no sign-off identity." };
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
      error: `Commit ${locatorCommitSha} is signed off by ${email}, registered to principal ${signOffPrincipalId}, but workroom ${capsule.capsuleId} is owned by principal ${authorPrincipalId}. Record the artifact from the workroom whose owner signed the commit, or correct the email alias.`,
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

    if (range) {
      // BI-46E344FE: re-read every range at the provider and require the bound digest.
      const changes: RangeChange[] = [];
      for (const r of range.ranges) {
        const compared = await fetchProviderCompare({ owner: expectedRepo.owner, repo: expectedRepo.name, token, range: r, fetchImpl });
        if (!compared.ok) return { ok: false, code: "CANONICAL_DESIGN_REQUIRED", error: compared.error };
        changes.push({ range: r, files: compared.files, patch: providerPatchText(compared.files) });
      }
      const digest = commitRangeDigest(changes);
      if (digest !== range.digest) {
        return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS",
          error: `The merged change resolves to ${digest}, not the bound ${range.digest}. Read get_backlog_item with recoveryGate "post-implementation-review" for the current request.` };
      }
      return { ok: true, artifact: { digest, bytes: Buffer.from(renderCommitRangeText(changes, digest), "utf8"),
        authorPrincipalId, authorAgentId, authorEmail: email } };
    }
    const providerBlob = await fetchRepositoryProviderBlob({
    owner: expectedRepo.owner,
    repo: expectedRepo.name,
    token,
    commitSha: blob!.commitSha,
    path: blob!.path,
    expectedBlobId: blob!.providerBlobId,
    fetchImpl,
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
    const digest = `sha256:${createHash("sha256").update(providerBlob.data).digest("hex")}`;
    if (planProof && digest !== planProof.digest) {
      return { ok: false, code: "CANONICAL_DESIGN_AMBIGUOUS", error: "The verified immutable plan bytes do not match the current coverage digest." };
    }
    return {
      ok: true,
      artifact: {
        digest,
        bytes: providerBlob.data,
        authorPrincipalId,
        authorAgentId,
        authorEmail: email,
      },
    };
  } finally {
    await transport?.close().catch(() => {});
  }
}

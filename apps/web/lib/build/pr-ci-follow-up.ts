// apps/web/lib/build/pr-ci-follow-up.ts
//
// BI-085A37EC: the publish side of a PR CI repair (see pr-ci-repair.ts). A
// dispatched repair is recorded on the build's trail as
// "[dispatched head=<sha>]"; when the repaired build is back in ship, the ship
// path asks here whether a follow-up is owed and where it starts. The commit is
// a fast-forward onto the PR head (publishBranchCommit followUpOf), never forced
// (WWMD DI-8172B1A35993).
import { PR_CI_REPAIR_TOOL, PR_FOLLOW_UP_PREFIX, PR_FOLLOW_UP_UNCHANGED_PREFIX } from "./pr-ci-repair-markers";

const DISPATCHED = /^\[dispatched head=([0-9a-f]{7,40})\]/;

/** The PR head a dispatched repair still owes a follow-up commit to, or null. Rows oldest first. */
export function pendingPrFollowUpHead(rows: ReadonlyArray<{ tool: string; summary: string }>): string | null {
  let pending: string | null = null;
  for (const row of rows) {
    const dispatched = row.tool === PR_CI_REPAIR_TOOL ? DISPATCHED.exec(row.summary) : null;
    if (dispatched) pending = dispatched[1];
    else if (row.tool === "auto_open_pr"
      && (row.summary.startsWith(PR_FOLLOW_UP_PREFIX) || row.summary.startsWith(PR_FOLLOW_UP_UNCHANGED_PREFIX))) pending = null;
  }
  return pending;
}

type FetchLike = typeof fetch;

async function githubJson(url: string, token: string, fetchImpl: FetchLike): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "dpf-pr-ci-repair",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  return { status: response.status, body: response.ok ? await response.json() : null };
}

/**
 * Where the follow-up commit starts: the PR head and its tree, plus every path
 * the PR changed that the repaired change no longer touches, restored to the
 * merge base (null deletes a path the PR had added).
 */
export async function resolvePrFollowUpSource(input: {
  owner: string;
  repo: string;
  baseBranch: string;
  headSha: string;
  diffPaths: readonly string[];
  token: string;
  fetchImpl?: FetchLike;
}): Promise<{ commitSha: string; treeSha: string; restore: Array<{ path: string; sha: string | null }> }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const api = `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  const head = await githubJson(`${api}/git/commits/${input.headSha}`, input.token, fetchImpl);
  const treeSha = (head.body as { tree?: { sha?: unknown } } | null)?.tree?.sha;
  if (typeof treeSha !== "string") throw new Error(`Could not read the pull request head ${input.headSha} (HTTP ${head.status}).`);

  const compare = await githubJson(`${api}/compare/${encodeURIComponent(input.baseBranch)}...${input.headSha}`, input.token, fetchImpl);
  const body = compare.body as { merge_base_commit?: { sha?: unknown }; files?: Array<{ filename?: unknown }> } | null;
  const mergeBase = body?.merge_base_commit?.sha;
  const files = (body?.files ?? []).flatMap((file) => (typeof file.filename === "string" ? [file.filename] : []));
  if (typeof mergeBase !== "string" || files.length >= 300) {
    throw new Error(`Could not read what pull request head ${input.headSha} changes (HTTP ${compare.status}).`);
  }

  const kept = new Set(input.diffPaths);
  const restore: Array<{ path: string; sha: string | null }> = [];
  for (const path of files.filter((file) => !kept.has(file))) {
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const at = await githubJson(`${api}/contents/${encoded}?ref=${mergeBase}`, input.token, fetchImpl);
    const sha = (at.body as { sha?: unknown } | null)?.sha;
    if (at.status === 404) restore.push({ path, sha: null });
    else if (typeof sha === "string") restore.push({ path, sha });
    else throw new Error(`Could not read ${path} at ${mergeBase} (HTTP ${at.status}).`);
  }
  return { commitSha: input.headSha, treeSha, restore };
}

async function trail(buildId: string) {
  const { prisma } = await import("@dpf/db");
  return prisma.buildActivity.findMany({
    where: { buildId, tool: { in: [PR_CI_REPAIR_TOOL, "auto_open_pr"] } },
    orderBy: { createdAt: "asc" },
    select: { tool: true, summary: true },
  });
}

/** Whether a dispatched CI repair still owes its PR a follow-up commit. */
export async function hasPendingPrFollowUp(buildId: string): Promise<boolean> {
  return pendingPrFollowUpHead(await trail(buildId)) !== null;
}

/** create_portal_pr's hook: the follow-up source when a CI repair is pending, else null. */
export async function resolvePendingPrFollowUp(input: {
  buildId: string;
  owner: string;
  repo: string;
  diff: string;
  token: string;
}): Promise<Awaited<ReturnType<typeof resolvePrFollowUpSource>> | null> {
  const headSha = pendingPrFollowUpHead(await trail(input.buildId));
  if (!headSha) return null;
  const { parseFileOperations } = await import("./github-api-commit");
  return resolvePrFollowUpSource({
    owner: input.owner,
    repo: input.repo,
    baseBranch: "main",
    headSha,
    diffPaths: parseFileOperations(input.diff).map((op) => op.path),
    token: input.token,
  });
}

/** A repair that changed nothing goes to a person once, naming the checks it was for. */
export async function escalateUnchangedPrRepair(buildId: string, detail: string): Promise<void> {
  const { prisma } = await import("@dpf/db");
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { id: true, title: true, originatingBacklogItemId: true },
  });
  if (!build) return;
  const rows = await trail(buildId);
  const last = [...rows].reverse().find((row) => row.tool === PR_CI_REPAIR_TOOL && DISPATCHED.test(row.summary));
  const { escalateBuildToHuman } = await import("./escalate-build-to-human");
  await escalateBuildToHuman({
    buildPk: build.id,
    buildId,
    featureTitle: build.title,
    originatingBacklogItemId: build.originatingBacklogItemId,
    phase: "ship",
    rounds: 1,
    issues: [{
      severity: "important",
      description: `The coding agent's repair of the pull request's failing checks changed nothing, so its checks stay red. ${last?.summary ?? ""} ${detail}`.trim(),
    }],
    log: async (summary) => {
      await prisma.buildActivity.create({ data: { buildId, tool: PR_CI_REPAIR_TOOL, summary: summary.slice(0, 1000) } });
    },
  });
}


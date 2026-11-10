import {
  cancelGithubResponseBody,
  createGithubReadTransport,
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";

import type { ProviderCommitLookup, SourceCommitResolverDeps } from "./source-commit-resolution";

type ProviderDb = Parameters<typeof resolveRepoIdentity>[0] & Parameters<typeof resolveGithubToken>[0];
type RecordedShaReader = {
  workroom: { findMany: (args: unknown) => Promise<Array<{ baseSha: string | null; headSha: string | null }>> };
};

/**
 * GitHub resolves a unique prefix through GET /repos/{o}/{r}/commits/{ref}. Only
 * the installation's canonical repository is asked: another repository's
 * prefix is answered "unavailable", never resolved against the wrong history.
 */
export function providerCommitLookup(args: {
  db: ProviderDb;
  repositoryFullName: string;
  fetchImpl?: typeof fetch;
}): ProviderCommitLookup {
  return async (prefix) => {
    let owner: string, name: string, token: string | null;
    try {
      const [repo, resolvedToken] = await Promise.all([resolveRepoIdentity(args.db), resolveGithubToken(args.db)]);
      ({ owner, name } = repo);
      token = resolvedToken;
    } catch {
      return { kind: "unavailable" };
    }
    if (`${owner}/${name}`.toLowerCase() !== args.repositoryFullName.toLowerCase()) return { kind: "unavailable" };
    const transport = args.fetchImpl ? null : createGithubReadTransport();
    try {
      const response = await (args.fetchImpl ?? transport!.fetch)(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(prefix)}`,
        { headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: "no-store" },
      );
      if (response.status === 404 || response.status === 422) {
        await cancelGithubResponseBody(response);
        return { kind: "not-found" };
      }
      if (!response.ok) {
        await cancelGithubResponseBody(response);
        return { kind: "unavailable" };
      }
      const payload = await response.json() as { sha?: unknown };
      return typeof payload?.sha === "string" ? { kind: "found", sha: payload.sha } : { kind: "unavailable" };
    } catch {
      return { kind: "unavailable" };
    } finally {
      await transport?.close().catch(() => {});
    }
  };
}

/** Commits this installation already recorded on a Workroom, for naming candidates. */
export function recordedWorkroomCommits(db: RecordedShaReader): SourceCommitResolverDeps["recordedCandidates"] {
  return async (prefix) => {
    const rows = await db.workroom.findMany({
      where: { OR: [{ baseSha: { startsWith: prefix } }, { headSha: { startsWith: prefix } }] },
      select: { baseSha: true, headSha: true },
      take: 20,
    });
    return rows.flatMap((row) => [row.baseSha, row.headSha])
      .filter((sha): sha is string => typeof sha === "string" && sha.toLowerCase().startsWith(prefix));
  };
}

export async function defaultSourceCommitResolverDeps(repositoryFullName: string): Promise<SourceCommitResolverDeps> {
  const { prisma } = await import("@dpf/db");
  return {
    lookupProviderCommit: providerCommitLookup({ db: prisma as never, repositoryFullName }),
    recordedCandidates: recordedWorkroomCommits(prisma as never),
  };
}

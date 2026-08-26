import { prisma } from "@dpf/db";

import {
  resolveGithubToken,
  resolveRepoIdentity,
} from "@/lib/contributor-change-lanes/github-rest-reader";

/**
 * The db surface is exactly what the shared GitHub reader needs, taken from its
 * own signature so this module never declares a second shape for the same rows.
 */
type CanonicalArtifactDb = Parameters<typeof resolveGithubToken>[0];

export type DiscoveredCanonicalArtifact = {
  path: string;
  providerBlobId: string;
};

export type CanonicalArtifactDiscoveryResult =
  | { ok: true; artifact: DiscoveredCanonicalArtifact }
  | {
    ok: false;
    code: "no-canonical-design" | "ambiguous-canonical-design" | "provider-unavailable";
    nextAction: string;
  };

const SPEC_PREFIX = "docs/superpowers/specs/";

/**
 * GitHub pages the compare file list. A design branch that changed more files
 * than one page is already outside what a single canonical design can mean, so
 * the cap bounds the read rather than paginating toward an answer we would
 * reject anyway.
 */
const COMPARE_FILE_LIMIT = 300;

type CompareFile = { filename: string; sha: string; status: string };

function compareFiles(payload: unknown): CompareFile[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const files = (payload as Record<string, unknown>).files;
  if (!Array.isArray(files)) return null;
  const rows: CompareFile[] = [];
  for (const entry of files.slice(0, COMPARE_FILE_LIMIT)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const filename = typeof row.filename === "string" ? row.filename : "";
    const sha = typeof row.sha === "string" ? row.sha : "";
    const status = typeof row.status === "string" ? row.status : "";
    if (filename && sha) rows.push({ filename, sha, status });
  }
  return rows;
}

function isCanonicalDesignFile(file: CompareFile): boolean {
  return file.status !== "removed"
    && file.filename.startsWith(SPEC_PREFIX)
    && file.filename.endsWith(".md")
    && /^[a-f0-9]{40}$/i.test(file.sha);
}

/**
 * Resolve the canonical design a Workroom authored on its branch, so a readiness
 * recovery route can bind a reviewer to exact immutable bytes.
 *
 * The blob id comes from the provider's own compare payload and is never derived
 * locally — `resolveRepositoryArtifact` re-verifies it against `GET /contents`
 * when the receipt is finally recorded, so a stale or forged locator cannot
 * survive into a governed receipt.
 *
 * The compare RANGE matters: a design is routinely authored across several
 * commits, and `GET /commits/{sha}` would report only the last one's files.
 */
export async function discoverCanonicalDesignArtifact(args: {
  repositoryFullName: string;
  baseSha: string;
  headSha: string;
  db?: CanonicalArtifactDb;
  fetchImpl?: typeof fetch;
}): Promise<CanonicalArtifactDiscoveryResult> {
  const db = args.db ?? (prisma as unknown as CanonicalArtifactDb);
  if (!/^[a-f0-9]{40}$/i.test(args.baseSha) || !/^[a-f0-9]{40}$/i.test(args.headSha)) {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: "The workroom does not record an immutable base and head. Re-sync the branch with adopt_worktree(headBranch, headSha), then retry.",
    };
  }

  let repo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  let token: string | null;
  try {
    repo = await resolveRepoIdentity(db);
    token = await resolveGithubToken(db);
  } catch {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: "Repository provider credentials are unavailable, so the canonical design cannot be bound. Restore the GitHub credential in Admin > Platform Development, then retry.",
    };
  }
  const expectedFullName = `${repo.owner}/${repo.name}`;
  if (args.repositoryFullName.toLocaleLowerCase("en-US") !== expectedFullName.toLocaleLowerCase("en-US")) {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: `The workroom is bound to ${args.repositoryFullName}, but this installation's canonical repository is ${expectedFullName}. Re-claim the work on the canonical repository, then retry.`,
    };
  }

  let response: Response;
  try {
    response = await (args.fetchImpl ?? fetch)(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/compare/${encodeURIComponent(args.baseSha)}...${encodeURIComponent(args.headSha)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        cache: "no-store",
      },
    );
  } catch {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: "Repository provider could not be reached to resolve the canonical design. Retry once provider access is restored.",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: `Repository provider could not compare ${args.baseSha.slice(0, 12)}...${args.headSha.slice(0, 12)}. Confirm the branch is pushed, then retry.`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: "Repository provider returned unreadable comparison metadata. Retry once provider access is restored.",
    };
  }

  const files = compareFiles(payload);
  if (!files) {
    return {
      ok: false,
      code: "provider-unavailable",
      nextAction: "Repository provider returned no comparable file list. Confirm the branch is pushed, then retry.",
    };
  }

  const candidates = files
    .filter(isCanonicalDesignFile)
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (candidates.length === 0) {
    return {
      ok: false,
      code: "no-canonical-design",
      nextAction: `No design document under ${SPEC_PREFIX} changed between ${args.baseSha.slice(0, 12)} and ${args.headSha.slice(0, 12)}. Commit the canonical design there, push it, re-sync the head with adopt_worktree, then retry.`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      code: "ambiguous-canonical-design",
      nextAction: `More than one design document changed on this branch (${
        candidates.map((file) => file.filename).join(", ")
      }), so the canonical design is ambiguous. Land the others separately, leaving exactly one on this branch, then retry.`,
    };
  }

  const canonical = candidates[0]!;
  return { ok: true, artifact: { path: canonical.filename, providerBlobId: canonical.sha } };
}

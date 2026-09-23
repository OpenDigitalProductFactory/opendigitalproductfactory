import { prisma } from "@dpf/db";

import {
  cancelGithubResponseBody,
  createGithubReadTransport,
  resolveGithubToken,
  resolveRepoIdentity,
  type GithubReadTransport,
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
  | { resolved: true; artifact: DiscoveredCanonicalArtifact }
  | {
    resolved: false;
    code: "no-canonical-design" | "ambiguous-canonical-design" | "no-repair-artifact" | "ambiguous-repair-artifact" | "provider-unavailable";
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
export async function discoverCanonicalReviewArtifact(args: {
  repositoryFullName: string;
  baseSha: string;
  headSha: string;
  purpose?: "post-implementation-review";
  /** Read from the live item by the claim handler, never a caller-supplied blob identity. */
  backlogBody?: string | null;
  db?: CanonicalArtifactDb;
  fetchImpl?: typeof fetch;
  transportFactory?: () => GithubReadTransport;
}): Promise<CanonicalArtifactDiscoveryResult> {
  const db = args.db ?? (prisma as unknown as CanonicalArtifactDb);
  const invalidFields = (["baseSha", "headSha"] as const)
    .filter((field) => !/^[a-f0-9]{40}$/i.test(args[field]));
  if (invalidFields.length > 0) {
    return {
      resolved: false,
      code: "provider-unavailable",
      nextAction: `The workroom has missing or invalid ${invalidFields.join(" and ")}. Re-sync the branch with adopt_worktree(headBranch, baseSha, headSha), supplying full immutable commit SHAs for both fields and preserving any valid recorded identity, then retry.`,
    };
  }

  let repo: Awaited<ReturnType<typeof resolveRepoIdentity>>;
  let token: string | null;
  try {
    repo = await resolveRepoIdentity(db);
    token = await resolveGithubToken(db);
  } catch {
    return {
      resolved: false,
      code: "provider-unavailable",
      nextAction: "Repository provider credentials are unavailable, so the canonical design cannot be bound. Restore the GitHub credential in Admin > Platform Development, then retry.",
    };
  }
  const expectedFullName = `${repo.owner}/${repo.name}`;
  if (args.repositoryFullName.toLocaleLowerCase("en-US") !== expectedFullName.toLocaleLowerCase("en-US")) {
    return {
      resolved: false,
      code: "provider-unavailable",
      nextAction: `The workroom is bound to ${args.repositoryFullName}, but this installation's canonical repository is ${expectedFullName}. Re-claim the work on the canonical repository, then retry.`,
    };
  }

  let transport: GithubReadTransport | null = null;
  if (!args.fetchImpl) {
    try {
      transport = (args.transportFactory ?? createGithubReadTransport)();
    } catch {
      return {
        resolved: false,
        code: "provider-unavailable",
        nextAction: "Repository provider transport is unavailable. Restore the server network client, then retry.",
      };
    }
  }
  const fetchImpl = args.fetchImpl ?? transport!.fetch;
  try {
    return await discoverCanonicalDesignArtifactWithFetch(args, repo, token, fetchImpl);
  } finally {
    await transport?.close().catch(() => {});
  }
}

/** Design gates retain their design-only contract; only PIR may bind repair source. */
export async function discoverCanonicalDesignArtifact(
  args: Omit<Parameters<typeof discoverCanonicalReviewArtifact>[0], "purpose">,
): Promise<CanonicalArtifactDiscoveryResult> {
  return discoverCanonicalReviewArtifact({ ...args, purpose: undefined });
}

async function discoverCanonicalDesignArtifactWithFetch(
  args: { repositoryFullName: string; baseSha: string; headSha: string; backlogBody?: string | null; purpose?: "post-implementation-review" },
  repo: { owner: string; name: string },
  token: string | null,
  fetchImpl: typeof fetch,
): Promise<CanonicalArtifactDiscoveryResult> {
  // An explicit reference is the item's scope choice, not evidence of approval.
  // Verify its bytes at the recorded head even when this branch did not edit it.
  const references = [...new Set((args.backlogBody ?? "")
    .match(/docs\/superpowers\/specs\/[^\s`<>"')]+\.md(?:#[A-Za-z0-9_-]+)?/g) ?? [])]
    .map((path) => path.split("#")[0]!);
  const paths = [...new Set(references)];
  if (paths.some((path) => !/^docs\/superpowers\/specs\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.md$/.test(path))) {
    return { resolved: false, code: "no-canonical-design",
      nextAction: "The item references an invalid canonical design path. Use a repository-relative file under docs/superpowers/specs/ without traversal segments." };
  }
  if (paths.length > 1) {
    return { resolved: false, code: "ambiguous-canonical-design",
      nextAction: `The item references more than one canonical design (${paths.join(", ")}). Identify one canonical design before requesting review.` };
  }
  const declaredPath = paths[0];
  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/` +
      (declaredPath
        ? `contents/${declaredPath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(args.headSha)}`
        : `compare/${encodeURIComponent(args.baseSha)}...${encodeURIComponent(args.headSha)}`),
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
      resolved: false,
      code: "provider-unavailable",
      nextAction: "Repository provider could not be reached to resolve the canonical design. Retry once provider access is restored.",
    };
  }
  if (!response.ok) {
    await cancelGithubResponseBody(response);
    return {
      resolved: false,
      code: "provider-unavailable",
      nextAction: declaredPath
        ? `Repository provider could not verify ${declaredPath} at ${args.headSha}. Confirm the referenced file exists at the pushed head, then retry.`
        : `Repository provider could not compare ${args.baseSha.slice(0, 12)}...${args.headSha.slice(0, 12)}. Confirm the branch is pushed, then retry.`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      resolved: false,
      code: "provider-unavailable",
      nextAction: "Repository provider returned unreadable comparison metadata. Retry once provider access is restored.",
    };
  }

  if (declaredPath) {
    const file = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown> : null;
    if (file?.type !== "file" || file.path !== declaredPath
      || typeof file.sha !== "string" || !/^[a-f0-9]{40}$/i.test(file.sha)) {
      return { resolved: false, code: "provider-unavailable",
        nextAction: `Repository provider did not verify a regular file and immutable blob for ${declaredPath} at ${args.headSha}. No substitute design was selected.` };
    }
    return { resolved: true, artifact: { path: declaredPath, providerBlobId: file.sha } };
  }

  const files = compareFiles(payload);
  if (!files) {
    return {
      resolved: false,
      code: "provider-unavailable",
      nextAction: "Repository provider returned no comparable file list. Confirm the branch is pushed, then retry.",
    };
  }

  if (args.purpose === "post-implementation-review" && files.length >= COMPARE_FILE_LIMIT) {
    return { resolved: false, code: "provider-unavailable",
      nextAction: "The provider comparison reached its file limit. The repair scope may be incomplete; narrow the immutable review range before retrying." };
  }

  const candidates = files
    .filter(isCanonicalDesignFile)
    .sort((left, right) => left.filename.localeCompare(right.filename));
  if (candidates.length === 0) {
    if (args.purpose === "post-implementation-review") {
      return discoverRepairArtifact(files);
    }
    return {
      resolved: false,
      code: "no-canonical-design",
      nextAction: `No design document under ${SPEC_PREFIX} changed between ${args.baseSha.slice(0, 12)} and ${args.headSha.slice(0, 12)}. Commit the canonical design there, push it, re-sync the head with adopt_worktree, then retry.`,
    };
  }
  if (candidates.length > 1) {
    return {
      resolved: false,
      code: "ambiguous-canonical-design",
      nextAction: `More than one design document changed on this branch (${
        candidates.map((file) => file.filename).join(", ")
      }), so the canonical design is ambiguous. Land the others separately, leaving exactly one on this branch, then retry.`,
    };
  }

  const canonical = candidates[0]!;
  return { resolved: true, artifact: { path: canonical.filename, providerBlobId: canonical.sha } };
}

/** A single implementation artifact may be accompanied by tests and explanatory docs. */
function discoverRepairArtifact(files: CompareFile[]): CanonicalArtifactDiscoveryResult {
  const present = files.filter((file) => file.status !== "removed"
    && /^[a-f0-9]{40}$/i.test(file.sha)
    && !file.filename.includes("\\")
    && file.filename.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."));
  const implementation = present.filter((file) => !file.filename.startsWith("docs/")
    && !/(^|\/)(__tests__|tests?)\//.test(file.filename)
    && !/\.(test|spec)\.[^/]+$/.test(file.filename));
  const candidates = present.length === 1 ? present : implementation;
  if (candidates.length === 1) {
    const file = candidates[0]!;
    return { resolved: true, artifact: { path: file.filename, providerBlobId: file.sha } };
  }
  return {
    resolved: false,
    code: candidates.length > 1 ? "ambiguous-repair-artifact" : "no-repair-artifact",
    nextAction: candidates.length > 1
      ? `The repair has multiple implementation artifacts (${candidates.map((file) => file.filename).join(", ")}). Narrow the review to an independently reviewable repair or use its existing canonical design. No artifact was selected arbitrarily.`
      : "The recorded range contains no unique surviving repair artifact. Verify the pushed base/head and repair scope; a post-implementation review does not require a new design document.",
  };
}

import { prisma } from "@dpf/db";
import { createHash } from "node:crypto";
import { NO_MARKED_OBJECTIVE_STATEMENTS, parseInitiativeScopeManifest } from "./baseline-manifest";
import type { CurrentDesignEvidence } from "./judged-design-artifact";
import { prepareCurrentArtifactObservation } from "./current-artifact-observation";
import { prepareCurrentResearchObservation, type CurrentResearchPorts } from "./current-research-artifact";
import type { InitiativeArtifactRef } from "./receipt-schema";
import { isFullSourceCommitSha } from "@/lib/work-capsules/work-capsule-branch-identity";

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

type CurrentDesignDb = Pick<typeof prisma, "backlogItem" | "backlogItemActivity" | "workroom">
  & { $queryRaw?: typeof prisma.$queryRaw };
type BoundDesign = {
  kind: "bound"; itemRowId: string; itemId: string; selection: string;
  baselineId: string; baselineDigest: string;
  artifactRef: Extract<InitiativeArtifactRef, { kind: "repo-blob-at-commit" }>;
  room: { capsuleId: string; repositoryFullName: string; baseSha: string; headSha: string; headBranch: string };
};
type CurrentDesignBinding = BoundDesign
  | { kind: "not-applicable"; mayInheritResearch?: true }
  | { kind: "unavailable" };
type ClaimSource = {
  repositoryFullName: string; headBranch: string;
  baseSha?: string | null; headSha?: string | null;
};

async function loadCurrentDesignBinding(itemId: string, db: CurrentDesignDb, claimSource?: ClaimSource): Promise<CurrentDesignBinding> {
  const item = await db.backlogItem.findFirst({ where: { OR: [{ itemId }, { id: itemId }] },
    select: { id: true, itemId: true, body: true } });
  if (!item) return { kind: "unavailable" };
  const activities = await db.backlogItemActivity.findMany({ where: { backlogItemId: item.id, kind: "initiative_scope_baseline" },
    select: { id: true, kind: true, gateKey: true, recordedAt: true, payload: true } });
  const { parseReadinessBaselines } = await import("./entry-adapter");
  const baseline = parseReadinessBaselines(activities, item.itemId);
  if (baseline.malformed || baseline.ambiguous) return { kind: "unavailable" };
  // A child with only inherited scope never authors a parent amendment.
  if (!baseline.current) return { kind: "not-applicable", mayInheritResearch: true };
  if (baseline.current.origin === "item-body") return { kind: "not-applicable" };
  if (!baseline.current.artifactRef) return { kind: "unavailable" };
  if (baseline.current.artifactRef.kind !== "repo-blob-at-commit") return { kind: "not-applicable" };
  // A claim tuple narrows the persisted subject binding; it supplies neither
  // authority nor an artifact digest. Unscoped reads retain their ambiguity check.
  if (claimSource && (!claimSource.repositoryFullName || !claimSource.headBranch
    || !isFullSourceCommitSha(claimSource.baseSha) || !isFullSourceCommitSha(claimSource.headSha))) {
    return { kind: "unavailable" };
  }
  const rooms = await db.workroom.findMany({
    where: { backlogItemId: { in: [item.id, item.itemId] }, archivedAt: null,
      status: { notIn: ["abandoned", "archived", "superseded"] },
      ...(claimSource ? { repositoryFullName: claimSource.repositoryFullName, headBranch: claimSource.headBranch,
        baseSha: claimSource.baseSha, headSha: claimSource.headSha } : {}) }, take: 2,
    select: { capsuleId: true, repositoryFullName: true, baseSha: true, headSha: true, headBranch: true },
  });
  const room = rooms.length === 1 ? rooms[0] : null;
  if (!room?.repositoryFullName || !room.baseSha || !room.headSha || !room.headBranch
    || !/^[a-f0-9]{40}$/i.test(room.baseSha) || !/^[a-f0-9]{40}$/i.test(room.headSha)
    || room.repositoryFullName !== baseline.current.artifactRef.repositoryFullName) return { kind: "unavailable" };
  return { kind: "bound", itemRowId: item.id, itemId: item.itemId, selection: item.body ?? "",
    baselineId: baseline.current.baselineId, baselineDigest: baseline.current.artifactDigest,
    artifactRef: baseline.current.artifactRef,
    room: { capsuleId: room.capsuleId, repositoryFullName: room.repositoryFullName, baseSha: room.baseSha,
      headSha: room.headSha, headBranch: room.headBranch } };
}

export async function readCurrentDesignArtifact(binding: BoundDesign, ports?: {
  discoverArtifact?: typeof discoverCanonicalDesignArtifact;
  readBlob?: typeof import("./repository-artifact").readRepositoryProviderBlob;
}): Promise<CurrentDesignEvidence> {
  const discovered = await (ports?.discoverArtifact ?? discoverCanonicalDesignArtifact)({ ...binding.room,
    backlogBody: binding.selection, subjectItemId: binding.itemId });
  // Source-only follow-up commits need not touch their already approved design.
  // Never use this fallback to override an explicit or ambiguous selection.
  if (!discovered.resolved && (discovered.code !== "no-canonical-design"
    || /docs\/superpowers\/specs\//.test(binding.selection))) return { state: "unavailable" };
  const readRepositoryProviderBlob = ports?.readBlob ?? (await import("./repository-artifact")).readRepositoryProviderBlob;
  const bytes = await readRepositoryProviderBlob({ repositoryFullName: binding.room.repositoryFullName,
    commitSha: binding.room.headSha, path: discovered.resolved ? discovered.artifact.path : binding.artifactRef.path,
    expectedBlobId: discovered.resolved ? discovered.artifact.providerBlobId : null });
  if (!bytes.ok) return { state: "unavailable" };
  return {
    state: "verified",
    digest: `sha256:${createHash("sha256").update(bytes.data).digest("hex")}`,
    ...missingObjectiveError(bytes.data),
  };
}

/** Only a missing-objective parse is surfaced. Other read failures keep their own remedies. */
function missingObjectiveError(data: Uint8Array): { scopeManifestError: string } | Record<string, never> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return {};
  }
  const manifest = parseInitiativeScopeManifest(text);
  return manifest.ok || manifest.error !== NO_MARKED_OBJECTIVE_STATEMENTS
    ? {}
    : { scopeManifestError: manifest.error };
}

/** Provider work stays outside transactions; only this server closure crosses admission. */
export async function prepareCurrentDesignObservation(args: {
  itemId: string; db?: CurrentDesignDb;
  /** Actual governed claim input; the reader verifies its persisted subject/room binding. */
  claimSource?: ClaimSource;
  ports?: Partial<{
    loadBinding: (itemId: string, db: CurrentDesignDb, claimSource?: ClaimSource) => Promise<CurrentDesignBinding>;
    readCurrentArtifact: (binding: BoundDesign) => Promise<CurrentDesignEvidence>;
    lockBinding: (binding: BoundDesign, db: CurrentDesignDb) => Promise<void>;
    research: CurrentResearchPorts;
  }>;
}): Promise<{ evidence: CurrentDesignEvidence; admissionGuard: (tx: CurrentDesignDb) => Promise<CurrentDesignEvidence> }> {
  const db = args.db ?? prisma;
  const load = args.ports?.loadBinding ?? loadCurrentDesignBinding;
  // Capture the selection once, including across the provider await and guard.
  const claimSource = args.claimSource ? { repositoryFullName: args.claimSource.repositoryFullName,
    headBranch: args.claimSource.headBranch, baseSha: args.claimSource.baseSha, headSha: args.claimSource.headSha } : undefined;
  const read = args.ports?.readCurrentArtifact ?? readCurrentDesignArtifact;
  const unavailable = { state: "unavailable" } as const;
  let mayInheritResearch = false;
  const design = await prepareCurrentArtifactObservation<CurrentDesignBinding, CurrentDesignEvidence>({
    db, load: currentDb => load(args.itemId, currentDb as CurrentDesignDb, claimSource), read,
    unbound: binding => {
      mayInheritResearch = binding.kind === "not-applicable" && binding.mayInheritResearch === true;
      return { state: binding.kind };
    }, unavailable,
    isUnavailable: evidence => evidence.state === "unavailable",
    lock: args.ports?.lockBinding ? (binding, currentDb) => args.ports!.lockBinding!(binding, currentDb as CurrentDesignDb) : undefined,
  });
  // Own body/document baselines cannot inherit, so do not fetch unused research
  // bytes for those subjects. The projector remains the inheritance authority.
  const research = design.evidence.state === "not-applicable" && mayInheritResearch
    ? await prepareCurrentResearchObservation({ itemId: args.itemId, db, claimSource, ports: args.ports?.research }) : null;
  const combine = (evidence: CurrentDesignEvidence, ownResearch: CurrentDesignEvidence["research"]) =>
    ownResearch ? { ...evidence, research: ownResearch } : evidence;
  return { evidence: combine(design.evidence, research?.evidence), admissionGuard: async tx => {
    const ownResearch = research ? await research.admissionGuard(tx) : undefined;
    const evidence = await design.admissionGuard(tx);
    return combine(evidence, ownResearch);
  } };
}

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

type CompareFile = { filename: string; sha: string; status: string; patch?: string };

function compareFiles(payload: unknown): CompareFile[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const files = (payload as Record<string, unknown>).files;
  if (!Array.isArray(files)) return null;
  const rows: CompareFile[] = [];
  for (const entry of files.slice(0, COMPARE_FILE_LIMIT)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const filename = typeof row.filename === "string" ? row.filename : "";
    const sha = typeof row.sha === "string" ? row.sha : "";
    const status = typeof row.status === "string" ? row.status : "";
    if (!filename || !sha || !status) return null;
    rows.push({ filename, sha, status, ...(typeof row.patch === "string" ? { patch: row.patch } : {}) });
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
  /** Server-resolved subject and persisted branch; neither is a caller path selector. */
  subjectItemId?: string;
  headBranch?: string;
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
  args: { repositoryFullName: string; baseSha: string; headSha: string; backlogBody?: string | null; purpose?: "post-implementation-review";
    subjectItemId?: string; headBranch?: string; db?: CanonicalArtifactDb },
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
  let selectedPath: string | undefined;
  if (paths.length > 1 && args.subjectItemId && args.headBranch) {
    try {
      const binding = await loadCurrentDesignBinding(args.subjectItemId,
        (args.db ?? prisma) as unknown as CurrentDesignDb, { repositoryFullName: args.repositoryFullName,
          headBranch: args.headBranch, baseSha: args.baseSha, headSha: args.headSha });
      if (binding.kind === "bound" && binding.selection === (args.backlogBody ?? "")
        && paths.includes(binding.artifactRef.path)) selectedPath = binding.artifactRef.path;
    } catch { /* Missing or unreadable binding never selects a historical reference. */ }
  }
  if (paths.length > 1 && !selectedPath) {
    return { resolved: false, code: "ambiguous-canonical-design",
      nextAction: `The item references more than one canonical design (${paths.join(", ")}). Identify one canonical design before requesting review.` };
  }
  const declaredPath = selectedPath ?? paths[0];
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

  if (files.length >= COMPARE_FILE_LIMIT) {
    return { resolved: false, code: "provider-unavailable",
      nextAction: "The provider comparison reached its file limit. The review scope may be incomplete; select the exact canonical design or narrow the immutable review range before retrying." };
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

/**
 * BI-09399355: a manifest whose only change is its `"version"` value is release
 * bookkeeping, not a competing implementation: a repair that bumps four plugin
 * manifests beside one code change is still one reviewable change. Read from the
 * provider's own patch; a missing patch (GitHub omits large ones) proves nothing,
 * so the file stays a candidate.
 */
const VERSION_LINE = /^[+-]\s*"version"\s*:\s*"[^"]*"\s*,?\s*$/;

function isVersionOnlyChange(file: CompareFile): boolean {
  if (file.status !== "modified" || !file.filename.endsWith(".json") || !file.patch) return false;
  const changed = file.patch.split("\n")
    .filter((line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"));
  return changed.length === 2 && changed.every((line) => VERSION_LINE.test(line))
    && changed.some((line) => line.startsWith("+")) && changed.some((line) => line.startsWith("-"));
}

/** A single implementation artifact may be accompanied by tests, explanatory docs and version bumps. */
function discoverRepairArtifact(files: CompareFile[]): CanonicalArtifactDiscoveryResult {
  const valid = files.filter((file) => /^[a-f0-9]{40}$/i.test(file.sha)
    && !file.filename.includes("\\")
    && file.filename.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."));
  const implementation = valid.filter((file) => !file.filename.startsWith("docs/")
    && !/(^|\/)(__tests__|tests?)\//.test(file.filename)
    && !/\.(test|spec)\.[^/]+$/.test(file.filename)
    && !isVersionOnlyChange(file));
  // Deletions remain part of the repair scope even though no head blob survives.
  const candidates = valid.length !== files.length ? [] : valid.length === 1 ? valid : implementation;
  if (candidates.length === 1 && candidates[0]!.status !== "removed") {
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

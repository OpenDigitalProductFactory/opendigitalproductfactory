// Committed-schema reader with explicit tree provenance (BI-F9CAF214).
//
// WHY A SEPARATE READER RATHER THAN A FALLBACK INSIDE describe_model:
// kernel decision DI-7A4DFF0A1809 scored "separate committed-schema tool"
// above "fallback inside the existing tool". The deciding axis was
// legibility_of_consequence: a single tool that silently switches between the
// sandbox tree and the committed tree leaves the caller unable to tell which
// tree answered. DPF has a track record of exactly that harm — BI-6CFC5429
// (PROJECT_ROOT resolves a stale June branch) and BI-86EF5900 (code graph
// indexed off the default branch) are both defects whose damage was that a
// caller could not tell which tree a result described.
//
// So this reader NEVER answers anonymously. Every result carries the resolved
// root, the branch, the HEAD sha, and a trust vector that scores an
// off-default branch DOWN using the same vocabulary the code-graph adapter
// uses (lib/trust-vector/default-branch).
//
// This matters concretely on the live install today: PROJECT_ROOT points at a
// stale `my-changes` branch, so a naive "read the committed schema" answers
// from a June tree while looking authoritative. Here that surfaces as
// tier "low" / action "qualify" with the branch named in the rationale,
// rather than as a confident wrong answer.

import { lazyFsPromises, lazyPath, getCwd } from "@/lib/shared/lazy-node";
import { scoreTrustVector } from "@/lib/trust-vector/score";
import type { TrustAssessment, TrustDimensionInput } from "@/lib/trust-vector/types";
import {
  OFF_DEFAULT_BRANCH_FRESHNESS_CAP,
  isOffDefaultBranch,
} from "@/lib/trust-vector/default-branch";
// One definition of "which ref is the default branch", shared with the code
// graph indexer rather than restated here (BI-6CFC5429).
import { resolveDefaultBranchRef } from "@/lib/build/code-graph/default-branch-source";

/** Directory holding the split Prisma schema (there is no monolithic schema.prisma). */
export const SCHEMA_DIR_RELATIVE = "packages/db/prisma/schema";

/**
 * Freshness ceiling when the tree cannot be identified at all. Deliberately
 * BELOW the off-default-branch cap: a named side branch at least tells you what
 * you are looking at, an unnamed tree tells you nothing.
 */
export const UNIDENTIFIED_TREE_FRESHNESS_CAP = 0.15;

export type CommittedSchemaProvenance = {
  /** Absolute path the schema was read from. */
  root: string;
  /** Branch checked out at `root`, or null when git could not answer. */
  branch: string | null;
  /** HEAD sha at `root`, or null when git could not answer. */
  headSha: string | null;
  /** Number of *.prisma domain files joined to form the schema text. */
  schemaFileCount: number;
  /** Always "committed" — this reader never reads a build sandbox. */
  tree: "committed";
  /**
   * False when the tree could not be identified (no git in the container, so
   * branch and headSha are null). A miss against an UNIDENTIFIED tree is
   * inconclusive, never an absence — see the note on buildTrust.
   */
  identified: boolean;
};

export type CommittedSchemaSource = {
  schema: string;
  provenance: CommittedSchemaProvenance;
  trust: TrustAssessment;
};

/** Resolve the source root exactly as read_project_file / describe_model do. */
export function resolveSourceRoot(): string {
  const { resolve } = lazyPath();
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(getCwd(), "..", "..");
}

export type GitReader = (root: string, args: string) => Promise<string | null>;

/** Default git reader. Injected in tests (RunDeps idiom) so the unit suite
 *  never shells out — a real `git` call in a unit test is a 10s timeout, not a
 *  test. */
const defaultReadGit: GitReader = async (root, args) => {
  try {
    const { promisify } = await import("node:util");
    const { exec: nodeExec } = await import("node:child_process");
    const exec = promisify(nodeExec);
    const { stdout } = await exec(`git ${args}`, { cwd: root, timeout: 10_000 });
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
};

/**
 * SHIPPED DEFECT, fixed here. `isOffDefaultBranch(null)` returns false — null
 * means "not applicable" to the code-graph adapter it was written for — and the
 * original scoring did `offDefault ? CAP : 1`, so a tree with NO git resolved to
 * full freshness marks and the rationale template rendered
 * 'Schema was read from "unknown", the default branch.'
 *
 * Every production call takes that path: the portal container ships the built
 * app without a git repository, so branch and headSha are always null. The
 * result was a confident "model not found" at trust tier HIGH (0.99) against a
 * tree the tool could not name — on a live call for MileageRate, which is on
 * main. That is precisely the false absence this reader exists to prevent.
 *
 * Unknown provenance is now its own case, scored BELOW the off-default cap:
 * an unnamed tree is strictly worse evidence than a named side branch, because
 * you cannot even tell how far it has drifted.
 */
/**
 * Recover the branch name by READING `.git/HEAD` when the git binary refuses.
 *
 * On the live portal, git is installed but every invocation fails with
 * "fatal: detected dubious ownership in repository at '/sandbox-workspace'" —
 * the container runs as a different uid than the checkout owner. So `readGit`
 * returns null on EVERY production call, and the tree looked unidentifiable
 * even though `.git/HEAD` plainly says
 * `ref: refs/heads/client/5727856b-3296-4e17-97f0-c59401ace4f2`.
 *
 * Naming the branch is strictly better than admitting ignorance: it lets the
 * off-default cap fire with the real branch in the rationale, instead of
 * collapsing to the weaker "unidentified tree" case. Plain file read, no
 * ownership check to trip over.
 */
async function readBranchFromGitHead(root: string): Promise<string | null> {
  const { resolve } = lazyPath();
  const { readFile } = lazyFsPromises();
  try {
    let gitDir = resolve(root, ".git");
    const head = await readFile(resolve(gitDir, "HEAD"), "utf-8").catch(async () => {
      // `.git` is a FILE in a linked worktree: "gitdir: <path>".
      const pointer = await readFile(gitDir, "utf-8");
      const match = /^gitdir:\s*(.+)$/m.exec(pointer);
      if (!match) throw new Error("unparseable gitdir pointer");
      gitDir = match[1].trim();
      return readFile(resolve(gitDir, "HEAD"), "utf-8");
    });
    const ref = /^ref:\s*refs\/heads\/(.+)$/m.exec(String(head).trim());
    if (ref) return ref[1].trim();
    const detached = String(head).trim();
    return /^[0-9a-f]{7,40}$/i.test(detached) ? detached : null;
  } catch {
    return null;
  }
}

function buildTrust(provenance: CommittedSchemaProvenance, asOf: string): TrustAssessment {
  const identified = provenance.identified;
  const offDefault = isOffDefaultBranch(provenance.branch);
  const branchLabel = provenance.branch ?? "an unidentified tree";

  const dimensions: TrustDimensionInput[] = [
    {
      key: "sourceAuthority",
      label: "Source authority",
      score: 0.95,
      weight: 1,
      rationale:
        `The committed Prisma schema under ${SCHEMA_DIR_RELATIVE} is the authoritative ` +
        "definition of the data model for the tree it was read from.",
      evidenceRefs: [],
    },
    {
      key: "freshness",
      label: "Freshness",
      // Unknown < off-default < default. An off-default branch is capped for the
      // same reason the code graph caps it: recency of the READ says nothing
      // about the age of what was read. An UNIDENTIFIED tree is worse still.
      score: !identified
        ? UNIDENTIFIED_TREE_FRESHNESS_CAP
        : offDefault
          ? OFF_DEFAULT_BRANCH_FRESHNESS_CAP
          : 1,
      weight: 2,
      rationale: !identified
        ? `Schema was read from ${provenance.root}, but the branch and commit could ` +
          "NOT be determined (no git metadata available there). There is no way to " +
          "tell how far this tree has drifted from the merge target, so a model " +
          "missing from it is INCONCLUSIVE, not absent. Confirm against the default " +
          "branch before recording any absence."
        : offDefault
          ? `Schema was read from branch "${branchLabel}", not the default branch — ` +
            "it may not match what is merged to main. Re-read against the default " +
            "branch before treating a null result as an absence."
          : `Schema was read from "${branchLabel}", the default branch.`,
      measuredAt: asOf,
      evidenceRefs: [],
    },
    {
      key: "coverageCompleteness",
      label: "Schema coverage",
      score: provenance.schemaFileCount > 0 ? 1 : 0,
      weight: 1,
      rationale:
        provenance.schemaFileCount > 0
          ? `Joined ${provenance.schemaFileCount} domain schema file(s) from ${SCHEMA_DIR_RELATIVE}.`
          : `No *.prisma files found under ${SCHEMA_DIR_RELATIVE} — an empty read, not an empty schema.`,
      evidenceRefs: [],
    },
  ];

  return scoreTrustVector({
    subject: {
      type: "committed-schema",
      id: provenance.root,
      label: `Committed Prisma schema (${branchLabel})`,
    },
    asOf,
    dimensions,
    sourceSummary:
      "Committed-schema trust is derived from the branch the working tree is on and " +
      "how many domain schema files were readable.",
  });
}

/**
 * Read the committed Prisma schema with provenance. Requires no build and no
 * sandbox. Returns null ONLY when the schema directory could not be read at
 * all — which the caller must report as "could not read", never as "not found".
 */
export type LoadCommittedSchemaDeps = {
  asOf?: Date;
  readGit?: GitReader;
  /** Injected in tests; defaults to reading `.git/HEAD` off disk. */
  readBranchFallback?: (root: string) => Promise<string | null>;
  /** Test hook: skip the default-branch read and exercise the working-tree path. */
  skipDefaultBranch?: boolean;
};

/**
 * Read the schema files straight out of a git ref, without checking anything out.
 *
 * BI-6CFC5429. The reader answered from whatever PROJECT_ROOT's working tree was
 * parked on. On the live install that is /sandbox-workspace, a Build Studio
 * sandbox whose branch MOVES — observed on client/5727856b-… one day and
 * pr-4917-head the next. The same question got different answers on different
 * days, and a model absent from today's sandbox branch read as absent from the
 * platform: the exact false absence this reader exists to prevent. It answered
 * correctly for MileageRate only because that PR branch happened to contain it.
 *
 * Only ~26 files are needed, so `git show <ref>:<path>` per file is cheap and
 * needs no worktree — unlike the code graph's 14k-file case, which earns one.
 */
async function readSchemaAtRef(
  root: string,
  ref: string,
  readGit: GitReader,
): Promise<{ count: number; parts: string[] } | null> {
  const listing = await readGit(root, `ls-tree --name-only ${ref} ${SCHEMA_DIR_RELATIVE}/`);
  if (!listing) return null;

  const paths = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".prisma"))
    .sort();
  if (paths.length === 0) return null;

  const parts: string[] = [];
  for (const path of paths) {
    const content = await readGit(root, `show ${ref}:${path}`);
    // A ref we cannot fully read is not a partial schema, it is no schema.
    // Returning some of it would silently under-report models.
    if (content === null) return null;
    parts.push(content);
  }
  return { count: paths.length, parts };
}

export async function loadCommittedSchema(
  deps: LoadCommittedSchemaDeps = {},
): Promise<CommittedSchemaSource | null> {
  const asOfDate = deps.asOf ?? new Date();
  const readGit = deps.readGit ?? defaultReadGit;
  const { resolve } = lazyPath();
  const { readFile, readdir } = lazyFsPromises();
  const root = resolveSourceRoot();
  const schemaDir = resolve(root, SCHEMA_DIR_RELATIVE);

  // Prefer the DEFAULT BRANCH over the working tree. Which tree this process
  // happens to sit in is a deployment detail; the merge target is what a caller
  // asking "does this model exist" actually means.
  const defaultRef = deps.skipDefaultBranch ? null : await resolveDefaultBranchRef(root);
  if (defaultRef) {
    const atRef = await readSchemaAtRef(root, defaultRef.ref, readGit);
    if (atRef) {
      const refProvenance: CommittedSchemaProvenance = {
        root,
        branch: defaultRef.branch,
        headSha: defaultRef.sha,
        schemaFileCount: atRef.count,
        tree: "committed",
        identified: true,
      };
      return {
        schema: atRef.parts.join("\n"),
        provenance: refProvenance,
        trust: buildTrust(refProvenance, asOfDate.toISOString()),
      };
    }
  }

  // Fall back to the working tree, and let the existing scoring say so — an
  // off-default or unidentifiable tree is capped and named, never authoritative.
  let names: string[];
  try {
    names = (await readdir(schemaDir)).filter((n) => n.endsWith(".prisma")).sort();
  } catch {
    return null;
  }
  if (names.length === 0) return null;

  let parts: string[];
  try {
    parts = await Promise.all(names.map((n) => readFile(resolve(schemaDir, n), "utf-8")));
  } catch {
    return null;
  }

  let [branch, headSha] = await Promise.all([
    readGit(root, "rev-parse --abbrev-ref HEAD"),
    readGit(root, "rev-parse HEAD"),
  ]);
  // git refused (dubious ownership in the portal container is the norm, not the
  // exception) — recover the branch from .git/HEAD rather than report an
  // unidentifiable tree.
  if (branch === null) {
    branch = deps.readBranchFallback
      ? await deps.readBranchFallback(root)
      : await readBranchFromGitHead(root);
  }

  const provenance: CommittedSchemaProvenance = {
    root,
    branch,
    headSha,
    schemaFileCount: names.length,
    tree: "committed",
    identified: branch !== null || headSha !== null,
  };

  return {
    schema: parts.join("\n"),
    provenance,
    trust: buildTrust(provenance, asOfDate.toISOString()),
  };
}

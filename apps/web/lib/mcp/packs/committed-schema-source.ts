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

/** Directory holding the split Prisma schema (there is no monolithic schema.prisma). */
export const SCHEMA_DIR_RELATIVE = "packages/db/prisma/schema";

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

function buildTrust(provenance: CommittedSchemaProvenance, asOf: string): TrustAssessment {
  const offDefault = isOffDefaultBranch(provenance.branch);
  const branchLabel = provenance.branch ?? "unknown";

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
      // An off-default branch is capped for the same reason the code graph caps
      // it: recency of the READ says nothing about the age of what was read.
      score: offDefault ? OFF_DEFAULT_BRANCH_FRESHNESS_CAP : 1,
      weight: 2,
      rationale: offDefault
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
};

export async function loadCommittedSchema(
  deps: LoadCommittedSchemaDeps = {},
): Promise<CommittedSchemaSource | null> {
  const asOfDate = deps.asOf ?? new Date();
  const readGit = deps.readGit ?? defaultReadGit;
  const { resolve } = lazyPath();
  const { readFile, readdir } = lazyFsPromises();
  const root = resolveSourceRoot();
  const schemaDir = resolve(root, SCHEMA_DIR_RELATIVE);

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

  const [branch, headSha] = await Promise.all([
    readGit(root, "rev-parse --abbrev-ref HEAD"),
    readGit(root, "rev-parse HEAD"),
  ]);

  const provenance: CommittedSchemaProvenance = {
    root,
    branch,
    headSha,
    schemaFileCount: names.length,
    tree: "committed",
  };

  return {
    schema: parts.join("\n"),
    provenance,
    trust: buildTrust(provenance, asOfDate.toISOString()),
  };
}

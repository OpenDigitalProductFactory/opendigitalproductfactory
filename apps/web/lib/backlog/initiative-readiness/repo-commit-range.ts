// BI-46E344FE: the immutable review artifact for a whole merged change. A
// post-implementation review of a repair that touches several implementation
// files, or that landed in several squash commits, reviews every range together
// instead of refusing to pick one file or one commit.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { commitRangeReaderPath, REPO_COMMIT_RANGE_PATH_PREFIX } from "@/lib/shared/immutable-review-reader";

const execFileAsync = promisify(execFile);

export type CommitRange = { baseSha: string; headSha: string };

/** One path's state after a range: its new blob id, or null when the range deleted it. */
export type RangeFileChange = { path: string; blobId: string | null };

export type RangeChange = { range: CommitRange; files: RangeFileChange[]; patch: string };

export type RepoCommitRangeRef = {
  kind: "repo-commit-range";
  repositoryFullName: string;
  /** Oldest first. A multi-PR delivery is reviewed as the union of its squash commits, in order. */
  ranges: CommitRange[];
  /** sha256 over the canonical change list; see `commitRangeDigest`. */
  digest: string;
};

/** Served by `read_source_at_version`, the same reader as a repository blob. */
export { REPO_COMMIT_RANGE_PATH_PREFIX };
/** A delivery split across more squash commits than this is not one reviewable change. */
export const MAX_COMMIT_RANGES = 8;
/** GitHub's compare lists at most 300 files; a range at the cap may be truncated. */
export const MAX_RANGE_FILES = 300;

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ZERO_SHA = "0".repeat(40);

export function parseCommitRanges(value: unknown): CommitRange[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_COMMIT_RANGES) return null;
  const ranges: CommitRange[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const { baseSha, headSha } = entry as Record<string, unknown>;
    if (typeof baseSha !== "string" || typeof headSha !== "string" || !SHA.test(baseSha) || !SHA.test(headSha)
      || baseSha === headSha) return null;
    ranges.push({ baseSha, headSha });
  }
  return new Set(ranges.map((r) => r.headSha)).size === ranges.length ? ranges : null;
}

export function parseRepoCommitRangeRef(value: unknown): RepoCommitRangeRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value as Record<string, unknown>;
  const ranges = parseCommitRanges(ref.ranges);
  const repositoryFullName = typeof ref.repositoryFullName === "string" ? ref.repositoryFullName.trim() : "";
  return ref.kind === "repo-commit-range" && ranges && repositoryFullName
    && typeof ref.digest === "string" && DIGEST.test(ref.digest)
    ? { kind: "repo-commit-range", repositoryFullName, ranges, digest: ref.digest }
    : null;
}

export function commitRangesEqual(left: readonly CommitRange[], right: readonly CommitRange[]): boolean {
  return left.length === right.length && left.every((range, index) =>
    range.baseSha === right[index]!.baseSha && range.headSha === right[index]!.headSha);
}

/** The newest head: the reviewed version, and the anchor head of a headless delivery room. */
export function commitRangeHead(ranges: readonly CommitRange[]): string {
  return ranges[ranges.length - 1]!.headSha;
}

export function commitRangePath(ranges: readonly CommitRange[]): string {
  return commitRangeReaderPath(ranges);
}

export function parseCommitRangePath(path: string): CommitRange[] | null {
  if (!path.startsWith(REPO_COMMIT_RANGE_PATH_PREFIX)) return null;
  const pairs = path.slice(REPO_COMMIT_RANGE_PATH_PREFIX.length).split(",").map((pair) => {
    const [baseSha, headSha, extra] = pair.split("..");
    return extra === undefined ? { baseSha, headSha } : null;
  });
  return pairs.some((pair) => !pair) ? null : parseCommitRanges(pairs);
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The canonical identity of a change: per range, in order, every path the range
 * touched mapped to its post-change blob id ("-" when deleted), sorted by path.
 * Rename detection is excluded on purpose: a rename is its old path deleted and
 * its new path added, so local git and the provider compare agree byte for byte.
 */
export function commitRangeDigest(changes: ReadonlyArray<{ range: CommitRange; files: readonly RangeFileChange[] }>): string {
  const lines: string[] = [];
  for (const change of changes) {
    lines.push(`range ${change.range.baseSha}..${change.range.headSha}`);
    for (const file of [...change.files].sort(byPath)) lines.push(`${file.path}\t${file.blobId ?? "-"}`);
  }
  return `sha256:${createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex")}`;
}

function validPath(path: string): boolean {
  return path.length > 0 && !path.includes("\\")
    && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

export type ProviderRangeFile = RangeFileChange & { patch: string | null };

/**
 * The provider compare's file list as canonical changes. Null when the payload
 * is unreadable or the list may be truncated (the provider caps it at 300).
 */
export function changesFromProviderCompare(payload: unknown): ProviderRangeFile[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const files = (payload as Record<string, unknown>).files;
  if (!Array.isArray(files) || files.length >= MAX_RANGE_FILES) return null;
  const changes: ProviderRangeFile[] = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const path = typeof row.filename === "string" ? row.filename : "";
    const status = typeof row.status === "string" ? row.status : "";
    const sha = typeof row.sha === "string" ? row.sha.toLowerCase() : "";
    const patch = typeof row.patch === "string" ? row.patch : null;
    if (!validPath(path) || !status) return null;
    if (status === "unchanged") continue;
    if (status === "removed") {
      changes.push({ path, blobId: null, patch });
      continue;
    }
    if (!SHA.test(sha)) return null;
    if (status === "renamed") {
      const previous = typeof row.previous_filename === "string" ? row.previous_filename : "";
      if (!validPath(previous)) return null;
      changes.push({ path: previous, blobId: null, patch: null });
    }
    changes.push({ path, blobId: sha, patch });
  }
  return changes;
}

/** The provider's per-file patches as one readable diff; a patch the provider omits is named, never invented. */
export function providerPatchText(files: readonly ProviderRangeFile[]): string {
  return [...files].sort(byPath).map((file) => [
    `diff --git a/${file.path} b/${file.path}`,
    file.blobId ? `+++ ${file.path} (blob ${file.blobId})` : `--- ${file.path} (deleted)`,
    file.patch ?? "(The provider did not include this file's patch: binary, too large, or a rename without edits.)",
    "",
  ].join("\n")).join("\n");
}

/** One range read from a local clone, with renames off so it matches the provider's canonical list. */
export async function readLocalRangeChange(root: string, range: CommitRange): Promise<RangeChange | null> {
  const { trustedGitArgs } = await import("@/lib/work-capsules/git-scanner");
  try {
    const raw = await execFileAsync("git", trustedGitArgs(root, ["diff", "--raw", "--no-renames", "--no-abbrev", "-z",
      range.baseSha, range.headSha]), { timeout: 10_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const fields = raw.stdout.split("\0");
    const files: RangeFileChange[] = [];
    for (let index = 0; index + 1 < fields.length; index += 2) {
      const meta = fields[index]!.trim();
      const path = fields[index + 1]!;
      if (!meta) break;
      const newBlob = meta.split(/\s+/)[3]?.toLowerCase() ?? "";
      if (!validPath(path) || !SHA.test(newBlob)) return null;
      files.push({ path, blobId: newBlob === ZERO_SHA ? null : newBlob });
    }
    if (files.length >= MAX_RANGE_FILES) return null;
    const patch = await execFileAsync("git", trustedGitArgs(root, ["diff", "--no-renames", "--no-color", "--no-ext-diff",
      range.baseSha, range.headSha]), { timeout: 10_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    return { range, files, patch: patch.stdout };
  } catch {
    return null;
  }
}

/** The text a reviewer pages through: what changed per range, then its full patch. */
export function renderCommitRangeText(changes: readonly RangeChange[], digest: string): string {
  const header = [
    `Merged change under review: ${changes.length} commit range${changes.length === 1 ? "" : "s"}, oldest first.`,
    `Change digest: ${digest}`,
    "Each range is parent..commit on the trunk. Review the ranges together as one repair.",
    "",
  ];
  const body = changes.flatMap((change, index) => [
    `== Range ${index + 1} of ${changes.length}: ${change.range.baseSha}..${change.range.headSha} ==`,
    "Files:",
    ...[...change.files].sort(byPath)
      .map((file) => `  ${file.blobId ? "changed" : "deleted"} ${file.path}${file.blobId ? ` (blob ${file.blobId})` : ""}`),
    "",
    change.patch,
  ]);
  return [...header, ...body].join("\n");
}

export type CommitRangeReadResult =
  | ActionSuccess<{ changes: RangeChange[]; digest: string; text: string }>
  | { ok: false; code: "IMMUTABLE_SOURCE_UNAVAILABLE" | "IMMUTABLE_BLOB_MISMATCH"; error: string };

/**
 * Read every range, from the first local clone that holds it or else the
 * repository provider, and verify the recomputed digest when one is bound.
 * Shared by the reader and by discovery so both name the same identity.
 */
export async function readCommitRanges(args: {
  repositoryFullName: string;
  ranges: readonly CommitRange[];
  expectedDigest: string | null;
  roots?: readonly string[];
  readProviderRange?: (range: CommitRange) => Promise<RangeChange | null>;
}): Promise<CommitRangeReadResult> {
  const roots = args.roots ?? (await import("./merge-delivery-signal")).mergeSignalRoots();
  const readProvider = args.readProviderRange ?? (async (range: CommitRange) => {
    const { readRepositoryProviderCompare } = await import("./repository-artifact");
    const compared = await readRepositoryProviderCompare({ repositoryFullName: args.repositoryFullName, ...range });
    return compared.ok ? { range, files: compared.data, patch: providerPatchText(compared.data) } : null;
  });
  const changes: RangeChange[] = [];
  for (const range of args.ranges) {
    let change: RangeChange | null = null;
    for (const root of roots) {
      change = await readLocalRangeChange(root, range);
      if (change) break;
    }
    change ??= await readProvider(range);
    if (!change) {
      return { ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE",
        error: `Neither a local clone nor the repository provider could read ${range.baseSha.slice(0, 12)}..${range.headSha.slice(0, 12)} completely.` };
    }
    changes.push(change);
  }
  const digest = commitRangeDigest(changes);
  if (args.expectedDigest !== null && digest !== args.expectedDigest) {
    return { ok: false, code: "IMMUTABLE_BLOB_MISMATCH", error: `Expected change digest ${args.expectedDigest}, but the ranges resolve to ${digest}.` };
  }
  return ok({ changes, digest, text: renderCommitRangeText(changes, digest) });
}

type RangeReaderOptions = Pick<Parameters<typeof readCommitRanges>[0], "roots" | "readProviderRange">;

/**
 * `read_source_at_version` for a `repo-commit-range/` path. The digest is the
 * whole identity of a range, so it is required here, unlike a blob id: an
 * unbound caller cannot page an arbitrary change through the review reader.
 */
export async function readCommitRangeAtVersion(params: Record<string, unknown>, options: RangeReaderOptions = {}): Promise<
  { success: true; message: string; data: Record<string, unknown> } | { success: false; error: string; message: string }> {
  const path = String(params.path ?? "");
  const ranges = parseCommitRangePath(path);
  const expected = typeof params.expectedBlobId === "string" ? params.expectedBlobId : null;
  const repositoryFullName = typeof params.repositoryFullName === "string" ? params.repositoryFullName : "";
  if (!ranges || !expected || !DIGEST.test(expected) || !repositoryFullName) {
    return { success: false, error: "IMMUTABLE_SOURCE_IDENTITY_INVALID",
      message: "A commit range is read only with its bound repositoryFullName, path, version and expectedBlobId (the change digest)." };
  }
  const head = commitRangeHead(ranges);
  if (params.version !== undefined && params.version !== head) {
    return { success: false, error: "IMMUTABLE_SOURCE_IDENTITY_INVALID", message: `A commit range's version is its newest head, ${head}.` };
  }
  const read = await readCommitRanges({ repositoryFullName, ranges, expectedDigest: expected, ...options });
  if (!read.ok) return { success: false, error: read.code, message: read.error };
  const { pageSource } = await import("@/lib/source-page");
  const page = pageSource({ content: read.data.text, ref: head, path, blobId: read.data.digest, cursor: params.cursor,
    startLine: params.startLine, maxLines: params.maxLines, maxChars: params.maxChars });
  if ("error" in page) return { success: false, error: page.error, message: page.error };
  const more = page.hasMore ? " (more available)" : "";
  return { success: true, message: `Read the merged change lines ${page.startLine}-${page.endLine} of ${page.totalLines}${more}.`,
    data: { ...page, repositoryFullName } };
}

/** PIR discovery for a delivery of several squash commits: their union, read and digested once. */
export async function discoverCommitRangeArtifact(args: { repositoryFullName: string; ranges: CommitRange[] } & RangeReaderOptions): Promise<
  { resolved: true; artifact: { kind: "repo-commit-range"; ranges: CommitRange[]; digest: string } }
  | { resolved: false; code: "provider-unavailable"; nextAction: string }> {
  const read = await readCommitRanges({ ...args, expectedDigest: null });
  return read.ok
    ? { resolved: true, artifact: { kind: "repo-commit-range", ranges: args.ranges, digest: read.data.digest } }
    : { resolved: false, code: "provider-unavailable", nextAction: `${read.error} Retry once the trunk or the repository provider can be read.` };
}

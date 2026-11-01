/**
 * BI-46E344FE — the whole-change review artifact. Driven against a REAL
 * repository: the identity must come out the same from local git and from the
 * provider compare, or a reviewer and the receipt writer would disagree.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, unlink, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  changesFromProviderCompare,
  commitRangeDigest,
  commitRangePath,
  parseCommitRangePath,
  parseRepoCommitRangeRef,
  readCommitRangeAtVersion,
  readCommitRanges,
  readLocalRangeChange,
} from "./repo-commit-range";
import { immutableArtifactIdentity, parseInitiativeReviewArtifactRef } from "@/lib/mcp-task-review-contract";
import { immutablePageReaderForArtifact } from "@/lib/shared/immutable-review-reader";
import { validInitiativeArtifactRef } from "./receipt-validation";

const execFileAsync = promisify(execFile);
const git = async (root: string, args: string[]) => (await execFileAsync("git", ["-C", root, ...args])).stdout.trim();

describe("repo-commit-range (BI-46E344FE)", () => {
  let root: string;
  let base: string;
  let head: string;
  let second: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "dpf-commit-range-46e344fe-"));
    await git(root, ["init", "-q", "--initial-branch=main"]);
    await git(root, ["config", "user.email", "test@example.invalid"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "commit.gpgsign", "false"]);
    await git(root, ["config", "core.hooksPath", "/dev/null"]);
    await writeFile(path.join(root, "a.ts"), "export const a = 1;\n");
    await writeFile(path.join(root, "c.ts"), "export const c = 3;\n");
    await writeFile(path.join(root, "d.ts"), "export const d = 4;\n");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-q", "-m", "base"]);
    base = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "a.ts"), "export const a = 2;\n");
    await writeFile(path.join(root, "b.ts"), "export const b = 2;\n");
    await unlink(path.join(root, "c.ts"));
    await rename(path.join(root, "d.ts"), path.join(root, "e.ts"));
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-q", "-m", "fix: several files (BI-RANGE001)"]);
    head = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "b.ts"), "export const b = 3;\n");
    await git(root, ["commit", "-q", "-am", "fix: follow-up (BI-RANGE001)"]);
    second = await git(root, ["rev-parse", "HEAD"]);
  }, 60_000);

  afterAll(async () => { await rm(root, { recursive: true, force: true }).catch(() => {}); });

  it("reads one range as every touched path with its post-change blob, deletions and renames included", async () => {
    const change = await readLocalRangeChange(root, { baseSha: base, headSha: head });
    expect(change?.files.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "a.ts", blobId: await git(root, ["rev-parse", `${head}:a.ts`]) },
      { path: "b.ts", blobId: await git(root, ["rev-parse", `${head}:b.ts`]) },
      { path: "c.ts", blobId: null },
      { path: "d.ts", blobId: null },
      { path: "e.ts", blobId: await git(root, ["rev-parse", `${head}:e.ts`]) },
    ]);
    expect(change?.patch).toContain("-export const a = 1;");
  });

  it("names the same digest from the provider compare as from local git", async () => {
    const local = await readLocalRangeChange(root, { baseSha: base, headSha: head });
    const blob = (file: string) => git(root, ["rev-parse", `${head}:${file}`]);
    const provider = changesFromProviderCompare({ files: [
      { filename: "a.ts", status: "modified", sha: await blob("a.ts"), patch: "@@ -1 +1 @@" },
      { filename: "b.ts", status: "added", sha: await blob("b.ts") },
      { filename: "c.ts", status: "removed", sha: await git(root, ["rev-parse", `${base}:c.ts`]) },
      { filename: "e.ts", status: "renamed", previous_filename: "d.ts", sha: await blob("e.ts") },
    ] });
    const range = { baseSha: base, headSha: head };
    expect(provider).not.toBeNull();
    expect(commitRangeDigest([{ range, files: provider! }])).toBe(commitRangeDigest([{ range, files: local!.files }]));
  });

  it("refuses a provider list that may be truncated", () => {
    const files = Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.ts`, status: "added", sha: "a".repeat(40) }));
    expect(changesFromProviderCompare({ files })).toBeNull();
  });

  it("serves the ordered union of several ranges and fails closed on a different digest", async () => {
    const ranges = [{ baseSha: base, headSha: head }, { baseSha: head, headSha: second }];
    const unbound = await readCommitRanges({ repositoryFullName: "o/r", ranges, expectedDigest: null, roots: [root],
      readProviderRange: async () => null });
    expect(unbound.ok).toBe(true);
    if (!unbound.ok) return;
    expect(unbound.data.text.indexOf(`Range 1 of 2: ${base}..${head}`)).toBeLessThan(unbound.data.text.indexOf(`Range 2 of 2: ${head}..${second}`));
    expect(unbound.data.text).toContain("+export const b = 3;");
    const bound = await readCommitRanges({ repositoryFullName: "o/r", ranges, expectedDigest: unbound.data.digest, roots: [root],
      readProviderRange: async () => null });
    expect(bound).toMatchObject({ ok: true, data: { digest: unbound.data.digest } });
    const other = await readCommitRanges({ repositoryFullName: "o/r", ranges: ranges.slice(0, 1), expectedDigest: unbound.data.digest,
      roots: [root], readProviderRange: async () => null });
    expect(other).toMatchObject({ ok: false, code: "IMMUTABLE_BLOB_MISMATCH" });
  });

  it("falls back to the provider when no local clone holds the range", async () => {
    const range = { baseSha: "1".repeat(40), headSha: "2".repeat(40) };
    const read = await readCommitRanges({ repositoryFullName: "o/r", ranges: [range], expectedDigest: null,
      roots: [root], readProviderRange: async (r) => ({ range: r, files: [{ path: "x.ts", blobId: "3".repeat(40) }], patch: "patch" }) });
    expect(read).toMatchObject({ ok: true, data: { digest: commitRangeDigest([{ range, files: [{ path: "x.ts", blobId: "3".repeat(40) }] }]) } });
    const missing = await readCommitRanges({ repositoryFullName: "o/r", ranges: [range], expectedDigest: null,
      roots: [root], readProviderRange: async () => null });
    expect(missing).toMatchObject({ ok: false, code: "IMMUTABLE_SOURCE_UNAVAILABLE" });
  });

  it("pages the bound range through read_source_at_version and refuses an unbound or different identity", async () => {
    const ranges = [{ baseSha: base, headSha: head }];
    const read = await readCommitRanges({ repositoryFullName: "o/r", ranges, expectedDigest: null, roots: [root], readProviderRange: async () => null });
    if (!read.ok) throw new Error("range unreadable");
    const options = { roots: [root], readProviderRange: async () => null };
    const params = { repositoryFullName: "o/r", path: commitRangePath(ranges), version: head, expectedBlobId: read.data.digest, maxLines: 5 };
    const page = await readCommitRangeAtVersion(params, options);
    expect(page).toMatchObject({ success: true, data: { path: params.path, version: head, blobId: read.data.digest, startLine: 1, endLine: 5, hasMore: true } });
    if (!page.success) throw new Error(page.message);
    const next = await readCommitRangeAtVersion({ ...params, cursor: (page.data as { nextCursor: string }).nextCursor }, options);
    expect(next).toMatchObject({ success: true, data: { startLine: 6 } });
    await expect(readCommitRangeAtVersion({ ...params, expectedBlobId: undefined }, options)).resolves.toMatchObject({ success: false });
    await expect(readCommitRangeAtVersion({ ...params, version: base }, options)).resolves.toMatchObject({ success: false });
    await expect(readCommitRangeAtVersion({ ...params, expectedBlobId: `sha256:${"0".repeat(64)}` }, options))
      .resolves.toMatchObject({ success: false, error: "IMMUTABLE_BLOB_MISMATCH" });
  });

  it("is one artifact kind across the review contract, the reader binding and the receipt schema", () => {
    const ranges = [{ baseSha: "1".repeat(40), headSha: "2".repeat(40) }, { baseSha: "3".repeat(40), headSha: "4".repeat(40) }];
    const ref = { kind: "repo-commit-range" as const, repositoryFullName: "o/r", ranges, digest: `sha256:${"a".repeat(64)}` };
    expect(parseInitiativeReviewArtifactRef(ref)).toEqual(ref);
    expect(immutableArtifactIdentity(ref)).toEqual({ repositoryFullName: "o/r", path: commitRangePath(ranges),
      version: "4".repeat(40), expectedBlobId: ref.digest });
    expect(immutablePageReaderForArtifact(ref)).toBe("read_source_at_version");
    expect(validInitiativeArtifactRef(ref)).toBe(true);
    expect(validInitiativeArtifactRef({ ...ref, ranges: [] })).toBe(false);
  });

  it("round-trips the reader path and refuses malformed references", () => {
    const ranges = [{ baseSha: "1".repeat(40), headSha: "2".repeat(40) }, { baseSha: "2".repeat(40), headSha: "3".repeat(40) }];
    expect(parseCommitRangePath(commitRangePath(ranges))).toEqual(ranges);
    expect(parseCommitRangePath("repo-commit-range/../etc")).toBeNull();
    expect(parseCommitRangePath("apps/web/lib/x.ts")).toBeNull();
    const ref = { kind: "repo-commit-range", repositoryFullName: "o/r", ranges, digest: `sha256:${"a".repeat(64)}` };
    expect(parseRepoCommitRangeRef(ref)).toEqual(ref);
    expect(parseRepoCommitRangeRef({ ...ref, ranges: [] })).toBeNull();
    expect(parseRepoCommitRangeRef({ ...ref, digest: "sha256:short" })).toBeNull();
    expect(parseRepoCommitRangeRef({ ...ref, ranges: [{ baseSha: "1".repeat(40), headSha: "1".repeat(40) }] })).toBeNull();
  });
});

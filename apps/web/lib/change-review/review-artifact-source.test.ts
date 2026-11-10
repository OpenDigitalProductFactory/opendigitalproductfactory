import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseReviewArtifactSource, readReviewArtifactFromSource } from "./review-artifact-source";

let repo: string;
let base: string;
let head: string;
let baseTree: string;
let headTree: string;
let expected: Buffer;
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args]);
const out = (...args: string[]) => git(...args).toString().trim();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "review-artifact-source-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  writeFileSync(join(repo, "file.ts"), "export const value = 1;\n");
  git("add", "-A"); git("commit", "-q", "-m", "base");
  base = out("rev-parse", "HEAD");
  writeFileSync(join(repo, "file.ts"), "export const value = 2;\n");
  writeFileSync(join(repo, "image.bin"), Buffer.from([0, 1, 2, 255, 254, 0, 10]));
  git("add", "-A"); git("commit", "-q", "-m", "head");
  head = out("rev-parse", "HEAD");
  baseTree = out("rev-parse", `${base}^{tree}`);
  headTree = out("rev-parse", `${head}^{tree}`);
  // The exact command a client runs to compute its diffDigest.
  expected = git("diff", "--binary", base, head);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const request = (overrides: Record<string, unknown> = {}) => ({
  source: { baseSha: base, headSha: head }, baseTreeHash: baseTree, headTreeHash: headTree,
  diffDigest: digest(expected), roots: [repo], ...overrides,
});

describe("readReviewArtifactFromSource (BI-FC2AF393)", () => {
  it("reads the exact git diff --binary a client would paste, binary patches included", async () => {
    const result = await readReviewArtifactFromSource(request());
    expect(result).toMatchObject({ ok: true, data: { root: repo } });
    if (!result.ok) throw new Error("expected a read");
    expect(result.data.artifact).toBe(expected.toString("utf8"));
    expect(result.data.artifact).toContain("GIT binary patch");
    expect(digest(Buffer.from(result.data.artifact, "utf8"))).toBe(digest(expected));
  });

  it("skips a root that lacks the commits and uses the next one", async () => {
    const empty = mkdtempSync(join(tmpdir(), "review-artifact-empty-"));
    try {
      execFileSync("git", ["-C", empty, "init", "-q"]);
      expect(await readReviewArtifactFromSource(request({ roots: [empty, repo] }))).toMatchObject({ ok: true, data: { root: repo } });
    } finally { rmSync(empty, { recursive: true, force: true }); }
  });

  it("refuses when no root has both commits", async () => {
    expect(await readReviewArtifactFromSource(request({ source: { baseSha: base, headSha: "e".repeat(40) } })))
      .toMatchObject({ ok: false, code: "review-source-commit-unavailable" });
  });

  it.each(["baseTreeHash", "headTreeHash"])("refuses a %s that does not match the commit", async (key) => {
    expect(await readReviewArtifactFromSource(request({ [key]: "d".repeat(40) })))
      .toMatchObject({ ok: false, code: "review-source-tree-mismatch" });
  });

  it("refuses a digest mismatch and reports the server digest without starting a review", async () => {
    expect(await readReviewArtifactFromSource(request({ diffDigest: "0".repeat(64) })))
      .toMatchObject({ ok: false, code: "review-artifact-digest-mismatch", serverDigest: digest(expected) });
  });

  it("refuses a diff over the packet budget and points to the large-artifact item", async () => {
    const result = await readReviewArtifactFromSource(request({ maxBytes: 16 }));
    expect(result).toMatchObject({ ok: false, code: "review-artifact-too-large" });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.message).toContain("BI-8FFEA2AA");
  });
});

describe("parseReviewArtifactSource", () => {
  it("accepts two distinct full commit ids and nothing else", () => {
    expect(parseReviewArtifactSource({ baseSha: "a".repeat(40), headSha: "b".repeat(40) }))
      .toEqual({ baseSha: "a".repeat(40), headSha: "b".repeat(40) });
    for (const value of [null, "x", [], { baseSha: "a".repeat(40) }, { baseSha: "a".repeat(40), headSha: "a".repeat(40) },
      { baseSha: "abc", headSha: "b".repeat(40) }, { baseSha: "a".repeat(40), headSha: "b".repeat(40), extra: 1 }]) {
      expect(parseReviewArtifactSource(value)).toBeNull();
    }
  });
});

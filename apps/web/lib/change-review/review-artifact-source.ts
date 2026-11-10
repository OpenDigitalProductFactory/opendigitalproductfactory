import { createHash } from "node:crypto";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

/**
 * Read a review artifact from the install's own source checkout (BI-FC2AF393).
 *
 * `review_semantic_change` needs the exact `git diff --binary <base> <head>`.
 * Requiring the caller to paste it blocked in-limit PRs whose diff a client
 * cannot carry in one turn (#6845, 147 KB; #6849, 132 KB), and every
 * republish repeated the paste. Given the range, the server reads the same
 * bytes from a source root that holds both commits and checks them against the
 * caller's trees and digest before anything is reviewed. Artifacts over the
 * packet budget stay with BI-8FFEA2AA's reference representation.
 */
export type ReviewArtifactSource = { baseSha: string; headSha: string };

export type ReviewArtifactRead =
  | ActionSuccess<{ artifact: string; root: string }>
  | { ok: false; code: ReviewArtifactRefusal; message: string; serverDigest?: string };

export type ReviewArtifactRefusal =
  | "review-source-commit-unavailable" | "review-source-tree-mismatch" | "review-artifact-digest-mismatch"
  | "review-artifact-too-large" | "review-artifact-not-utf8";

/** Leaves room for the rest of the 2 MiB request packet. */
export const REVIEW_ARTIFACT_SOURCE_MAX_BYTES = 1_800_000;

const SHA = /^[a-f0-9]{40}$/;

export function parseReviewArtifactSource(value: unknown): ReviewArtifactSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (Object.keys(entry).some((key) => key !== "baseSha" && key !== "headSha")) return null;
  const { baseSha, headSha } = entry;
  return typeof baseSha === "string" && typeof headSha === "string" && SHA.test(baseSha) && SHA.test(headSha)
    && baseSha !== headSha ? { baseSha, headSha } : null;
}

type GitRunner = (root: string, args: string[], maxBuffer: number) => Promise<Buffer>;

async function runGit(root: string, args: string[], maxBuffer: number): Promise<Buffer> {
  const [{ execFile }, { promisify }, { trustedGitArgs }] = await Promise.all([
    import("node:child_process"), import("node:util"), import("@/lib/work-capsules/git-scanner")]);
  const { stdout } = await promisify(execFile)("git", trustedGitArgs(root, args),
    { encoding: "buffer", maxBuffer, timeout: 30_000, windowsHide: true });
  return stdout as Buffer;
}

async function sourceRoots(): Promise<string[]> {
  const { mergeSignalRoots } = await import("@/lib/backlog/initiative-readiness/merge-delivery-signal");
  return mergeSignalRoots();
}

export async function readReviewArtifactFromSource(input: {
  source: ReviewArtifactSource;
  baseTreeHash: string;
  headTreeHash: string;
  diffDigest: string;
  roots?: readonly string[];
  maxBytes?: number;
  git?: GitRunner;
}): Promise<ReviewArtifactRead> {
  const git = input.git ?? runGit;
  const maxBytes = input.maxBytes ?? REVIEW_ARTIFACT_SOURCE_MAX_BYTES;
  const { baseSha, headSha } = input.source;
  for (const root of input.roots ?? await sourceRoots()) {
    const tree = async (sha: string) => {
      try { return (await git(root, ["rev-parse", "--verify", "--quiet", `${sha}^{tree}`], 4096)).toString("utf8").trim(); }
      catch { return null; }
    };
    const [baseTree, headTree] = await Promise.all([tree(baseSha), tree(headSha)]);
    if (!baseTree || !headTree) continue;
    if (baseTree !== input.baseTreeHash || headTree !== input.headTreeHash) {
      return { ok: false, code: "review-source-tree-mismatch",
        message: `The commits' trees (base ${baseTree}, head ${headTree}) do not match baseTreeHash/headTreeHash; nothing was reviewed.` };
    }
    let bytes: Buffer;
    try {
      bytes = await git(root, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", baseSha, headSha], maxBytes + 1);
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return tooLarge(maxBytes);
      throw error;
    }
    if (bytes.length > maxBytes) return tooLarge(maxBytes);
    const artifact = bytes.toString("utf8");
    if (!Buffer.from(artifact, "utf8").equals(bytes)) {
      return { ok: false, code: "review-artifact-not-utf8",
        message: "The diff is not valid UTF-8 text, so it cannot be carried in a review request; nothing was reviewed." };
    }
    const serverDigest = createHash("sha256").update(bytes).digest("hex");
    if (serverDigest !== input.diffDigest) {
      return { ok: false, code: "review-artifact-digest-mismatch", serverDigest,
        message: `The diff read from source has sha256 ${serverDigest}, not the supplied diffDigest; nothing was reviewed. Recompute the digest with git diff --binary <base> <head>.` };
    }
    return ok({ artifact, root });
  }
  return { ok: false, code: "review-source-commit-unavailable",
    message: "No source checkout on this install holds both commits; push the branch or supply the artifact text instead." };
}

function tooLarge(maxBytes: number): ReviewArtifactRead {
  return { ok: false, code: "review-artifact-too-large",
    message: `The diff exceeds the ${maxBytes}-byte review budget; large artifacts need the reference representation tracked in BI-8FFEA2AA.` };
}

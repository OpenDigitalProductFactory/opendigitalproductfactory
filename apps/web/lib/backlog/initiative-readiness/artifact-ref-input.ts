import type { ToolResult } from "@/lib/mcp-tool-types";
import {
  resolveSourceCommitShas,
  sourceCommitRefusal,
  workedCall,
  type SourceCommitResolverDeps,
} from "@/lib/work-capsules/source-commit-resolution";

/**
 * BI-DF34D948: an evidence writer holds a path and the head it pushed. Asking
 * it to hand-compute `git rev-parse <head>:<path>` produced "not a recognized
 * immutable provider blob" in 10 of 10 sessions. A caller-supplied repository
 * artifact is completed here — kind, canonical repository, full commit and
 * provider blob id — before the receipt writer sees it; the writer still
 * verifies the completed locator exactly as before.
 */

const FULL = /^[0-9a-f]{40}$/i;
const HEX = /^[0-9a-f]+$/i;

export type ArtifactRefInputDeps = {
  canonicalRepositoryFullName: () => Promise<string>;
  commitDeps: (repositoryFullName: string) => SourceCommitResolverDeps;
  /** The blob the provider serves at commit:path (`git rev-parse <commit>:<path>`). */
  readBlobId: (args: { repositoryFullName: string; commitSha: string; path: string }) =>
    Promise<{ ok: true; blobId: string } | { ok: false; code: string; error: string }>;
};

type Call = { tool: string; args: Record<string, unknown> };

export type ArtifactRefNormalization =
  | { ok: true; artifactRef: unknown; derived: string[] }
  | { ok: false; refusal: ToolResult };

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

export const REPOSITORY_ARTIFACT_EXAMPLE_PATH = "docs/superpowers/specs/<file>.md";

function withArtifact(call: Call, artifactRef: Record<string, unknown>): string {
  return workedCall(call.tool, { ...call.args, artifactRef });
}

export async function normalizeRepositoryArtifactRefInput(
  raw: unknown,
  deps: ArtifactRefInputDeps,
  call: Call,
): Promise<ArtifactRefNormalization> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: true, artifactRef: raw, derived: [] };
  const ref = raw as Record<string, unknown>;
  const kindGiven = ref.kind !== undefined;
  if (kindGiven ? ref.kind !== "repo-blob-at-commit" : !("path" in ref)) return { ok: true, artifactRef: raw, derived: [] };

  const commitInput = ref.commitSha ?? ref.headSha;
  const path = text(ref.path);
  const commitKey = ref.commitSha !== undefined ? "commitSha" : "headSha";
  if (kindGiven && text(ref.repositoryFullName) && path && typeof commitInput === "string" && FULL.test(commitInput.trim())
    && typeof ref.providerBlobId === "string" && FULL.test(ref.providerBlobId.trim())) {
    return { ok: true, artifactRef: raw, derived: [] };
  }
  const derived: string[] = kindGiven ? [] : ["kind"];
  if (!path || commitInput == null) {
    const example = { path: path ?? REPOSITORY_ARTIFACT_EXAMPLE_PATH, headSha: typeof commitInput === "string" && commitInput.trim() ? commitInput.trim() : "<40-hex output of git rev-parse HEAD>" };
    return { ok: false, refusal: { success: false, error: "malformed-receipt",
      message: `A repository artifact needs the file path and the pushed commit it was read at; the server derives the blob id. Retry: ${withArtifact(call, example)}` } };
  }

  let repositoryFullName = text(ref.repositoryFullName);
  if (!repositoryFullName) {
    repositoryFullName = await deps.canonicalRepositoryFullName();
    derived.push("repositoryFullName");
  }
  const sha = await resolveSourceCommitShas({ headSha: commitInput }, deps.commitDeps(repositoryFullName));
  if (!sha.ok) {
    const callerRef = { ...ref };
    return { ok: false, refusal: sourceCommitRefusal(sha, { ...call, label: `artifactRef.${commitKey}`,
      withValue: (value) => ({ ...call.args, artifactRef: { ...callerRef, [commitKey]: value } }) }) };
  }
  const commitSha = sha.headSha!;
  if (sha.expanded.length > 0 || commitKey !== "commitSha") derived.push("commitSha");

  const suppliedBlob = text(ref.providerBlobId);
  if (suppliedBlob && FULL.test(suppliedBlob)) {
    return { ok: true, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName, commitSha, path, providerBlobId: suppliedBlob }, derived };
  }
  const blob = await deps.readBlobId({ repositoryFullName, commitSha, path });
  const corrected = { path, headSha: commitSha };
  if (!blob.ok) {
    return { ok: false, refusal: { success: false, error: blob.code,
      message: `${blob.error} The provider has no ${path} at ${commitSha}: git push the branch so that commit is on the provider (and check the path is repository-relative), then retry: ${withArtifact(call, corrected)}` } };
  }
  if (suppliedBlob && (!HEX.test(suppliedBlob) || !blob.blobId.toLowerCase().startsWith(suppliedBlob.toLowerCase()))) {
    return { ok: false, refusal: { success: false, error: "malformed-receipt",
      message: `providerBlobId "${suppliedBlob}" is not the blob at ${path}@${commitSha} (${blob.blobId}). Omit it and let the server derive it, or retry with: ${withArtifact(call, { ...corrected, providerBlobId: blob.blobId })}` } };
  }
  derived.push("providerBlobId");
  return { ok: true, artifactRef: { kind: "repo-blob-at-commit", repositoryFullName, commitSha, path, providerBlobId: blob.blobId }, derived };
}

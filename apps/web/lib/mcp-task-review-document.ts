import { resolveInitiativeArtifact } from "./backlog/initiative-readiness/artifact-resolver";
import { parseInitiativeScopeManifest } from "./backlog/initiative-readiness/baseline-manifest";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";

/** Validate only a new review that will mint scope. This is not an approval:
 * the independent reviewer and baseline writer still enforce their contracts. */
export async function validateReviewDocument(binding: InitiativeReviewBinding | undefined): Promise<{
  error: string;
  message: string;
  gateStatus: "unrun";
} | null> {
  if (binding?.writerToolName !== "record_initiative_design_review" || binding.gate !== "spec-approval") return null;
  const refused = (error: string, message: string) => ({ error, message, gateStatus: "unrun" as const });
  let resolved: Awaited<ReturnType<typeof resolveInitiativeArtifact>>;
  try {
    resolved = await resolveInitiativeArtifact({ locator: binding.artifactRef,
      subject: { kind: "backlog-item", id: binding.itemId } });
  } catch {
    return refused("IMMUTABLE_SOURCE_UNAVAILABLE", "The immutable review document could not be loaded. Restore access and retry the same request; the review has not run.");
  }
  if (!resolved.ok) return refused(resolved.code, resolved.error);
  if (binding.artifactRef.kind === "feature-build-revision"
    && resolved.artifact.digest.replace(/^sha256:/, "") !== binding.artifactRef.valueDigest.replace(/^sha256:/, "")) {
    return refused("IMMUTABLE_BLOB_MISMATCH", "The review document no longer matches the requested immutable value digest.");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(resolved.artifact.bytes);
  } catch {
    return refused("manifest-invalid", "The scope document must be valid UTF-8.");
  }
  const manifest = parseInitiativeScopeManifest(text, resolved.artifact.digest);
  return manifest.ok ? null : refused(manifest.code, manifest.error);
}

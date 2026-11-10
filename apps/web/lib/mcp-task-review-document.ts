import { resolveInitiativeArtifact } from "./backlog/initiative-readiness/artifact-resolver";
import { parseInitiativeScopeManifest } from "./backlog/initiative-readiness/baseline-manifest";
import type { InitiativeReviewBinding } from "./mcp-task-review-contract";
import { TERMINAL_WRITER_RECOVERY_MAX_CHARS } from "./mcp-task-terminal-writer-context";

type ReviewDocumentRefusal = { error: string; message: string; gateStatus: "unrun" };

/** Reviews of the design document itself, whose size the notice covers. */
const DESIGN_DOCUMENT_GATES = new Set(["design-spec", "spec-approval"]);

/**
 * BI-4592CF69: a resumed review re-reads its source within a fixed budget. A
 * larger design can be reviewed in one pass, but an interrupted review of it
 * can never finish. Tell the author when the review is requested.
 */
// The notice goes to an agent's tool result, not a viewer, so it uses one
// fixed digit grouping rather than a viewer locale.
function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function reviewDocumentSizeNotice(charCount: number): string | null {
  if (charCount <= TERMINAL_WRITER_RECOVERY_MAX_CHARS) return null;
  const size = groupDigits(charCount);
  const cap = groupDigits(TERMINAL_WRITER_RECOVERY_MAX_CHARS);
  return `This design is ${size} characters. A review that is interrupted can re-read at most ${cap} characters to resume, `
    + "so an interrupted review of this design cannot finish (terminal_writer_context_oversize). The review was still requested. "
    + `To make it resumable, shorten or split the design below ${cap} characters, then request the review again.`;
}

/** Validate only a new review that will mint scope, and report a design too
 * large to resume. This is not an approval: the independent reviewer and
 * baseline writer still enforce their contracts. Only spec approval can be
 * refused here; the size is a notice and never blocks a request. */
export async function reviewDocumentPreflight(binding: InitiativeReviewBinding | undefined): Promise<{
  refusal: ReviewDocumentRefusal | null;
  notice: string | null;
}> {
  const none = { refusal: null, notice: null };
  if (binding?.writerToolName !== "record_initiative_design_review" || !DESIGN_DOCUMENT_GATES.has(binding.gate)) return none;
  const mintsScope = binding.gate === "spec-approval";
  const refused = (error: string, message: string) => ({
    refusal: mintsScope ? { error, message, gateStatus: "unrun" as const } : null,
    notice: null,
  });
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
  if (mintsScope) {
    const manifest = parseInitiativeScopeManifest(text, resolved.artifact.digest);
    if (!manifest.ok) return refused(manifest.code, manifest.error);
  }
  return { refusal: null, notice: reviewDocumentSizeNotice(text.length) };
}

/** Validate only a new review that will mint scope. */
export async function validateReviewDocument(binding: InitiativeReviewBinding | undefined): Promise<ReviewDocumentRefusal | null> {
  if (binding?.writerToolName !== "record_initiative_design_review" || binding.gate !== "spec-approval") return null;
  return (await reviewDocumentPreflight(binding)).refusal;
}

import {
  BUILD_ARTIFACT_REVISION_READER_TOOL,
  REPOSITORY_BLOB_READER_TOOL,
} from "./terminal-tool-policy";

/** The current producer text is also the exact comparison contract for recovery. */
export const IMMUTABLE_REVIEW_READER_TOOL = REPOSITORY_BLOB_READER_TOOL;

/** A reviewable artifact as the recovery resolver hands it to the objective. */
export type InitiativeReviewObjectiveArtifact =
  | { kind?: "repo-blob-at-commit"; path: string; providerBlobId: string; commitSha?: string }
  | { kind: "feature-build-revision"; revisionId: string; valueDigest: string; buildId?: string };

export type InitiativeReviewObjectiveInput = {
  itemId: string;
  workroomId: string;
  repositoryFullName: string;
  branchName: string;
  headSha: string;
  gate: string;
  toolName: string;
  independent: boolean;
  artifact: InitiativeReviewObjectiveArtifact | null;
  eligibleEvidenceActivityIds: readonly string[] | null;
};

export function formatInitiativeReviewObjective(args: InitiativeReviewObjectiveInput): string {
  const reviewSha = (args.artifact && args.artifact.kind !== "feature-build-revision" ? args.artifact.commitSha : undefined) ?? args.headSha;
  const mappingInstruction = args.gate === "objective-mapping"
    ? ` Map every current OBJ-* and AC-* statement to post-baseline evidence using only these eligible activity IDs: ${args.eligibleEvidenceActivityIds?.join(", ")}. Submit the proposal with record_initiative_evidence(operation='objective-mapping').`
    : "";
  return `For ${args.itemId} in ${args.workroomId} on ${args.repositoryFullName}#${args.branchName} at Workroom head ${args.headSha}, ${args.independent ? "independently " : ""}address ${args.gate} using ${args.toolName}.${
    args.artifact?.kind === "feature-build-revision"
      ? ` Read the accepted Build Studio design revision ${args.artifact.revisionId} with ${BUILD_ARTIFACT_REVISION_READER_TOOL} (repositoryFullName ${args.repositoryFullName}, path build-artifact-revision/${args.artifact.revisionId}, version ${args.artifact.revisionId}, expectedBlobId ${args.artifact.valueDigest}),`
      : args.artifact
        ? ` Read ${args.artifact.path} at ${reviewSha} with ${IMMUTABLE_REVIEW_READER_TOOL} (repositoryFullName ${args.repositoryFullName}, version ${reviewSha}, expectedBlobId ${args.artifact.providerBlobId}),`
        : ""
  } record a governed receipt only when the gate passes.${mappingInstruction}`;
}

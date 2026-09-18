/** The current producer text is also the exact comparison contract for recovery. */
export const IMMUTABLE_REVIEW_READER_TOOL = "read_source_at_version";

export type InitiativeReviewObjectiveInput = {
  itemId: string;
  workroomId: string;
  repositoryFullName: string;
  branchName: string;
  headSha: string;
  gate: string;
  toolName: string;
  independent: boolean;
  artifact: { path: string; providerBlobId: string; commitSha?: string } | null;
  eligibleEvidenceActivityIds: readonly string[] | null;
};

export function formatInitiativeReviewObjective(args: InitiativeReviewObjectiveInput): string {
  const reviewSha = args.artifact?.commitSha ?? args.headSha;
  const mappingInstruction = args.gate === "objective-mapping"
    ? ` Map every current OBJ-* and AC-* statement to post-baseline evidence using only these eligible activity IDs: ${args.eligibleEvidenceActivityIds?.join(", ")}. Submit the proposal with record_initiative_evidence(operation='objective-mapping').`
    : "";
  return `For ${args.itemId} in ${args.workroomId} on ${args.repositoryFullName}#${args.branchName} at Workroom head ${args.headSha}, ${args.independent ? "independently " : ""}address ${args.gate} using ${args.toolName}.${
    args.artifact
      ? ` Read ${args.artifact.path} at ${reviewSha} with ${IMMUTABLE_REVIEW_READER_TOOL} (repositoryFullName ${args.repositoryFullName}, version ${reviewSha}, expectedBlobId ${args.artifact.providerBlobId}),`
      : ""
  } record a governed receipt only when the gate passes.${mappingInstruction}`;
}

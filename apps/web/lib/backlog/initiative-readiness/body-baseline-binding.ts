import { isRecord } from "@/lib/shared/coerce";
import { immutableArtifactIdentity, parseInitiativeReviewArtifactRef, type InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { sameBodyCriteriaVersion } from "./body-baseline-version";

/** One freshness predicate for document reader, dispatch admission and writer. */
export function bodyBaselineInputsMatch(payload: unknown, args: {
  itemId: string; organizationId: string | null; body: string | null;
  binding: InitiativeReviewBinding;
}): boolean {
  if (!isRecord(payload) || payload.origin !== "item-body") return false;
  const subject = isRecord(payload.subject) ? payload.subject : null;
  const source = isRecord(payload.sourceIdentity) ? payload.sourceIdentity : null;
  const authority = isRecord(payload.authoritySnapshot) ? payload.authoritySnapshot : null;
  const artifact = parseInitiativeReviewArtifactRef(payload.artifactRef);
  const ref = args.binding.workroomRef;
  return Boolean(subject?.kind === "backlog-item" && subject.id === args.itemId
    && args.binding.itemId === args.itemId && payload.baselineId === args.binding.expectedCurrentBaselineId
    && authority?.organizationId === (args.organizationId ?? "platform")
    && typeof payload.criteriaDigest === "string"
    && sameBodyCriteriaVersion({ criteriaDigest: payload.criteriaDigest }, args.body)
    && ref && source?.repositoryFullName === ref.repositoryFullName && source?.headSha === ref.headSha
    && artifact?.kind === "document-version" && args.binding.artifactRef.kind === "document-version"
    && canonicalJson(immutableArtifactIdentity(artifact)) === canonicalJson(immutableArtifactIdentity(args.binding.artifactRef)));
}

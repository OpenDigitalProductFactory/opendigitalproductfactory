import type { PortalContextEnvelope } from "./types";

type DigestEnvelope = Omit<PortalContextEnvelope, "promptDigest">;

export function createPortalContextPromptDigest(envelope: DigestEnvelope): string {
  return [
    `Route: ${envelope.route.routeContext}`,
    envelope.work.featureBuild
      ? `Build: ${envelope.work.featureBuild.buildId} phase=${envelope.work.featureBuild.phase} status=${envelope.work.featureBuild.status}`
      : null,
    envelope.work.capsule
      ? `Capsule: ${envelope.work.capsule.capsuleId} status=${envelope.work.capsule.status} executor=${envelope.work.capsule.executorKind}`
      : null,
    envelope.work.epic ? `Epic: ${envelope.work.epic.epicId}` : null,
    envelope.work.backlogItem
      ? `Backlog: ${envelope.work.backlogItem.backlogItemId} status=${envelope.work.backlogItem.status}`
      : null,
    envelope.work.branch ? `Branch: ${envelope.work.branch.branchName}` : null,
    envelope.attention.length
      ? `Attention: ${envelope.attention.map((signal) => `${signal.kind}(${signal.severity})`).join(", ")}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

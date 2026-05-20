import type { PortalContextEnvelope } from "./types";

type DigestEnvelope = Omit<PortalContextEnvelope, "promptDigest">;

const DIGEST_TEXT_LIMIT = 160;
const PROMPT_MARKER_PATTERN = /(###\s*system|<<+|>>+)/gi;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/g;

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
    envelope.work.branch ? branchDigestLine(envelope.work.branch.branchName) : null,
    envelope.attention.length
      ? `Attention: ${envelope.attention.map((signal) => `${signal.kind}(${signal.severity})`).join(", ")}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function safeDigestText(value: unknown, limit = DIGEST_TEXT_LIMIT): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .replace(PROMPT_MARKER_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trimEnd()}...` : normalized;
}

function branchDigestLine(branchName: string) {
  const safeBranchName = safeDigestText(branchName);
  return safeBranchName ? `Branch: ${safeBranchName}` : null;
}

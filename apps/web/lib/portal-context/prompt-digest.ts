import type { PortalContextEnvelope, CoworkerCapabilitySnapshot } from "./types";

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
    // D29 (2026-05-23): capability snapshot for routes where the user can fix
    // the gap themselves. Without this the coworker doesn't know the actual
    // problem on /platform/ai/providers or /build and defaults to generic
    // "wait and try again" hedging (cf. IDENTITY_BLOCK principle #23).
    formatCapabilityDigestLine(envelope.capability),
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/**
 * Render the build-studio capability snapshot as one prompt-digest line.
 *
 * Returns null when there is nothing actionable to say (unrelated route, or
 * capability gate is open). Returns a clearly-formatted line otherwise so the
 * model can read the exact gap + recommended action and respond with concrete
 * guidance rather than generic deflection.
 */
function formatCapabilityDigestLine(
  capability: CoworkerCapabilitySnapshot | null | undefined,
): string | null {
  if (!capability) return null;
  if (capability.kind !== "build_studio") return null;
  if (capability.gateOpen) {
    // Gate is open — no need to add prompt weight on this turn.
    return null;
  }
  const reasonText: Record<typeof capability.reason, string> = {
    no_active_llm_providers: "no AI providers are connected yet",
    only_local_provider_active: "only the local AI is connected (not strong enough for Build Studio)",
    no_strong_tier_model_available: "a stronger AI provider needs to be connected",
  };
  const reason = reasonText[capability.reason] ?? capability.reason;
  const recommend = capability.recommendedAction
    ? ` recommend="${capability.recommendedAction}"`
    : "";
  const userCanFix = capability.userCanFix
    ? " user-can-fix=true"
    : " user-can-fix=false (needs admin)";
  return `Capability: build-studio gate-open=false reason="${reason}"${recommend}${userCanFix}`;
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

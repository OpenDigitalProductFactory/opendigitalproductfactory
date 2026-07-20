import {
  parseProviderComplianceAdvisory,
  PROVIDER_COMPLIANCE_ADVISORY_VERSION,
  type ProviderComplianceAdvisory,
} from "./provider-compliance-advisory";
import {
  parseProviderReviewObjective,
  type ProviderReviewPacket,
} from "./provider-review-packet";

export const PROVIDER_COMPLIANCE_LOCAL_POLICY_VERSION =
  "provider-compliance-local-only.v1" as const;
export const PROVIDER_COMPLIANCE_FALLBACK_CORPUS_VERSION =
  "professions/legal-compliance/ai-provider-account-and-sovereignty-review@v1" as const;

export type ProviderComplianceResultSource = "local-model" | "deterministic-fallback";

const CORPUS_CITATION = {
  title: "AI provider review — assess the connected account, not just the vendor",
  reference: "professions/legal-compliance/ai-provider-account-and-sovereignty-review",
  supports: "Connectivity does not prove business terms, retention, training treatment, processor contracts, or regional-processing entitlement.",
} as const;

function packetFromHistory(chatHistory: ReadonlyArray<{ role: string; content: unknown }>): ProviderReviewPacket | null {
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const message = chatHistory[index];
    if (message?.role !== "user") continue;
    if (typeof message.content !== "string") continue;
    const parsed = parseProviderReviewObjective(message.content);
    if (parsed.success) return parsed.value;
  }
  return null;
}

function workloadLabel(value: string): string {
  return value.replaceAll("-", " ");
}

/**
 * Corpus-backed fail-closed guidance for a fresh install. It never approves a
 * hosted connection because the minimized packet carries recommendation state,
 * not account-scoped contract or entitlement evidence.
 */
export function buildDeterministicProviderComplianceFallback(
  packet: ProviderReviewPacket | null,
): ProviderComplianceAdvisory {
  const blocked = packet?.providerConnections.some((connection) => connection.scopes.includes("blocked")) ?? false;
  const notReady = packet?.recommendation.status === "not-ready";
  const restrictedWorkloads = (packet?.recommendation.workloadClasses ?? [])
    .filter((workload) => workload !== "public-marketing")
    .map((workload) => `Keep ${workloadLabel(workload)} on a governed non-egress path until the connected account is evidenced.`);

  return {
    schemaVersion: PROVIDER_COMPLIANCE_ADVISORY_VERSION,
    decision: blocked || notReady ? "not-suitable" : "insufficient-evidence",
    plainLanguageSummary: packet
      ? "DPF cannot confirm this connected account is suitable for company data. A working connection does not establish business terms, retention, training treatment, processor contracts, or regional-processing entitlement."
      : "DPF cannot confirm provider suitability because the bounded review packet was unavailable. No hosted provider is approved by this fallback.",
    safestNextAction: "Keep non-public work local or blocked, then obtain and review account-scoped contract, retention, training, subprocessor, and processing-region evidence.",
    workloadRestrictions: restrictedWorkloads.length > 0
      ? restrictedWorkloads
      : ["Use only public or synthetic material until the connected account is evidenced."],
    unknowns: [
      "The connected account's commercial and processor terms are not evidenced in this review packet.",
      "Retention and model-training treatment for this exact connection are not evidenced.",
      "Enabled processing regions, support access, and subprocessors are not evidenced.",
    ],
    humanReviewRequired: true,
    citations: [{ ...CORPUS_CITATION }],
  };
}

export function resolveProviderComplianceColdStartReply(input: {
  specialistReply: string;
  chatHistory: ReadonlyArray<{ role: string; content: unknown }>;
}): {
  advisory: ProviderComplianceAdvisory;
  content: string;
  resultSource: ProviderComplianceResultSource;
} {
  const parsed = parseProviderComplianceAdvisory(input.specialistReply);
  const boundedLocalResult = parsed.success
    && parsed.value.decision !== "recommended"
    && !(parsed.value.decision === "insufficient-evidence" && !parsed.value.humanReviewRequired);
  const resultSource: ProviderComplianceResultSource = boundedLocalResult
    ? "local-model"
    : "deterministic-fallback";
  const advisory = boundedLocalResult
    ? parsed.value
    : buildDeterministicProviderComplianceFallback(packetFromHistory(input.chatHistory));
  return { advisory, content: JSON.stringify(advisory), resultSource };
}

export function deterministicProviderComplianceReplyFromHistory(
  chatHistory: ReadonlyArray<{ role: string; content: unknown }>,
): ReturnType<typeof resolveProviderComplianceColdStartReply> {
  const advisory = buildDeterministicProviderComplianceFallback(packetFromHistory(chatHistory));
  return {
    advisory,
    content: JSON.stringify(advisory),
    resultSource: "deterministic-fallback",
  };
}

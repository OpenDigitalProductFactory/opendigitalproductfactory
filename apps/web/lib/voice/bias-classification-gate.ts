/**
 * Voice Input Slice 1 / Task 4 — bias-prompt classification gate.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.7 step 4 + §7.4
 *
 * The gate is the only off-org PII-leak boundary for transcription. When the
 * routing layer dispatches transcription to a hosted provider (Groq, Deepgram,
 * AssemblyAI, etc.), the Whisper `initial_prompt` field can carry org
 * vocabulary that the provider's logs / training pipelines will see. This
 * function strips bias tokens to the public/internal-low subset before any
 * off-org dispatch.
 *
 * Slice 1 callers pass empty bias — the actual vocabulary builder lands in
 * Slice 2 (per spec §8 deferral). Implementing the gate now means Slice 2
 * doesn't have to touch the route or the call-site to enable redaction.
 *
 * Per kernel principle [research-and-use-standards]: classification labels
 * mirror the existing PrincipalAlias / sensitivity-clearance vocabulary in
 * DPF (public, internal-low, internal-high, confidential, restricted).
 */

/** Sensitivity classification for a single bias token. */
export type BiasTokenClassification =
  | "public"
  | "internal-low"
  | "internal-high"
  | "confidential"
  | "restricted"
  | "unclassified";

/** A bias token with its classification — provided by the (Slice 2) vocabulary builder. */
export interface BiasClassificationToken {
  text: string;
  classification: BiasTokenClassification;
}

/** Result of the gate decision. */
export interface BiasClassificationResult {
  /** Space-joined prompt the gate authorizes to send to the chosen provider. */
  prompt: string;
  /** Where the prompt is heading. `empty` = nothing to send. */
  classification: "empty" | "on-org" | "off-org";
  /** True if any token was stripped to produce `prompt`. */
  redacted: boolean;
}

export interface BiasClassificationInput {
  bias: BiasClassificationToken[] | undefined;
  providerId: string;
}

/**
 * Providers that run inside the org's own install boundary. Bias is passed
 * verbatim. Anything not in this set is treated as off-org (defense in depth:
 * unknown providers fail-safe to redaction).
 *
 * Slice 1 ships with the local sidecars only. Hosted providers (Groq,
 * Deepgram, AssemblyAI) are always off-org — DPF never enrolls as a partner
 * per [feedback_dpf_as_integration_conduit].
 */
export const ON_ORG_TRANSCRIPTION_PROVIDERS = ["speaches", "whisper-cpp-local"] as const;

/** Classifications safe to forward to an off-org provider. */
const OFF_ORG_SAFE_CLASSIFICATIONS: ReadonlySet<BiasTokenClassification> = new Set([
  "public",
  "internal-low",
]);

function isOnOrg(providerId: string): boolean {
  return (ON_ORG_TRANSCRIPTION_PROVIDERS as readonly string[]).includes(providerId);
}

/**
 * Apply the classification gate to a bias prompt.
 *
 * @example
 *   classifyBiasPrompt({
 *     bias: [
 *       { text: "Daisy", classification: "internal-low" },
 *       { text: "API_KEY", classification: "confidential" },
 *     ],
 *     providerId: "groq",
 *   });
 *   // => { prompt: "Daisy", classification: "off-org", redacted: true }
 */
export function classifyBiasPrompt(
  input: BiasClassificationInput,
): BiasClassificationResult {
  const { bias, providerId } = input;

  if (!bias || bias.length === 0) {
    return { prompt: "", classification: "empty", redacted: false };
  }

  if (isOnOrg(providerId)) {
    return {
      prompt: bias.map((t) => t.text).join(" "),
      classification: "on-org",
      redacted: false,
    };
  }

  // Off-org (or unknown — fail safe). Strip to allow-listed classifications.
  const kept: string[] = [];
  let strippedAny = false;
  for (const token of bias) {
    if (OFF_ORG_SAFE_CLASSIFICATIONS.has(token.classification)) {
      kept.push(token.text);
    } else {
      strippedAny = true;
    }
  }

  return {
    prompt: kept.join(" "),
    classification: "off-org",
    redacted: strippedAny,
  };
}

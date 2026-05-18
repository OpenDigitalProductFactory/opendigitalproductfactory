/**
 * Voice Input Slice 1 / Task 6 — minimal endpoint resolver for transcription.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.7
 *
 * The canonical routing layer (loadEndpointManifests) filters by
 * model-routing endpoint types so it does NOT load transcription endpoints.
 * Per spec §6.7, transcription endpoints have endpointType="transcription"
 * and are picked via EndpointTaskPerformance for taskType="transcription".
 *
 * Slice 1 ships a deliberately minimal resolver: pick the top-scored
 * unblocked EndpointTaskPerformance row for taskType="transcription", join
 * with ModelProfile to get providerId+modelId. No tier weighting yet — Slice 2
 * will fold this into the canonical routing pipeline (recipe-loader path)
 * once additional STT providers (Groq, Deepgram) are seeded.
 *
 * Per kernel principle [no-provider-pinning]: this function MUST NOT hardcode
 * "speaches" as the answer. The DB row is the source of truth — if an admin
 * configures Groq, that row's avgOrchestratorScore should determine selection.
 */

import { prisma } from "@dpf/db";
import type { ResolvedTranscriptionEndpoint, TierHint } from "./types";

export interface ResolveTranscriptionEndpointInput {
  /** Reserved for Slice 2 tier-weighting; currently unused but accepted so the
   *  caller contract is stable. */
  tierHint?: TierHint;
}

export class NoTranscriptionEndpointError extends Error {
  constructor() {
    // Operator-facing copy: per the never-ask-user-to-run-commands kernel
    // commandment, the message must not name shell. The Platform Tools >
    // Communications > Speech-to-text page guides the admin through enabling
    // the sidecar without copy-paste shell.
    super(
      "Speech-to-text isn't configured yet. Enable it in Platform Tools > Communications > Speech-to-text.",
    );
    this.name = "NoTranscriptionEndpointError";
  }
}

/**
 * Resolve which (providerId, modelId) handles a transcription request.
 *
 * Strategy: query EndpointTaskPerformance for taskType="transcription", order
 * by avgOrchestratorScore desc, take the first unblocked row, join through
 * ModelProfile (endpointId = ModelProfile.id) to read providerId + modelId.
 *
 * @throws NoTranscriptionEndpointError when no row exists (admin has not
 *   seeded any STT provider yet).
 */
export async function resolveTranscriptionEndpoint(
  _input: ResolveTranscriptionEndpointInput = {},
): Promise<ResolvedTranscriptionEndpoint> {
  const candidates = await prisma.endpointTaskPerformance.findMany({
    where: {
      taskType: "transcription",
      blocked: false,
    },
    orderBy: [
      { pinned: "desc" },
      { avgOrchestratorScore: "desc" },
      { evaluationCount: "desc" },
    ],
    select: { endpointId: true },
  });

  for (const c of candidates) {
    const profile = await prisma.modelProfile.findUnique({
      where: { id: c.endpointId },
      select: {
        providerId: true,
        modelId: true,
        modelStatus: true,
        provider: { select: { status: true } },
      },
    });
    if (!profile) continue;
    if (profile.modelStatus !== "active") continue;
    if (profile.provider.status !== "active" && profile.provider.status !== "degraded") continue;
    return { providerId: profile.providerId, modelId: profile.modelId };
  }

  throw new NoTranscriptionEndpointError();
}

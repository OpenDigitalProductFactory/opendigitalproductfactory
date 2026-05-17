/**
 * Voice Input Slice 1 / Task 11 — server-side STT readiness lookup.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §5.3
 *
 * Queries the routing-layer substrate (ModelProvider + ModelProfile +
 * EndpointTaskPerformance) to produce a status summary the admin
 * Communications hub renders. Read-only; no side effects.
 */

import { prisma } from "@dpf/db";

/**
 * Readiness status surfaced in the admin Communications hub card.
 *
 * - `healthy`: a transcription-capable model is seeded + active + unblocked.
 * - `unconfigured`: no transcription endpoint exists in the routing layer.
 *   This is the default for fresh installs that haven't opted into the
 *   `stt` docker-compose profile.
 * - `unhealthy`: an endpoint is configured but either the model row is
 *   inactive/retired or the perf row is blocked. Admin needs to intervene.
 */
export type SpeechToTextStatus = "healthy" | "unconfigured" | "unhealthy";

export interface SpeechToTextReadiness {
  status: SpeechToTextStatus;
  providerId: string | null;
  providerName: string | null;
  modelId: string | null;
  baseUrl: string | null;
  /** Human-readable rationale for the status. Surfaced in the card UI. */
  reason: string;
}

/**
 * Compute the STT readiness for the admin Communications hub card.
 *
 * Looks up the top-scored unblocked EndpointTaskPerformance row for
 * taskType="transcription", joins through ModelProfile, and reports
 * the status. The function is forgiving — any "not found" path returns
 * `unconfigured` rather than throwing, so the admin card renders cleanly
 * on fresh installs.
 */
export async function getSpeechToTextReadiness(): Promise<SpeechToTextReadiness> {
  const perf = await prisma.endpointTaskPerformance.findFirst({
    where: { taskType: "transcription" },
    orderBy: [
      { pinned: "desc" },
      { blocked: "asc" },
      { avgOrchestratorScore: "desc" },
    ],
    select: { endpointId: true, blocked: true },
  });

  if (!perf) {
    return {
      status: "unconfigured",
      providerId: null,
      providerName: null,
      modelId: null,
      baseUrl: null,
      reason:
        "No transcription endpoint registered. Start the local STT sidecar via `docker compose --profile stt up dpf-stt` or configure a hosted provider.",
    };
  }

  const profile = await prisma.modelProfile.findUnique({
    where: { id: perf.endpointId },
    select: {
      providerId: true,
      modelId: true,
      modelStatus: true,
      provider: { select: { name: true, baseUrl: true, status: true } },
    },
  });

  if (!profile) {
    return {
      status: "unhealthy",
      providerId: null,
      providerName: null,
      modelId: null,
      baseUrl: null,
      reason:
        "EndpointTaskPerformance row references a missing ModelProfile. Re-run the seed: `pnpm --filter @dpf/db prisma db seed`.",
    };
  }

  if (perf.blocked) {
    return {
      status: "unhealthy",
      providerId: profile.providerId,
      providerName: profile.provider.name,
      modelId: profile.modelId,
      baseUrl: profile.provider.baseUrl,
      reason: "Transcription endpoint is blocked. Unblock via the routing admin UI before traffic can flow.",
    };
  }

  if (profile.modelStatus !== "active") {
    return {
      status: "unhealthy",
      providerId: profile.providerId,
      providerName: profile.provider.name,
      modelId: profile.modelId,
      baseUrl: profile.provider.baseUrl,
      reason: `Model status is "${profile.modelStatus}". Set to "active" via the model admin UI.`,
    };
  }

  if (profile.provider.status !== "active" && profile.provider.status !== "degraded") {
    return {
      status: "unhealthy",
      providerId: profile.providerId,
      providerName: profile.provider.name,
      modelId: profile.modelId,
      baseUrl: profile.provider.baseUrl,
      reason: `Provider status is "${profile.provider.status}". Activate via the provider admin UI.`,
    };
  }

  return {
    status: "healthy",
    providerId: profile.providerId,
    providerName: profile.provider.name,
    modelId: profile.modelId,
    baseUrl: profile.provider.baseUrl,
    reason: `${profile.provider.name} reachable at ${profile.provider.baseUrl ?? "(no baseUrl)"}.`,
  };
}

/**
 * Voice Input Slice 1 / Task 7 — POST /api/transcribe.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §6.5, §7.2
 *
 * Thin route wrapper around transcribe() — validates multipart input,
 * base64-encodes audio for the adapter, calls transcribe(), projects the
 * §6.5 response shape, maps adapter errors to HTTP status per §7.2.
 *
 * Architecture invariant (asserted by route.architecture.test.ts):
 *   This handler MUST compose the existing transcription execution adapter
 *   via the routing layer (callProvider → executionAdapterRegistry). It MUST
 *   NOT construct multipart bodies directly, MUST NOT call the speaches
 *   sidecar directly, and MUST NOT import transcription-adapter internals.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { transcribe } from "@/lib/voice/transcribe";
import { NoTranscriptionEndpointError } from "@/lib/voice/endpoint-resolution";
import { InferenceError } from "@/lib/ai-inference";
import type {
  TranscribeContext,
  TierHint,
  TranscribeInput,
} from "@/lib/voice/types";
import type { BiasClassificationToken } from "@/lib/voice/bias-classification-gate";

/**
 * Single-org-per-install resolver (per project_single_org_per_install.md).
 * Returns null on fresh installs that haven't seeded the Organization row yet,
 * or when the Prisma layer is unavailable (tests, transient DB issues).
 * Slice 2 vocabulary builder treats null as "no bias from this source" —
 * transcription itself never depends on this resolving.
 */
async function resolveOrgId(): Promise<string | null> {
  try {
    const org = await prisma.organization.findFirst({ select: { id: true } });
    return org?.id ?? null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25 MB; ~50 min at 64kbps AAC
const VALID_CONTEXTS: readonly TranscribeContext[] = [
  "coworker_panel",
  "inbound_channel",
  "test_harness",
];
const VALID_TIERS: readonly TierHint[] = ["small", "high-accuracy"];

function isAudioMime(mime: string): boolean {
  // Accept the formats the spec §7.3 client-side MIME probe will produce.
  // Server-side speaches/whisper.cpp handle any audio container via FFmpeg,
  // but we still gate at the boundary to refuse obvious junk.
  return /^audio\//i.test(mime);
}

function jsonError(status: number, errorClass: string, message: string): NextResponse {
  return NextResponse.json({ error: { class: errorClass, message } }, { status });
}

/** Convert a Blob/File to base64. */
async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── 1. Parse multipart ────────────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (_e) {
    return jsonError(400, "tool-denied", "Request must be multipart/form-data");
  }

  const audio = formData.get("audio");
  if (!(audio instanceof Blob)) {
    return jsonError(400, "tool-denied", "Missing required field: audio (Blob)");
  }

  const context = formData.get("context");
  if (typeof context !== "string" || !VALID_CONTEXTS.includes(context as TranscribeContext)) {
    return jsonError(
      400,
      "tool-denied",
      `Missing or invalid field: context (must be one of ${VALID_CONTEXTS.join(", ")})`,
    );
  }

  if (!isAudioMime(audio.type)) {
    return jsonError(415, "tool-denied", `Unsupported media type: ${audio.type}`);
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return jsonError(
      413,
      "tool-denied",
      `Audio exceeds ${MAX_AUDIO_BYTES} bytes (${audio.size} received)`,
    );
  }

  // Optional fields.
  const threadIdRaw = formData.get("threadId");
  const threadId = typeof threadIdRaw === "string" && threadIdRaw.length > 0 ? threadIdRaw : undefined;

  const channelBindingIdRaw = formData.get("channelBindingId");
  const channelBindingId =
    typeof channelBindingIdRaw === "string" && channelBindingIdRaw.length > 0
      ? channelBindingIdRaw
      : undefined;

  const languageRaw = formData.get("language");
  const language = typeof languageRaw === "string" && languageRaw.length > 0 ? languageRaw : undefined;

  const tierHintRaw = formData.get("tierHint");
  const tierHint: TierHint | undefined =
    typeof tierHintRaw === "string" && VALID_TIERS.includes(tierHintRaw as TierHint)
      ? (tierHintRaw as TierHint)
      : undefined;

  // biasPrompt is reserved for Slice 2 (vocabulary builder). Accept it as an
  // optional JSON string for forward-compat; ignore parse errors silently.
  let biasPrompt: BiasClassificationToken[] | undefined;
  const biasPromptRaw = formData.get("biasPrompt");
  if (typeof biasPromptRaw === "string" && biasPromptRaw.length > 0) {
    try {
      const parsed = JSON.parse(biasPromptRaw);
      if (Array.isArray(parsed)) biasPrompt = parsed as BiasClassificationToken[];
    } catch (_e) {
      // Bias is advisory; bad JSON is non-fatal.
    }
  }

  // ── 2. Build TranscribeInput + dispatch ───────────────────────────────────
  let audioBase64: string;
  try {
    audioBase64 = await blobToBase64(audio);
  } catch (_e) {
    return jsonError(400, "tool-denied", "Could not read audio payload");
  }

  // Resolve org id server-side from the install. NEVER trust a
  // client-supplied org id — that's a confused-deputy invitation.
  const organizationId = (await resolveOrgId()) ?? undefined;

  const input: TranscribeInput = {
    audioBase64,
    mimeType: audio.type,
    context: context as TranscribeContext,
    threadId,
    channelBindingId,
    language,
    tierHint,
    biasPrompt,
    organizationId,
  };

  try {
    const result = await transcribe(input);

    // ── 3. Project to spec §6.5 response shape (+ Slice 2 cleanup fields) ──
    return NextResponse.json({
      text: result.text,
      rawText: result.rawText,
      confidence: result.confidence,
      confidenceSource: result.confidenceSource,
      language: result.language,
      durationMs: result.durationMs,
      provider: result.provider,
      model: result.model,
      biasUsed: result.biasUsed,
      biasRedacted: result.biasRedacted,
      cleanupApplied: result.cleanupApplied ?? false,
      cleanupInjectionSuspected: result.cleanupInjectionSuspected ?? false,
      cleanupLevenshteinRatio: result.cleanupLevenshteinRatio ?? 0,
    });
  } catch (e) {
    // ── 4. Error mapping per spec §7.2 ─────────────────────────────────────
    if (e instanceof NoTranscriptionEndpointError) {
      // Per the never-ask-user-to-run-commands kernel commandment, the
      // operator-facing copy must NOT name shell. The admin guides the fix
      // through Platform Tools > Communications > Speech-to-text.
      return jsonError(
        503,
        "tool-error",
        "Speech-to-text isn't ready yet. An admin can enable it in Platform Tools > Communications > Speech-to-text.",
      );
    }
    if (e instanceof InferenceError) {
      // Map InferenceError.code to HTTP status.
      const code = e.code;
      if (code === "network") {
        return jsonError(
          503,
          "tool-error",
          "Speech-to-text service is unreachable. An admin can re-check the sidecar in Platform Tools > Communications.",
        );
      }
      if (code === "provider_error") {
        return jsonError(502, "tool-error", `STT provider error: ${e.message}`);
      }
      if (code === "auth") {
        return jsonError(502, "tool-error", `STT provider auth failure: ${e.message}`);
      }
      if (code === "rate_limit" || code === "overloaded") {
        return jsonError(503, "tool-error", `STT provider rate-limited or overloaded`);
      }
      // Fallback for other InferenceError codes.
      return jsonError(502, "tool-error", `STT provider error: ${e.message}`);
    }
    // Unknown error — preserve message for debugging, 500.
    const message = e instanceof Error ? e.message : String(e);
    return jsonError(500, "tool-error", `Transcription failed: ${message}`);
  }
}

// apps/web/lib/routing/transcription-adapter.ts

/**
 * EP-INF-009c: Audio transcription execution adapter.
 *
 * Supports OpenAI-compatible providers:
 *   POST {baseUrl}/v1/audio/transcriptions (multipart/form-data)
 *
 * Models: whisper-1, gpt-4o-transcribe, gpt-4o-mini-transcribe
 */

import type { AdapterRequest, AdapterResult, ExecutionAdapterHandler } from "./adapter-types";
import { InferenceError, classifyHttpError } from "@/lib/ai-inference";
import { registerExecutionAdapter } from "./execution-adapter-registry";

// ── Helpers ─────────────────────────────────────────────────────────────────

interface AudioContentPart {
  type: "audio";
  data: string;      // base64 audio data
  mimeType?: string;  // e.g. "audio/mp3", "audio/wav"
  url?: string;       // alternative: URL to audio file
}

/** Extract audio data from messages. Looks for content parts with type "audio". */
function extractAudioData(request: AdapterRequest): { data: string; mimeType: string } | null {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const msg = request.messages[i]!;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type: string }).type === "audio"
      ) {
        const audioPart = part as AudioContentPart;
        return {
          data: audioPart.data,
          mimeType: audioPart.mimeType ?? "audio/mp3",
        };
      }
    }
  }
  return null;
}

/** Convert base64 string to Blob. */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** Map MIME type to file extension for the form field. */
function mimeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
  };
  return map[mimeType] ?? "mp3";
}

// ── Transcription Adapter ───────────────────────────────────────────────────

export const transcriptionAdapter: ExecutionAdapterHandler = {
  type: "transcription",

  async execute(request: AdapterRequest): Promise<AdapterResult> {
    const { providerId, modelId, plan, provider } = request;
    const { baseUrl, headers } = provider;
    const settings = plan.providerSettings ?? {};

    const audio = extractAudioData(request);
    if (!audio) {
      throw new InferenceError(
        "No audio data found in messages. Transcription requires an audio content part.",
        "provider_error",
        providerId,
      );
    }

    // ── Build multipart form ─────────────────────────────────────────────
    const apiBase = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
    const url = `${apiBase}/audio/transcriptions`;

    const blob = base64ToBlob(audio.data, audio.mimeType);
    const ext = mimeToExtension(audio.mimeType);

    const form = new FormData();
    form.append("file", blob, `audio.${ext}`);
    form.append("model", modelId);
    form.append("response_format", (settings.response_format as string) ?? "json");
    if (settings.language) {
      form.append("language", settings.language as string);
    }
    if (settings.prompt) {
      form.append("prompt", settings.prompt as string);
    }

    // ── Dispatch ──────────────────────────────────────────────────────────
    // Remove Content-Type from headers — fetch sets it with the boundary for FormData
    const fetchHeaders = { ...headers };
    delete fetchHeaders["Content-Type"];
    delete fetchHeaders["content-type"];

    const startMs = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: fetchHeaders,
        body: form,
        signal: AbortSignal.timeout(300_000), // transcription of long audio can take minutes
      });
    } catch (e) {
      throw new InferenceError(
        `Network error calling ${providerId} transcription: ${e instanceof Error ? e.message : String(e)}`,
        "network",
        providerId,
      );
    }
    const inferenceMs = Date.now() - startMs;

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw classifyHttpError(res.status, providerId, errBody, res.headers);
    }

    const data = (await res.json()) as Record<string, unknown>;

    // ── Extract result ───────────────────────────────────────────────────
    // OpenAI response: { text: "transcription..." } or verbose_json with segments
    const text = typeof data.text === "string" ? data.text : "";

    return {
      text,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 }, // audio is per-minute priced
      inferenceMs,
      raw: data,
    };
  },
};

// ── Auto-register at import time ─────────────────────────────────────────────

registerExecutionAdapter(transcriptionAdapter);

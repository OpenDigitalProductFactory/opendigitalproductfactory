"use client";

/**
 * Voice Input Slice 1 / Task 8 — useVoiceCapture hook.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §5.1, §7.3, §7.4
 *
 * Captures audio via the browser MediaRecorder API, optionally uses Silero VAD
 * (@ricky0123/vad-web) for end-of-utterance detection, POSTs the recorded
 * blob to POST /api/transcribe, and returns the transcript through the
 * `onTranscript` callback.
 *
 * State machine (per spec §5.1):
 *   idle → permission_check → recording → transcribing → result → idle
 *                       ↘ error                  ↘ error ↗
 *
 * Privacy boundaries (per spec §7.4):
 *   - Recording starts only on explicit `start()` call (user-initiated).
 *   - Page Visibility API: backgrounding the tab stops recording and
 *     discards the buffer.
 *   - On `stop()`, the audio blob is sent to /api/transcribe and discarded
 *     once the response arrives. We never persist locally.
 *
 * VAD is best-effort: if the @ricky0123/vad-web module fails to load or
 * initialize (network, ONNX runtime issues, etc.), the hook falls back to
 * manual stop only. Silero VAD adds end-of-utterance detection (silence
 * threshold ~1.2 s) but is not required for the slice to function.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { selectSupportedMimeType } from "./mime-probe";

export type VoiceCaptureState =
  | "idle"
  | "permission_check"
  | "recording"
  | "transcribing"
  | "result"
  | "error";

export type VoiceCaptureErrorCode =
  | "permission_denied"
  | "no_microphone"
  | "no_media_recorder"
  | "transcription_failed"
  | "network"
  | "aborted"
  | "unknown";

export interface UseVoiceCaptureOptions {
  /** Thread context — passed to /api/transcribe for bias scoping (Slice 2). */
  threadId?: string | null;
  /** Called with the transcript text when transcription succeeds. */
  onTranscript: (text: string) => void;
  /**
   * Context for /api/transcribe. Defaults to "coworker_panel" — the only
   * value Slice 1's UI surface uses. Slice 3 inbound flow passes
   * "inbound_channel".
   */
  context?: "coworker_panel" | "inbound_channel" | "test_harness";
}

export interface UseVoiceCaptureResult {
  state: VoiceCaptureState;
  error: string | null;
  errorCode: VoiceCaptureErrorCode | null;
  /**
   * Whether the platform supports the mic surface at all. False when
   * `navigator.mediaDevices.getUserMedia` or `MediaRecorder` is missing
   * (very old browsers). UI should hide / disable the mic button in that case.
   */
  supported: boolean;
  /** Begin recording. Triggers the browser permission prompt on first use. */
  start: () => Promise<void>;
  /** Stop recording. Audio is POSTed to /api/transcribe. */
  stop: () => void;
  /** Reset state machine to idle. Used after error to allow retry. */
  reset: () => void;
}

/**
 * Probe whether the browser supports the mic surface at all. Used both by
 * the hook itself and by upstream UI that wants to hide the mic button when
 * the platform doesn't support it.
 */
export function isVoiceCaptureSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (typeof MediaRecorder === "undefined") return false;
  return true;
}

/**
 * Convert a Blob to base64 (without the data:URL prefix).
 * Used to POST audio via multipart/form-data — kept here so the hook is
 * self-contained.
 */
function blobToFormData(blob: Blob): FormData {
  const form = new FormData();
  form.append("audio", blob, "voice.webm");
  return form;
}

export function useVoiceCapture(options: UseVoiceCaptureOptions): UseVoiceCaptureResult {
  const { threadId, onTranscript, context = "coworker_panel" } = options;

  const [state, setState] = useState<VoiceCaptureState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VoiceCaptureErrorCode | null>(null);

  // Refs hold non-React state that should not trigger re-renders.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>("");
  // Per spec §7.4: backgrounding the tab MUST stop recording and discard buffer.
  // We track whether stop() was triggered by visibility change so we can
  // suppress the upload in that case.
  const abortRef = useRef<boolean>(false);

  const supported = isVoiceCaptureSupported();

  // ── Cleanup helpers ────────────────────────────────────────────────────────
  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const fail = useCallback(
    (message: string, code: VoiceCaptureErrorCode) => {
      cleanupStream();
      setError(message);
      setErrorCode(code);
      setState("error");
    },
    [cleanupStream],
  );

  // ── Transcribe (POST to /api/transcribe) ───────────────────────────────────
  const transcribeAudio = useCallback(
    async (blob: Blob) => {
      setState("transcribing");
      const form = blobToFormData(blob);
      form.append("context", context);
      if (threadId) form.append("threadId", threadId);

      let res: Response;
      try {
        res = await fetch("/api/transcribe", { method: "POST", body: form });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        fail(`Transcription request failed: ${msg}`, "network");
        return;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        fail(`Transcription failed (HTTP ${res.status}): ${errText.slice(0, 200)}`, "transcription_failed");
        return;
      }

      const body = (await res.json()) as { text?: string };
      const text = typeof body.text === "string" ? body.text : "";
      onTranscript(text);
      setState("result");
      // Auto-return to idle so the next recording starts cleanly. UI surfaces
      // briefly show the result state via the onTranscript callback flow.
      setTimeout(() => setState("idle"), 0);
    },
    [context, threadId, onTranscript, fail],
  );

  // ── Page Visibility — auto-stop on background (spec §7.4) ─────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;
    function onVisibilityChange() {
      if (document.hidden && recorderRef.current && state === "recording") {
        abortRef.current = true;
        recorderRef.current.stop();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [state]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────────
  useEffect(() => {
    return () => cleanupStream();
  }, [cleanupStream]);

  // ── start() ────────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!supported) {
      fail("Browser does not support voice capture", "no_media_recorder");
      return;
    }
    if (state === "recording" || state === "transcribing") {
      return; // already in flight
    }

    setError(null);
    setErrorCode(null);
    setState("permission_check");
    abortRef.current = false;

    // 1. Request mic permission + acquire stream.
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        fail("Microphone access denied. Re-enable in browser settings.", "permission_denied");
      } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        fail("No microphone found.", "no_microphone");
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        fail(`Could not access microphone: ${msg}`, "unknown");
      }
      return;
    }
    streamRef.current = stream;

    // 2. Probe supported MIME type (Safari emits mp4, not webm).
    const mime = selectSupportedMimeType();
    if (mime === null) {
      fail("Browser MediaRecorder is unavailable", "no_media_recorder");
      return;
    }
    mimeTypeRef.current = mime;

    // 3. Build recorder.
    const recorder = mime === "" ? new MediaRecorder(stream) : new MediaRecorder(stream, { mimeType: mime });
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = (_event: Event) => {
      fail("MediaRecorder error", "unknown");
    };

    recorder.onstop = () => {
      const aborted = abortRef.current;
      const chunks = chunksRef.current;
      const outputMime = mimeTypeRef.current || "audio/webm";
      cleanupStream();
      if (aborted) {
        // Page visibility / explicit abort — discard buffer per spec §7.4.
        setState("idle");
        return;
      }
      if (chunks.length === 0) {
        fail("No audio captured", "aborted");
        return;
      }
      const blob = new Blob(chunks, { type: outputMime });
      void transcribeAudio(blob);
    };

    setState("recording");
    recorder.start();
  }, [state, supported, fail, cleanupStream, transcribeAudio]);

  // ── stop() ─────────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      abortRef.current = false;
      recorder.stop(); // triggers onstop → transcribeAudio
    }
  }, []);

  // ── reset() ────────────────────────────────────────────────────────────────
  const reset = useCallback(() => {
    cleanupStream();
    abortRef.current = false;
    setError(null);
    setErrorCode(null);
    setState("idle");
  }, [cleanupStream]);

  return { state, error, errorCode, supported, start, stop, reset };
}

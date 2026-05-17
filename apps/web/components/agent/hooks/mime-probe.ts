/**
 * Voice Input Slice 1 / Task 8 — MediaRecorder MIME-type probe.
 *
 * Owning plan: docs/superpowers/plans/2026-05-16-voice-input-slice-1-portal-mic.md
 * Owning spec: docs/superpowers/specs/2026-05-16-voice-input-and-transcription-design.md §7.3
 *
 * Browsers emit different audio containers from MediaRecorder:
 *   - Chrome / Edge / Firefox → "audio/webm;codecs=opus"
 *   - Safari → "audio/mp4" (AAC); webm is NOT supported
 *
 * The client must probe `MediaRecorder.isTypeSupported()` in priority order
 * and select the first supported value rather than hard-coding webm. Server
 * side is unaffected — Whisper (via FFmpeg in speaches and whisper.cpp)
 * accepts virtually any audio container.
 */

/**
 * Priority list per spec §7.3. The first supported MIME is selected.
 * Empty-string sentinel ("") means "let the browser pick its default" and is
 * the final fallback — `new MediaRecorder(stream)` with no options.
 */
export const PREFERRED_MEDIA_RECORDER_MIME_TYPES: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "",
] as const;

/**
 * Probe MediaRecorder.isTypeSupported() for the priority list and return
 * the first supported MIME. The empty-string fallback ("") signals
 * "construct MediaRecorder without explicit mimeType".
 *
 * Returns null when MediaRecorder is unavailable in the current environment
 * (e.g. very old browsers, Node.js test runs without jsdom). Callers should
 * feature-detect upstream and hide the mic button when null is returned.
 *
 * @param mediaRecorder optional override for testing — defaults to global
 *   `MediaRecorder`. Tests can pass a stub with a controllable
 *   `isTypeSupported` implementation.
 */
export function selectSupportedMimeType(
  mediaRecorder?: { isTypeSupported(mime: string): boolean },
): string | null {
  const recorder = mediaRecorder ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : null);
  if (!recorder) return null;

  for (const mime of PREFERRED_MEDIA_RECORDER_MIME_TYPES) {
    if (mime === "") {
      // Sentinel — always "supported" because we'll construct without options.
      return "";
    }
    try {
      if (recorder.isTypeSupported(mime)) return mime;
    } catch (_e) {
      // Some implementations throw on unknown types; keep probing.
    }
  }
  return null;
}

import { describe, expect, it } from "vitest";
import {
  selectSupportedMimeType,
  resolveRecordingBlobMimeType,
  PREFERRED_MEDIA_RECORDER_MIME_TYPES,
} from "./mime-probe";

/**
 * Voice Input Slice 1 / Task 8 — MIME probe tests.
 *
 * Pure-function tests; no jsdom required.
 */

function recorderStub(supported: readonly string[]): { isTypeSupported(m: string): boolean } {
  const set = new Set(supported);
  return { isTypeSupported: (m: string) => set.has(m) };
}

describe("selectSupportedMimeType", () => {
  it("returns 'audio/webm;codecs=opus' when Chrome/Firefox supports it (priority 1)", () => {
    const recorder = recorderStub([
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
    ]);
    expect(selectSupportedMimeType(recorder)).toBe("audio/webm;codecs=opus");
  });

  it("returns 'audio/mp4' on Safari (webm not supported, mp4 is)", () => {
    // Safari per spec §7.3: only audio/mp4 supported.
    const recorder = recorderStub(["audio/mp4"]);
    expect(selectSupportedMimeType(recorder)).toBe("audio/mp4");
  });

  it("falls back to '' (browser default) when nothing in the list is supported", () => {
    const recorder = recorderStub([]);
    // The empty-string sentinel is always 'supported' because we construct
    // MediaRecorder without options.
    expect(selectSupportedMimeType(recorder)).toBe("");
  });

  it("returns null when MediaRecorder is unavailable entirely (no recorder param + no global)", () => {
    // Node default test env has no global MediaRecorder.
    expect(selectSupportedMimeType()).toBeNull();
  });

  it("handles isTypeSupported throwing on unknown MIME types (defense in depth)", () => {
    const recorder = {
      isTypeSupported(mime: string): boolean {
        if (mime.includes("webm")) throw new Error("not implemented");
        if (mime === "audio/mp4") return true;
        return false;
      },
    };
    expect(selectSupportedMimeType(recorder)).toBe("audio/mp4");
  });

  it("priority list matches the spec §7.3 order exactly", () => {
    expect(PREFERRED_MEDIA_RECORDER_MIME_TYPES).toEqual([
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4",
      "",
    ]);
  });

  it("prefers webm-with-codecs over plain webm when both supported", () => {
    const recorder = recorderStub(["audio/webm", "audio/webm;codecs=opus"]);
    // The order in the priority list matters more than insertion order in the stub.
    expect(selectSupportedMimeType(recorder)).toBe("audio/webm;codecs=opus");
  });
});

describe("resolveRecordingBlobMimeType", () => {
  it("prefers the recorder's actual mimeType over the requested one", () => {
    // Safari default path: requested "" sentinel, but the recorder reports mp4.
    expect(resolveRecordingBlobMimeType("audio/mp4", "")).toBe("audio/mp4");
  });

  it("never returns an empty string when both inputs are empty (the playback bug)", () => {
    // The "" sentinel must NOT survive — a Blob tagged type:"" is undecodable.
    expect(resolveRecordingBlobMimeType("", "")).toBe("audio/webm");
  });

  it("falls back to the requested type when the recorder reports nothing", () => {
    expect(resolveRecordingBlobMimeType("", "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(resolveRecordingBlobMimeType(undefined, "audio/mp4")).toBe("audio/mp4");
  });

  it("falls back to audio/webm when neither value is available", () => {
    expect(resolveRecordingBlobMimeType(null, null)).toBe("audio/webm");
    expect(resolveRecordingBlobMimeType(undefined, undefined)).toBe("audio/webm");
  });

  it("treats empty recorder mimeType as absent and uses the requested type", () => {
    expect(resolveRecordingBlobMimeType("", "audio/mp4")).toBe("audio/mp4");
  });
});

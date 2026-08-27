import { describe, expect, it } from "vitest";

import { geminiInputModalities, geminiOutputModalities } from "./gemini-modalities";

// Every id below is present in this install's DiscoveredModel table as of
// 2026-08-27. They are pinned deliberately: the derivation is by model id, so
// the tests have to be about the ids Google actually returns, not invented ones.

describe("geminiOutputModalities (BI-7C957749)", () => {
  it("reports image output for the image models discovery already found", () => {
    for (const id of [
      "gemini-2.5-flash-image",
      "gemini-3.1-flash-image",
      "gemini-3.1-flash-image-preview",
      "gemini-3.1-flash-lite-image",
      "gemini-3-pro-image",
      "gemini-3-pro-image-preview",
      "nano-banana-pro-preview",
    ]) {
      expect(geminiOutputModalities(id), id).toContain("image");
    }
  });

  it("reports image output for the imagen family", () => {
    // Not in this install's catalog, but a published Gemini-API family: an
    // account with it enabled must not have those models filed as text-only.
    expect(geminiOutputModalities("imagen-3.0-generate-002")).toContain("image");
    expect(geminiOutputModalities("imagen-4.0-fast-generate-001")).toContain("image");
  });

  it("reports video output for veo", () => {
    expect(geminiOutputModalities("veo-3.1-generate-preview")).toEqual(["video"]);
    expect(geminiOutputModalities("veo-3.1-fast-generate-preview")).toEqual(["video"]);
    expect(geminiOutputModalities("veo-3.1-lite-generate-preview")).toEqual(["video"]);
  });

  it("keeps ordinary text models text-only", () => {
    for (const id of [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-3.5-flash",
      "gemini-3.7-flash",
      "gemini-flash-latest",
      "gemini-pro-latest",
      "gemini-2.5-computer-use-preview-10-2025",
      "gemini-robotics-er-2-preview",
    ]) {
      expect(geminiOutputModalities(id), id).toEqual(["text"]);
    }
  });

  it("reports embeddings, and never text, for the embedding family", () => {
    for (const id of ["gemini-embedding-001", "gemini-embedding-2", "gemini-embedding-2-preview"]) {
      expect(geminiOutputModalities(id), id).toEqual(["embeddings"]);
    }
  });

  it("reports audio output for tts and native-audio", () => {
    expect(geminiOutputModalities("gemini-2.5-flash-preview-tts")).toContain("audio");
    expect(geminiOutputModalities("gemini-3.1-flash-tts-preview")).toContain("audio");
    expect(geminiOutputModalities("gemini-2.5-flash-native-audio-latest")).toContain("audio");
  });

  it("does NOT call a transcriber an audio generator", () => {
    // gemini-3.5-transcribe takes audio IN and returns text. Advertising it as
    // speech output would route text-to-speech work to a speech-to-text model.
    expect(geminiOutputModalities("gemini-3.5-transcribe")).toEqual(["text"]);
    expect(geminiOutputModalities("gemini-3.5-transcribe-live")).toEqual(["text"]);
  });

  it("keeps text alongside image so an image model is still a usable text model", () => {
    expect(geminiOutputModalities("gemini-3-pro-image")).toEqual(["text", "image"]);
  });

  it("is case-insensitive, since ids arrive from an external catalog", () => {
    expect(geminiOutputModalities("VEO-3.1-GENERATE-PREVIEW")).toEqual(["video"]);
    expect(geminiOutputModalities("Nano-Banana-Pro-Preview")).toContain("image");
  });

  it("does not mistake a lite text model for an image model", () => {
    // "gemini-3.1-flash-lite" must not match on a stray substring while
    // "gemini-3.1-flash-lite-image" must.
    expect(geminiOutputModalities("gemini-3.1-flash-lite")).toEqual(["text"]);
    expect(geminiOutputModalities("gemini-3.1-flash-lite-image")).toContain("image");
  });
});

describe("geminiInputModalities (BI-7C957749)", () => {
  it("always accepts text", () => {
    for (const id of ["gemini-2.5-flash", "veo-3.1-generate-preview", "gemini-3-pro-image"]) {
      expect(geminiInputModalities(id), id).toContain("text");
    }
  });

  it("accepts an image for the image-editing models", () => {
    expect(geminiInputModalities("gemini-3-pro-image")).toContain("image");
    expect(geminiInputModalities("nano-banana-pro-preview")).toContain("image");
  });

  it("accepts audio for transcription and the live/native-audio family", () => {
    expect(geminiInputModalities("gemini-3.5-transcribe")).toContain("audio");
    expect(geminiInputModalities("gemini-2.5-flash-native-audio-latest")).toContain("audio");
    expect(geminiInputModalities("gemini-3.1-flash-live-preview")).toContain("audio");
  });

  it("claims nothing beyond text for embeddings or plain text models", () => {
    expect(geminiInputModalities("gemini-embedding-001")).toEqual(["text"]);
    expect(geminiInputModalities("gemini-2.5-pro")).toEqual(["text"]);
  });
});

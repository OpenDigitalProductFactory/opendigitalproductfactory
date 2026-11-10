import { describe, expect, it } from "vitest";
import { classifyModel, supportsTextGeneration } from "./model-classifier";

describe("supportsTextGeneration", () => {
  it.each(["embedding", "image_gen", "speech", "audio", "moderation", "video"])(
    "rejects %s even when stale output metadata says text", (modelClass) => {
      expect(supportsTextGeneration({ modelClass, outputModalities: ["text"] })).toBe(false);
    },
  );
  it("rejects an embedding output even when stale classification says chat", () => {
    expect(supportsTextGeneration({ modelClass: "chat", outputModalities: ["embeddings"] })).toBe(false);
  });
  it.each(["chat", "reasoning", "code"])("allows generated text from %s", (modelClass) => {
    expect(supportsTextGeneration({ modelClass, outputModalities: ["text", "image"] })).toBe(true);
  });
  it("preserves legacy text profiles but refuses malformed explicit modalities", () => {
    expect(supportsTextGeneration({})).toBe(true);
    expect(supportsTextGeneration({ outputModalities: {} })).toBe(false);
  });
});

describe("classifyModel", () => {
  // Modality-based classification
  it("classifies embedding-only output as embedding", () => {
    expect(classifyModel("text-embedding-3-small", {
      input: ["text"], output: ["embeddings"],
    })).toBe("embedding");
  });

  it("classifies image-only output as image_gen", () => {
    expect(classifyModel("dall-e-3", {
      input: ["text"], output: ["image"],
    })).toBe("image_gen");
  });

  it("classifies audio-only output as speech", () => {
    expect(classifyModel("tts-1", {
      input: ["text"], output: ["audio"],
    })).toBe("speech");
  });

  it("classifies video output as video", () => {
    expect(classifyModel("sora-2", {
      input: ["text"], output: ["video"],
    })).toBe("video");
  });

  // ID-based fallbacks
  it("classifies o1-* as reasoning from ID", () => {
    expect(classifyModel("o1-preview", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies o3-mini as reasoning from ID", () => {
    expect(classifyModel("o3-mini", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies o4-mini as reasoning from ID", () => {
    expect(classifyModel("o4-mini", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies deepseek-r1 as reasoning from ID", () => {
    expect(classifyModel("deepseek-r1", {
      input: ["text"], output: ["text"],
    })).toBe("reasoning");
  });

  it("classifies text-embedding-* as embedding from ID", () => {
    expect(classifyModel("text-embedding-ada-002", {
      input: ["text"], output: ["text"],
    })).toBe("embedding");
  });

  it("classifies dall-e-* as image_gen from ID", () => {
    expect(classifyModel("dall-e-2", {
      input: ["text"], output: ["text"],
    })).toBe("image_gen");
  });

  it("classifies tts-* as speech from ID", () => {
    expect(classifyModel("tts-1-hd", {
      input: ["text"], output: ["text"],
    })).toBe("speech");
  });

  it("classifies whisper-* as audio from ID", () => {
    expect(classifyModel("whisper-1", {
      input: ["text"], output: ["text"],
    })).toBe("audio");
  });

  it("classifies omni-moderation-* as moderation from ID", () => {
    expect(classifyModel("omni-moderation-latest", {
      input: ["text"], output: ["text"],
    })).toBe("moderation");
  });

  it("classifies codex-* as code from ID", () => {
    expect(classifyModel("codex-mini-latest", {
      input: ["text"], output: ["text"],
    })).toBe("code");
  });

  // Default to chat
  it("defaults to chat for standard text models", () => {
    expect(classifyModel("gpt-4o", {
      input: ["text"], output: ["text"],
    })).toBe("chat");
  });

  it("defaults to chat for claude models", () => {
    expect(classifyModel("claude-opus-4-6", {
      input: ["text"], output: ["text"],
    })).toBe("chat");
  });

  it("defaults to chat for multimodal text+image input", () => {
    expect(classifyModel("gpt-4o", {
      input: ["text", "image"], output: ["text"],
    })).toBe("chat");
  });
});

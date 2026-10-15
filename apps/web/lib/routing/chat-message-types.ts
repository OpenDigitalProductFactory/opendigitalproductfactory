// Inference message contract types: the chat message shape every caller of
// the inference layer (lib/inference/ai-inference.ts), every execution adapter
// under lib/routing and every agent loop builds and reads (ChatMessage,
// ContentBlock, ToolCallEntry).
//
// It sits under lib/routing because routing is the innermost application
// context (scripts/application-boundaries.json): inference, tak, build and
// every outer context may import it, and routing needs no reverse edge.
//
// Types only, and a leaf with no imports. ChatMessage and ContentBlock used to
// live in the inference runtime and ToolCallEntry in the adapter contract,
// which made every caller's `import type` an edge back into apps/web's
// inference/routing import cycle; TypeScript project references need that
// graph acyclic (dependency-diet plan, M11 step 2). The guard
// scripts/check-no-web-import-cycle-growth.mjs ratchets that cycle.

/** Named type for tool call entries (matches InferenceResult.toolCalls shape) */
export type ToolCallEntry = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque native continuation data; never authority to execute a tool. */
  gemini?: { modelId: string; functionCallId?: string; thoughtSignature?: string };
};

/** Anthropic-style content blocks for structured tool-calling messages */
export type ContentBlock =
  | { type: "text"; text: string }
  /**
   * Image input for multimodal models. Carried in OpenAI Chat Completions wire
   * form (`image_url` with a data: URL or http(s) URL); converted to the
   * Anthropic `image` source block by formatMessageForAnthropic. Enables vision
   * models (e.g. local Gemma 4 via Docker Model Runner) to receive screenshots.
   */
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  /**
   * Audio input for multimodal models (ASR / diarization / audio understanding).
   * OpenAI Chat Completions wire form (`input_audio` with base64 data + format).
   * Anthropic has no audio-input block, so this is OpenAI-compatible only —
   * routing sends audio to an audio-capable endpoint via the `audioInput`
   * floor, never to Anthropic.
   *
   * NOTE (2026-09-09, BI-F7E9A541): this block is NOT the path voice input
   * takes. `transcribe()` sets executionAdapter="transcription", which
   * dispatches to transcription-adapter.ts and posts multipart audio to
   * /v1/audio/transcriptions — a different API that the local model runner does
   * not serve (404). A previous note here claimed a local Gemma 4 12B had
   * transcribed a wav through Docker Model Runner on 2026-06-15; that model is
   * no longer installed, and a direct retest returned "audio input is not
   * supported ... you may need to provide the mmproj". Serving transcription
   * from a local chat model needs an audio-capable model WITH a multimodal
   * projector plus a dispatch branch that speaks chat rather than multipart.
   * Do not assume this path works for speech without retesting it.
   */
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentBlock[];
  /** Tool calls the assistant made (present when role=assistant and model called tools) */
  toolCalls?: ToolCallEntry[];
  /** For role=tool messages: which tool call this result responds to */
  toolCallId?: string;
};

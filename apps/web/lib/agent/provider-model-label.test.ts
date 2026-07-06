import { describe, expect, it } from "vitest";
import { providerModelLabel } from "./provider-model-label";

describe("providerModelLabel", () => {
  it("maps anthropic claude-opus to 'Claude · Opus 4.8' with full-id title", () => {
    expect(providerModelLabel("anthropic", "claude-opus-4-8")).toEqual({
      label: "Claude · Opus 4.8",
      title: "anthropic / claude-opus-4-8",
    });
  });

  it("maps claude sonnet with leading version digits", () => {
    // claude-3-5-sonnet — version precedes the family word
    expect(providerModelLabel("anthropic", "claude-3-5-sonnet").label).toBe("Claude · Sonnet 3.5");
  });

  it("labels the bundled local model as 'Local model' and keeps the id on hover", () => {
    expect(providerModelLabel("local", "qwen2.5-coder")).toEqual({
      label: "Local model",
      title: "local / qwen2.5-coder",
    });
  });

  it("treats bundled/dmr/ollama provider ids as local", () => {
    expect(providerModelLabel("bundled", "llama3").label).toBe("Local model");
    expect(providerModelLabel("dmr", "phi-4").label).toBe("Local model");
    expect(providerModelLabel("ollama", "mistral").label).toBe("Local model");
  });

  it("maps openai gpt models to 'OpenAI · GPT-5 Codex'", () => {
    expect(providerModelLabel("openai", "gpt-5-codex")).toEqual({
      label: "OpenAI · GPT-5 Codex",
      title: "openai / gpt-5-codex",
    });
  });

  it("uses 'ChatGPT' as the label when the provider is the ChatGPT subscription", () => {
    expect(providerModelLabel("chatgpt-sub", "gpt-5").label).toBe("ChatGPT · GPT-5");
  });

  it("maps google gemini to 'Gemini · 2.5 Pro'", () => {
    expect(providerModelLabel("google", "gemini-2.5-pro")).toEqual({
      label: "Gemini · 2.5 Pro",
      title: "google / gemini-2.5-pro",
    });
  });

  it("prefers a resolved provider display name for unknown providers", () => {
    expect(providerModelLabel("zai", "glm-5.2", "Z.ai")).toEqual({
      label: "Z.ai · Glm 5.2",
      title: "zai / glm-5.2",
    });
  });

  it("falls back to a titled provider id when no model id is known", () => {
    expect(providerModelLabel("anthropic", null)).toEqual({
      label: "Claude",
      title: "anthropic",
    });
  });

  it("does not stutter provider and model when they collapse to the same word", () => {
    // provider label "Gemini" and a bare "gemini" model should not become "Gemini · Gemini"
    expect(providerModelLabel("google", "gemini").label).toBe("Gemini");
  });

  it("produces a sensible fallback for a fully unknown pair", () => {
    const out = providerModelLabel("someprovider", "some-model-x");
    expect(out.title).toBe("someprovider / some-model-x");
    expect(out.label).toBe("Someprovider · Some Model X");
  });

  it("handles a missing provider id by labeling from the model alone", () => {
    const out = providerModelLabel(null, "gpt-5-codex");
    expect(out.label).toBe("OpenAI · GPT-5 Codex");
    expect(out.title).toBe("gpt-5-codex");
  });

  it("degrades to 'Model' when nothing identifiable is present", () => {
    expect(providerModelLabel(null, null)).toEqual({
      label: "Model",
      title: "unknown model",
    });
  });
});

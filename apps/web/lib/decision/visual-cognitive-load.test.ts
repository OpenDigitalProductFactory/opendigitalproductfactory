import { describe, expect, it, vi } from "vitest";
import {
  assessVisualCognitiveLoad,
  parseVisualCognitiveLoad,
  type VisionInferenceFn,
} from "./visual-cognitive-load";
import type { ChatMessage } from "@/lib/ai-inference";

describe("parseVisualCognitiveLoad", () => {
  it("parses a fenced JSON reply and clamps/rounds fields", () => {
    const content =
      '```json\n{"cognitive_load": 0.75, "visual_density": 0.85, "control_count_estimate": 33, "reasoning": "dense grid"}\n```';
    const r = parseVisualCognitiveLoad(content, "local", "ai/gemma4:12B");
    expect(r).toEqual({
      cognitiveLoad: 0.75,
      visualDensity: 0.85,
      controlCountEstimate: 33,
      reasoning: "dense grid",
      providerId: "local",
      modelId: "ai/gemma4:12B",
    });
  });

  it("clamps out-of-range scores and rounds a fractional control count", () => {
    const r = parseVisualCognitiveLoad(
      '{"cognitive_load": 1.4, "visual_density": -0.2, "control_count_estimate": 2.6, "reasoning": "x"}',
      "local",
      "m",
    );
    expect(r?.cognitiveLoad).toBe(1);
    expect(r?.visualDensity).toBe(0);
    expect(r?.controlCountEstimate).toBe(3);
  });

  it("returns null when there is no JSON object", () => {
    expect(parseVisualCognitiveLoad("I cannot assess this.", "local", "m")).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseVisualCognitiveLoad("{ cognitive_load: }", "local", "m")).toBeNull();
  });
});

describe("assessVisualCognitiveLoad", () => {
  it("sends a text + image_url multimodal message and returns the parsed score", async () => {
    let seen: ChatMessage[] | null = null;
    const infer: VisionInferenceFn = vi.fn(async (messages) => {
      seen = messages;
      return {
        content: '{"cognitive_load":0.1,"visual_density":0.1,"control_count_estimate":2,"reasoning":"clean"}',
        providerId: "local",
        modelId: "ai/gemma4:12B",
      };
    });
    const r = await assessVisualCognitiveLoad("data:image/png;base64,AAAB", { inferenceFn: infer });
    expect(r?.cognitiveLoad).toBe(0.1);
    expect(r?.controlCountEstimate).toBe(2);
    // The message must carry the OpenAI vision wire shape (text + image_url).
    const content = seen![0]!.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(content.map((b) => b.type)).toEqual(["text", "image_url"]);
    expect(content[1]!.image_url!.url).toBe("data:image/png;base64,AAAB");
  });

  it("wraps a bare base64 string as a png data URL", async () => {
    let url = "";
    const infer: VisionInferenceFn = async (messages) => {
      const content = messages[0]!.content as Array<{ type: string; image_url?: { url: string } }>;
      url = content[1]!.image_url!.url;
      return { content: '{"cognitive_load":0.5,"visual_density":0.5,"control_count_estimate":5,"reasoning":"x"}', providerId: "local", modelId: "m" };
    };
    await assessVisualCognitiveLoad("BBBB", { inferenceFn: infer });
    expect(url).toBe("data:image/png;base64,BBBB");
  });

  it("returns null (graceful) when no vision endpoint is available", async () => {
    const infer: VisionInferenceFn = async () => {
      throw new Error("NoEligibleEndpointsError: imageInput");
    };
    expect(await assessVisualCognitiveLoad("AAAB", { inferenceFn: infer })).toBeNull();
  });

  it("returns null for empty input without calling inference", async () => {
    const infer = vi.fn();
    expect(await assessVisualCognitiveLoad("", { inferenceFn: infer as unknown as VisionInferenceFn })).toBeNull();
    expect(infer).not.toHaveBeenCalled();
  });
});

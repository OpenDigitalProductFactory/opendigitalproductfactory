import { describe, expect, it } from "vitest";
import {
  parseHostMemory,
  computeServedContextCeiling,
  isLocalServedContextEligibleForReasoning,
  REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS,
  RECOMMENDED_BUILD_CONTEXT_TOKENS,
  MAX_LOCAL_CONTEXT_TOKENS,
} from "./local-model-policy";

describe("parseHostMemory (both installer shapes) — BI-3E614946", () => {
  it("parses the Windows/flat host_profile shape (gpuVramGB/ramGB, no architecture)", () => {
    const out = parseHostMemory({
      ramGB: 63.7,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuVramGB: 24,
      selectedModel: "ai/qwen3-coder",
    });
    expect(out).toEqual({
      host: { architecture: "discrete", vramGb: 24, totalRamGb: 63.7 },
      selectedModel: "ai/qwen3-coder",
    });
  });

  it("parses the macOS/Linux nested shape (architecture/gpu.vramGB/ram.totalGB)", () => {
    const out = parseHostMemory({
      architecture: "unified",
      ram: { totalGB: 128 },
      gpu: { name: "Apple M3 Max GPU (unified)", vramGB: null },
      selectedModel: "ai/qwen3-coder-next",
    });
    expect(out).toEqual({
      host: { architecture: "unified", vramGb: null, totalRamGb: 128 },
      selectedModel: "ai/qwen3-coder-next",
    });
  });

  it("infers discrete when a positive VRAM is present but no architecture field", () => {
    expect(parseHostMemory({ gpuVramGB: 12, ramGB: 32 })?.host).toEqual({
      architecture: "discrete",
      vramGb: 12,
      totalRamGb: 32,
    });
  });

  it("infers cpu when no VRAM and no architecture (conservative)", () => {
    expect(parseHostMemory({ ramGB: 16 })?.host.architecture).toBe("cpu");
  });

  it("maps the installer 'cpu-only' architecture label to 'cpu'", () => {
    expect(parseHostMemory({ architecture: "cpu-only", ram: { totalGB: 16 } })?.host.architecture).toBe("cpu");
  });

  it("returns null for junk / missing profiles", () => {
    expect(parseHostMemory(null)).toBeNull();
    expect(parseHostMemory("nope")).toBeNull();
    expect(parseHostMemory({})).toBeNull();
  });
});

describe("computeServedContextCeiling — BI-3E614946", () => {
  it("caps at what a 24 GB card running the 30B coder can actually serve (~build floor)", () => {
    // 24 - 16 (weights) - 5 (headroom) = 3 GB KV ≈ 24,576 tokens.
    const ceiling = computeServedContextCeiling(
      { architecture: "discrete", vramGb: 24 },
      "ai/qwen3-coder",
    );
    expect(ceiling).toBe(RECOMMENDED_BUILD_CONTEXT_TOKENS);
  });

  it("rises far above the reasoning envelope on a smaller model that leaves more KV room", () => {
    // 24 - 6 (8B weights) - 5 = 13 GB KV ≈ 130k → 8k-rounded to 122,880.
    const ceiling = computeServedContextCeiling(
      { architecture: "discrete", vramGb: 24 },
      "ai/qwen3:8B-Q4_K_M",
    );
    expect(ceiling).toBe(122_880);
    expect(ceiling).toBeLessThanOrEqual(MAX_LOCAL_CONTEXT_TOKENS);
    // The whole point: a smaller model makes local ELIGIBLE for reasoning phases.
    expect(isLocalServedContextEligibleForReasoning(ceiling)).toBe(true);
  });

  it("trusts the operator (MAX) when the host memory is unknown", () => {
    expect(computeServedContextCeiling(null, "ai/qwen3-coder")).toBe(MAX_LOCAL_CONTEXT_TOKENS);
  });
});

describe("isLocalServedContextEligibleForReasoning — BI-3E614946", () => {
  it("is false below the reasoning-phase envelope (the SPOF flag)", () => {
    expect(isLocalServedContextEligibleForReasoning(RECOMMENDED_BUILD_CONTEXT_TOKENS)).toBe(false);
    expect(isLocalServedContextEligibleForReasoning(REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS - 1)).toBe(false);
    expect(isLocalServedContextEligibleForReasoning(null)).toBe(false);
  });

  it("is true at/above the envelope", () => {
    expect(isLocalServedContextEligibleForReasoning(REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS)).toBe(true);
    expect(isLocalServedContextEligibleForReasoning(MAX_LOCAL_CONTEXT_TOKENS)).toBe(true);
  });

  it("covers the observed live overflow (request 29,362 exceeded 24,576)", () => {
    expect(REASONING_PHASE_CONTEXT_ENVELOPE_TOKENS).toBeGreaterThanOrEqual(29_362);
  });
});

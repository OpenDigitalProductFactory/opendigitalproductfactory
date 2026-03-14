import { describe, it, expect } from "vitest";
import { estimateMaxParameters } from "./ollama";

describe("estimateMaxParameters", () => {
  it("returns null for null VRAM", () => {
    expect(estimateMaxParameters(null)).toBeNull();
  });

  it("returns ~1B for very low VRAM", () => {
    expect(estimateMaxParameters(0.5)).toBe("~1B");
  });

  it("estimates ~6B for 8GB VRAM", () => {
    const result = estimateMaxParameters(8);
    expect(result).toBe("~6B");
  });

  it("estimates ~20B for 24GB VRAM", () => {
    const result = estimateMaxParameters(24);
    expect(result).toBe("~20B");
  });

  it("estimates ~40B for 48GB VRAM", () => {
    const result = estimateMaxParameters(48);
    expect(result).toBe("~40B");
  });
});

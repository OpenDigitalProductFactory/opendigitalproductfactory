import { describe, it, expect, vi } from "vitest";
import { extractBrandDesignSystem } from "./index";
import type { ExtractionInput, ProgressEmitter } from "./types";

const noopEmit: ProgressEmitter = async () => {};

function makeInput(overrides: Partial<ExtractionInput> = {}): ExtractionInput {
  return {
    organizationId: "org-1",
    taskRunId: "run-1",
    userId: "user-1",
    threadId: null,
    sources: {},
    ...overrides,
  };
}

describe("extractBrandDesignSystem (skeleton)", () => {
  it("returns a minimal valid BrandDesignSystem when no sources are provided", async () => {
    const result = await extractBrandDesignSystem(makeInput(), noopEmit);

    expect(result.designSystem.version).toBe("1.0.0");
    expect(result.designSystem.confidence.overall).toBe(0);
    expect(result.designSystem.gaps).toContain("no sources provided");
    expect(result.sourcesUsed).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits no progress events when no sources are provided", async () => {
    const emit: ProgressEmitter = vi.fn(async () => {});
    await extractBrandDesignSystem(makeInput(), emit);
    expect(emit).not.toHaveBeenCalled();
  });
});

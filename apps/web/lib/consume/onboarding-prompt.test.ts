import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { resolveLocalModelLabel, buildOnboardingPrompt } from "./onboarding-prompt";
import type { SetupContext, SetupStep, StepStatus } from "../actions/setup-constants";

const mockProvider = prisma.modelProvider as unknown as {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockProvider.findFirst.mockReset();
  mockProvider.findMany.mockReset();
  mockProvider.findMany.mockResolvedValue([]); // no pricing rows by default
});

describe("resolveLocalModelLabel", () => {
  it("returns the general conversational family, title-cased, skipping coder/embed", async () => {
    mockProvider.findFirst.mockResolvedValue({
      families: ["qwen3", "qwen2.5-coder", "gemma4", "mistral", "nomic-embed"],
      enabledFamilies: [],
    });
    expect(await resolveLocalModelLabel()).toBe("Qwen3");
  });

  it("prefers enabledFamilies over the full catalog when set", async () => {
    mockProvider.findFirst.mockResolvedValue({
      families: ["qwen3", "gemma4"],
      enabledFamilies: ["gemma4"],
    });
    expect(await resolveLocalModelLabel()).toBe("Gemma4");
  });

  it("falls back past coder/embed-only pools to the first available family", async () => {
    mockProvider.findFirst.mockResolvedValue({
      families: ["qwen2.5-coder", "nomic-embed"],
      enabledFamilies: [],
    });
    expect(await resolveLocalModelLabel()).toBe("Qwen2.5-coder");
  });

  it("returns null when no local provider is configured", async () => {
    mockProvider.findFirst.mockResolvedValue(null);
    expect(await resolveLocalModelLabel()).toBeNull();
  });

  it("returns null when the local provider has no families", async () => {
    mockProvider.findFirst.mockResolvedValue({ families: [], enabledFamilies: [] });
    expect(await resolveLocalModelLabel()).toBeNull();
  });
});

describe("buildOnboardingPrompt — local model honesty (BI-0CED314D)", () => {
  const steps = {} as Record<string, StepStatus>;
  const context = { industry: null, hasCloudProvider: false } as unknown as SetupContext;

  it("names the actual local model and never hardcodes Ollama/Gemma", async () => {
    mockProvider.findFirst.mockResolvedValue({
      families: ["qwen3", "qwen2.5-coder"],
      enabledFamilies: [],
    });
    const prompt = await buildOnboardingPrompt("welcome" as SetupStep, steps, context);
    expect(prompt).toContain("small local AI model (Qwen3)");
    expect(prompt).not.toMatch(/Ollama/i);
    expect(prompt).not.toMatch(/\(Gemma\)/i);
  });

  it("uses a generic phrase when no local model is configured", async () => {
    mockProvider.findFirst.mockResolvedValue(null);
    const prompt = await buildOnboardingPrompt("welcome" as SetupStep, steps, context);
    expect(prompt).toContain("small local AI model on the user's own hardware");
    expect(prompt).not.toMatch(/Ollama/i);
  });
});

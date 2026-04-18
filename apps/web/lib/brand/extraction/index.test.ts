import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ExtractionInput, ExtractionProgress, ProgressEmitter } from "./types";

const mocks = vi.hoisted(() => ({
  urlAdapter: vi.fn(),
  codebaseAdapter: vi.fn(),
  uploadAdapter: vi.fn(),
  synthesize: vi.fn(),
}));

vi.mock("./url-adapter", () => ({ urlAdapter: mocks.urlAdapter }));
vi.mock("./codebase-adapter", () => ({ codebaseAdapter: mocks.codebaseAdapter }));
vi.mock("./upload-adapter", () => ({ uploadAdapter: mocks.uploadAdapter }));
vi.mock("./synthesize", () => ({ synthesize: mocks.synthesize }));

import { extractBrandDesignSystem } from "./index";

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

describe("extractBrandDesignSystem", () => {
  beforeEach(() => {
    mocks.urlAdapter.mockReset();
    mocks.codebaseAdapter.mockReset();
    mocks.uploadAdapter.mockReset();
    mocks.synthesize.mockReset();
    mocks.synthesize.mockImplementation(async (s) => s);
  });

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

  it("calls URL adapter when a URL source is supplied and emits scraping stage", async () => {
    mocks.urlAdapter.mockResolvedValue({
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      identity: {
        name: "Acme",
        tagline: null,
        description: null,
        logo: { darkBg: null, lightBg: null, mark: null },
        voice: { tone: "neutral", sampleCopy: [] },
      },
      confidence: { overall: 0.5, perField: { "identity.name": 0.7 } },
      gaps: [],
    });

    const emittedStages: ExtractionProgress["stage"][] = [];
    const emit: ProgressEmitter = async (p) => { emittedStages.push(p.stage); };

    const result = await extractBrandDesignSystem(
      makeInput({ sources: { url: "https://example.com" } }),
      emit,
    );

    expect(mocks.urlAdapter).toHaveBeenCalledWith("https://example.com");
    expect(result.designSystem.identity.name).toBe("Acme");
    expect(emittedStages).toContain("scraping");
    expect(emittedStages).toContain("merging");
    expect(emittedStages).toContain("writing");
  });

  it("runs URL + codebase + uploads in parallel and merges all results", async () => {
    mocks.urlAdapter.mockResolvedValue({
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      identity: {
        name: "Acme",
        tagline: null,
        description: null,
        logo: { darkBg: null, lightBg: null, mark: null },
        voice: { tone: "neutral", sampleCopy: [] },
      },
      confidence: { overall: 0.5, perField: { "identity.name": 0.7 } },
      gaps: [],
    });
    mocks.codebaseAdapter.mockResolvedValue({
      sources: [{ kind: "codebase", ref: "/tmp/fake", capturedAt: "t" }],
      palette: {
        primary: "#336699",
        secondary: null,
        accents: [],
        semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
        neutrals: {
          50: "#fff", 100: "#f9f9f9", 200: "#eee", 300: "#ddd", 400: "#bbb",
          500: "#888", 600: "#666", 700: "#444", 800: "#222", 900: "#111", 950: "#000",
        },
        surfaces: {
          background: "#fff", foreground: "#000", muted: "#f5f5f5", card: "#fff", border: "#e5e5e5",
        },
      },
      confidence: { overall: 0.5, perField: { "palette.primary": 0.8 } },
      gaps: [],
    });
    mocks.uploadAdapter.mockResolvedValue({
      sources: [{ kind: "upload", ref: "logo.png", capturedAt: "t" }],
      confidence: { overall: 0.3, perField: {} },
      gaps: [],
    });

    const emit: ProgressEmitter = vi.fn(async () => {});
    const result = await extractBrandDesignSystem(
      makeInput({
        sources: {
          url: "https://example.com",
          codebasePath: "/tmp/fake",
          uploads: [{ name: "logo.png", mimeType: "image/png", data: Buffer.from([]) }],
        },
      }),
      emit,
    );

    expect(mocks.urlAdapter).toHaveBeenCalled();
    expect(mocks.codebaseAdapter).toHaveBeenCalled();
    expect(mocks.uploadAdapter).toHaveBeenCalled();
    expect(result.designSystem.identity.name).toBe("Acme");
    expect(result.designSystem.palette.primary).toBe("#336699");
    expect(result.sourcesUsed.length).toBe(3);
  });

  it("runs synthesize when the merged system has gaps", async () => {
    mocks.urlAdapter.mockResolvedValue({
      sources: [{ kind: "url", ref: "https://example.com", capturedAt: "t" }],
      confidence: { overall: 0.3, perField: {} },
      gaps: ["url-no-company-name"],
    });

    await extractBrandDesignSystem(
      makeInput({ sources: { url: "https://example.com" } }),
      noopEmit,
    );

    expect(mocks.synthesize).toHaveBeenCalledOnce();
  });
});

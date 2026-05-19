import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Voice Input Slice 1 / Task 11 — SpeechToTextCard server-component tests.
 *
 * Server components are tested via `renderToStaticMarkup` (the same pattern
 * used by other DPF server components — see communications/page.test.tsx).
 * The client TestHarness sub-component is stubbed at module boundary so the
 * card render is deterministic.
 */

const mocks = vi.hoisted(() => ({
  getSpeechToTextReadiness: vi.fn(),
}));

vi.mock("@/lib/voice/readiness", () => ({
  getSpeechToTextReadiness: mocks.getSpeechToTextReadiness,
}));

// Stub the client component — server-only tests don't exercise it.
vi.mock("./SpeechToTextTestHarness", () => ({
  SpeechToTextTestHarness: ({ readinessIsHealthy }: { readinessIsHealthy: boolean }) =>
    `[TestHarness:healthy=${readinessIsHealthy}]`,
}));

import { SpeechToTextCard } from "./SpeechToTextCard";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderCard(): Promise<string> {
  // Server components return JSX-as-promise; we resolve and stringify.
  const element = await SpeechToTextCard();
  return renderToStaticMarkup(element);
}

describe("SpeechToTextCard — healthy", () => {
  beforeEach(() => {
    mocks.getSpeechToTextReadiness.mockResolvedValue({
      status: "healthy",
      providerId: "speaches",
      providerName: "Local STT (whisper-server)",
      modelId: "base",
      baseUrl: "http://dpf-stt:9000",
      reason: "Local STT (whisper-server) reachable at http://dpf-stt:9000.",
    });
  });

  it("renders the Healthy badge", async () => {
    const html = await renderCard();
    expect(html).toContain("Healthy");
    expect(html).toContain('data-status="healthy"');
  });

  it("renders provider, model, and endpoint metadata", async () => {
    const html = await renderCard();
    expect(html).toContain("Local STT (whisper-server)");
    expect(html).toContain("base");
    expect(html).toContain("http://dpf-stt:9000");
  });

  it("renders the readiness reason", async () => {
    const html = await renderCard();
    expect(html).toMatch(/reachable at http:\/\/dpf-stt:9000/);
  });

  it("passes readinessIsHealthy=true to the test harness", async () => {
    const html = await renderCard();
    expect(html).toContain("[TestHarness:healthy=true]");
  });
});

describe("SpeechToTextCard — unconfigured (fresh install)", () => {
  beforeEach(() => {
    mocks.getSpeechToTextReadiness.mockResolvedValue({
      status: "unconfigured",
      providerId: null,
      providerName: null,
      modelId: null,
      baseUrl: null,
      reason:
        "Speech-to-text isn't configured yet. Click Enable to start the local sidecar, or connect a hosted provider in Platform Tools > Communications.",
    });
  });

  it("renders the 'Not configured' badge", async () => {
    const html = await renderCard();
    expect(html).toContain("Not configured");
    expect(html).toContain('data-status="unconfigured"');
  });

  it("shows em-dashes for missing provider/model/endpoint", async () => {
    const html = await renderCard();
    expect(html.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the actionable reason WITHOUT shell commands (kernel commandment)", async () => {
    const html = await renderCard();
    expect(html).not.toMatch(/docker compose|docker exec|`docker/);
    expect(html).toMatch(/Platform Tools|Enable/i);
  });

  it("passes readinessIsHealthy=false to the test harness", async () => {
    const html = await renderCard();
    expect(html).toContain("[TestHarness:healthy=false]");
  });
});

describe("SpeechToTextCard — unhealthy", () => {
  beforeEach(() => {
    mocks.getSpeechToTextReadiness.mockResolvedValue({
      status: "unhealthy",
      providerId: "speaches",
      providerName: "Local STT (whisper-server)",
      modelId: "base",
      baseUrl: "http://dpf-stt:9000",
      reason: "Transcription endpoint is blocked. Unblock via the routing admin UI before traffic can flow.",
    });
  });

  it("renders the 'Unhealthy' badge", async () => {
    const html = await renderCard();
    expect(html).toContain("Unhealthy");
    expect(html).toContain('data-status="unhealthy"');
  });

  it("still passes readinessIsHealthy=false to the test harness (must not test unhealthy)", async () => {
    const html = await renderCard();
    expect(html).toContain("[TestHarness:healthy=false]");
  });

  it("renders the actionable reason text", async () => {
    const html = await renderCard();
    expect(html).toMatch(/blocked/i);
  });
});

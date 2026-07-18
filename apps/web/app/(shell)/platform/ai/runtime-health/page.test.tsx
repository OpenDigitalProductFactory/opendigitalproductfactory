import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/inference/phase-model-resolution", () => ({
  resolveModelSelectionByPhase: vi.fn().mockResolvedValue({
    verdict: "all-cloud",
    summary: "All phases route to cloud providers.",
    buildEngine: "codex",
    buildEngineLabel: "Codex CLI",
    generatedAt: "2026-06-29T00:00:00.000Z",
    notes: ["Provider routing resolves the model supply."],
    phases: [],
    flags: [],
  }),
}));

vi.mock("@/lib/platform-runtime/service-health-loader", () => ({
  loadCapabilityServiceHealth: vi.fn().mockResolvedValue({
    aggregate: { value: "Operational", tone: "success", detail: "Required services available" },
    items: [{
      key: "speech-to-text",
      kind: "service",
      state: "optional_inactive",
      availability: "inactive",
      label: "Optional — inactive",
      action: "Enable its runtime capability when this service is needed.",
      tone: "neutral",
      healthSemantics: "http",
    }],
  }),
}));

vi.mock("@/lib/queue/queue-snapshot-service", () => ({
  readQueueSnapshots: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/queue/job-engine-health", () => ({
  getJobEngineHealth: vi.fn().mockResolvedValue({
    status: "healthy",
    detail: null,
    checkedAt: null,
    watchdog: {
      status: "healthy",
      lastInvocationAt: null,
      lastRecoveryAttemptAt: null,
      lastRecoverySummary: null,
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: any }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("RuntimeHealthPage", () => {
  it("links operators back to the AI readiness console", async () => {
    const { default: RuntimeHealthPage } = await import("./page");
    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Model Selection &amp; Runtime Health");
    expect(html).toContain("All phases route to cloud providers.");
    expect(html).toContain('href="/platform/ai/readiness"');
    expect(html).toContain("Capability service requirements");
    expect(html).toContain("Optional — inactive");
  });

  it("does not infer service requirements when capability authority is unavailable", async () => {
    const { loadCapabilityServiceHealth } = await import("@/lib/platform-runtime/service-health-loader");
    vi.mocked(loadCapabilityServiceHealth).mockRejectedValueOnce(new Error("install_catalog_stale"));
    const { default: RuntimeHealthPage } = await import("./page");

    const html = renderToStaticMarkup(await RuntimeHealthPage());

    expect(html).toContain("Capability authority is unavailable");
    expect(html).toContain("install_catalog_stale");
    expect(html).not.toContain("Optional — inactive");
  });
});

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
  });
});

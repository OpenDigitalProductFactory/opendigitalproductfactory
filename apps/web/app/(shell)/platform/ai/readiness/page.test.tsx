import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiReadinessSummary } from "@/lib/ai-readiness/readiness-summary";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getAiReadinessSummary: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/ai-readiness/readiness-summary", () => ({
  getAiReadinessSummary: mocks.getAiReadinessSummary,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: any; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const summary: AiReadinessSummary = {
  state: "ready",
  summary: "AI is ready for governed work.",
  generatedAt: "2026-06-29T00:00:00.000Z",
  domains: [
    {
      id: "model-supply",
      label: "Model Supply",
      state: "ready",
      summary: "1 routable of 1 providers.",
      evidence: [{ label: "Routable", value: "1" }],
      diagnosticsHref: "/platform/ai/providers",
    },
    {
      id: "build-execution",
      label: "Build Execution",
      state: "ready",
      summary: "Codex CLI ready for Build Studio work.",
      evidence: [{ label: "Selected engine", value: "Codex CLI" }],
      diagnosticsHref: "/platform/ai/build-studio",
    },
    {
      id: "tool-access",
      label: "Tool Access",
      state: "ready",
      summary: "MCP token ready.",
      evidence: [{ label: "Required grants", value: "4" }],
      diagnosticsHref: "/admin/platform-development",
    },
    {
      id: "routing-confidence",
      label: "Routing Confidence",
      state: "ready",
      summary: "Phase preview passes without flags.",
      evidence: [{ label: "Phase flags", value: "0" }],
      diagnosticsHref: "/platform/ai/runtime-health",
    },
  ],
};

describe("PlatformAiReadinessPage", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.getAiReadinessSummary.mockResolvedValue(summary);
  });

  it("renders the readiness console shell from the read model", async () => {
    const { default: PlatformAiReadinessPage } = await import("./page");
    const html = renderToStaticMarkup(await PlatformAiReadinessPage());

    expect(mocks.getAiReadinessSummary).toHaveBeenCalledWith("user-1");
    expect(html).toContain("AI Readiness");
    expect(html).toContain("AI is ready for governed work.");
    expect(html).toContain("Model Supply");
    expect(html).toContain("Build Execution");
    expect(html).toContain("Tool Access");
    expect(html).toContain("Routing Confidence");
  });
});

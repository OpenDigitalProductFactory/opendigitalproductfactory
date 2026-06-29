import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AiReadinessSummaryPanel } from "./AiReadinessSummaryPanel";
import type { AiReadinessSummary } from "@/lib/ai-readiness/readiness-summary";

const summary: AiReadinessSummary = {
  state: "blocked",
  summary: "AI readiness is blocked by 1 domain.",
  generatedAt: "2026-06-29T00:00:00.000Z",
  domains: [
    {
      id: "model-supply",
      label: "Model Supply",
      state: "ready",
      summary: "2 routable of 3 providers.",
      evidence: [{ label: "Routable", value: "2" }],
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
      state: "blocked",
      summary: "No usable MCP development token is available.",
      evidence: [{ label: "Required grants", value: "4" }],
      blocker: {
        code: "needs_authorization",
        message: "Issue or refresh a governed development token.",
        primaryActionLabel: "Issue development token",
        href: "/admin/platform-development",
      },
      diagnosticsHref: "/admin/platform-development",
    },
    {
      id: "routing-confidence",
      label: "Routing Confidence",
      state: "attention",
      summary: "1 routing warning from phase preview.",
      evidence: [{ label: "Phase flags", value: "1" }],
      diagnosticsHref: "/platform/ai/runtime-health",
    },
  ],
};

describe("AiReadinessSummaryPanel", () => {
  it("renders the overall verdict and four readiness rows", () => {
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={summary} />);

    expect(html).toContain("Blocked");
    expect(html).toContain("AI readiness is blocked by 1 domain.");
    expect(html.match(/data-readiness-domain-row=/g)).toHaveLength(4);
    expect(html).toContain("Model Supply");
    expect(html).toContain("Build Execution");
    expect(html).toContain("Tool Access");
    expect(html).toContain("Routing Confidence");
  });

  it("renders readiness states through text, icon, and report-kit status badges", () => {
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={summary} />);

    expect(html).toContain('aria-label="Blocked status"');
    expect(html).toContain('aria-label="Ready status"');
    expect(html).toContain('data-intent="danger"');
    expect(html).toContain('data-intent="success"');
    expect(html).toContain('data-intent="warning"');
  });

  it("shows one primary action for a blocked domain", () => {
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={summary} />);

    expect(html.match(/data-readiness-primary-action=/g)).toHaveLength(1);
    expect(html).toContain("Issue development token");
  });

  it("links each diagnostics target to the existing AI setup pages", () => {
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={summary} />);

    expect(html).toContain('href="/platform/ai/providers"');
    expect(html).toContain('href="/platform/ai/build-studio"');
    expect(html).toContain('href="/admin/platform-development"');
    expect(html).toContain('href="/platform/ai/runtime-health"');
  });
});

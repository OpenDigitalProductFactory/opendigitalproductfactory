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

  it("does not render a redundant Diagnostics link when it duplicates the primary action (F12)", () => {
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={summary} />);

    // Tool Access blocker.href === diagnosticsHref, so its row shows ONLY the
    // primary action. The three rows whose diagnostics target differs from (or
    // has no) blocker still render the secondary "Diagnostics" link.
    expect(html.match(/>Diagnostics</g)).toHaveLength(3);
  });

  it("renders a single control on a routing-confidence blocker whose diagnostics is the same page", () => {
    const single: AiReadinessSummary = {
      ...summary,
      domains: [
        {
          id: "routing-confidence",
          label: "Routing Confidence",
          state: "blocked",
          summary: "1 routing blocker found in phase preview.",
          evidence: [{ label: "Phase flags", value: "1" }],
          blocker: {
            code: "no-eligible-endpoint",
            message: "A build phase has no eligible AI endpoint.",
            primaryActionLabel: "Open runtime diagnostics",
            href: "/platform/ai/runtime-health",
          },
          diagnosticsHref: "/platform/ai/runtime-health",
        },
      ],
    };
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={single} />);

    expect(html).toContain("Open runtime diagnostics");
    expect(html.match(/>Diagnostics</g)).toBeNull();
    expect(html.match(/href="\/platform\/ai\/runtime-health"/g)).toHaveLength(1);
  });

  it("links each diagnostics target to the existing AI setup pages", () => {
    const html = renderToStaticMarkup(<AiReadinessSummaryPanel summary={summary} />);

    expect(html).toContain('href="/platform/ai/providers"');
    expect(html).toContain('href="/platform/ai/build-studio"');
    expect(html).toContain('href="/admin/platform-development"');
    expect(html).toContain('href="/platform/ai/runtime-health"');
  });
});

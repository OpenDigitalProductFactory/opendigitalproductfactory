import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  prisma: {
    decisionInteraction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { prisma } from "@dpf/db";

describe("FounderReviewPage", () => {
  it("renders unresolved decisions as grouped operator cards without raw traces", async () => {
    vi.mocked(prisma.decisionInteraction.findMany).mockResolvedValue([
      {
        interactionId: "DI-1",
        question: "Should the interface hide raw traces?",
        options: ["Hide by default", "Show raw traces"],
        outcomeType: "defer",
        outcomePayload: {
          unresolvedReason: "principle-gap",
          rawTool: "principle_decide",
          skillId: "dpf-compare-options",
        },
        buildId: "FB-1",
        taskRunId: "TR-1",
        routeContext: "/build",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
      },
    ] as never);

    const { default: FounderReviewPage } = await import("./page");
    const html = renderToStaticMarkup(await FounderReviewPage());

    expect(html).toContain("Founder Review");
    expect(html).toContain("Principle gap");
    expect(html).toContain("Clarify founder principle");
    expect(html).toContain("Should the interface hide raw traces?");
    expect(html).toContain('href="/build?buildId=FB-1"');
    expect(html).toContain('href="/platform/ai/history?taskRunId=TR-1"');
    expect(html).not.toContain("DecisionInteraction");
    expect(html).not.toContain("outcomePayload");
    expect(html).not.toContain("principle_decide");
    expect(html).not.toContain("dpf-compare-options");
    expect(html).not.toContain("mcp");
  });
});

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
        profile: {
          profileId: "profile-mark",
          name: "WWMD Platform",
          kind: "platform",
        },
      },
    ] as never);

    const { default: FounderReviewPage } = await import("./page");
    const html = renderToStaticMarkup(await FounderReviewPage({}));

    expect(html).toContain("Founder Review");
    expect(html).toContain("Principle gap");
    expect(html).toContain("Clarify founder principle");
    expect(html).toContain("Should the interface hide raw traces?");
    expect(html).toContain("WWMD Platform");
    expect(html).toContain('href="/platform/ai/decisions/DI-1"');
    expect(html).toContain('href="/build?buildId=FB-1"');
    expect(html).toContain('href="/platform/ai/history?taskRunId=TR-1"');
    expect(html).toContain("Record outcome");
    expect(html).toContain("WWMD MCP Sprint 1");
    expect(html).not.toContain("DecisionInteraction");
    expect(html).not.toContain("outcomePayload");
    expect(html).not.toContain("principle_decide");
    expect(html).not.toContain("dpf-compare-options");
    expect(html).not.toContain("mcp");
  });

  it("renders owner/operator wording for WWWD review cards", async () => {
    vi.mocked(prisma.decisionInteraction.findMany).mockResolvedValue([
      {
        interactionId: "DI-ORG",
        question: "Should we change the service guarantee?",
        options: ["Change it", "Keep it"],
        outcomeType: "defer",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/storefront",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
        profile: {
          profileId: "profile-org",
          name: "WWWD Organization",
          kind: "organization",
        },
      },
    ] as never);

    const { default: FounderReviewPage } = await import("./page");
    const html = renderToStaticMarkup(
      await FounderReviewPage({
        searchParams: Promise.resolve({ mode: "wwwd" }),
      }),
    );

    expect(html).toContain("Owner/Operator Review");
    expect(html).toContain("WWWD Organization");
    expect(html).toContain("Clarify operating policy");
    expect(html).toContain('href="/platform/ai/decisions/DI-ORG"');
    expect(html).not.toContain("Clarify founder principle");
  });
});

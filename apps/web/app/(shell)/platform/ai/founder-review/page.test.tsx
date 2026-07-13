import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@dpf/db", () => ({
  Prisma: {
    DbNull: "DbNull",
  },
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
        domainClass: "plan-readiness",
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
    expect(html).toContain("Open Needs you");
    expect(html).toContain('href="/workspace/inbox"');
    expect(html).toContain("Where work lives");
    expect(html).toContain("You do not need to patrol every queue");
    expect(html).toContain("My queue");
    expect(html).toContain('href="/workspace/my-queue"');
    expect(html).toContain("Build Studio");
    expect(html).toContain('href="/build"');
    expect(html).toContain("Decision Governance");
    expect(html).toContain('href="/coworker-decisions/review"');
    expect(html).toContain("These cards are created when an AI decision is deferred or escalated");
    expect(html).toContain("Showing 1 distinct review item from 1 unresolved AI decision row");
    expect(html).toContain("Principle gap");
    expect(html).toContain("Clarify founder principle");
    expect(html).toContain("Should the interface hide raw traces?");
    expect(html).toContain("WWMD Platform");
    expect(html).toContain('href="/platform/ai/decisions/DI-1"');
    expect(html).toContain('href="/build?buildId=FB-1"');
    expect(html).toContain('href="/platform/ai/history?taskRunId=TR-1"');
    expect(html).toContain("Review evidence");
    expect(html).not.toContain("Record outcome");
    expect(html).not.toContain("WWMD MCP Sprint 1");
    expect(html).not.toContain("DecisionInteraction");
    expect(html).not.toContain("outcomePayload");
    expect(html).not.toContain("principle_decide");
    expect(html).not.toContain("dpf-compare-options");
    expect(html).not.toContain("mcp");
    expect(prisma.decisionInteraction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcomeType: { in: ["defer", "escalate"] },
          humanOutcome: { equals: "DbNull" },
        }),
        select: expect.objectContaining({
          domainClass: true,
        }),
      }),
    );
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
        domainClass: "risk-assessment",
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

  it("suppresses blank rows and agent-internal kernel consults in the visible lens", async () => {
    vi.mocked(prisma.decisionInteraction.findMany).mockResolvedValue([
      {
        interactionId: "DI-BLANK",
        question: "   ",
        options: [],
        outcomeType: "escalate",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/coworker-business",
        domainClass: "risk-assessment",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
        profile: null,
      },
      {
        interactionId: "DI-KERNEL",
        question: "Should an internal kernel consult show here?",
        options: [],
        outcomeType: "escalate",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "mcp:principle_decide",
        domainClass: "kernel-consult",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
        profile: null,
      },
      {
        interactionId: "DI-REAL",
        question: "Should the owner change the refund policy?",
        options: ["Change", "Keep"],
        outcomeType: "escalate",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/coworker-business",
        domainClass: "risk-assessment",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
        profile: {
          profileId: "profile-org",
          name: "WWWD Organization",
          kind: "organization",
        },
      },
    ] as never);

    const { default: FounderReviewPage } = await import("./page");
    const html = renderToStaticMarkup(await FounderReviewPage({}));

    expect(html).toContain("Should the owner change the refund policy?");
    expect(html).not.toContain("Should an internal kernel consult show here?");
    expect(html).not.toContain("DI-BLANK");
    expect(html).toContain("1 waiting");
  });

  it("deduplicates repeated open reviews with the same question and profile", async () => {
    vi.mocked(prisma.decisionInteraction.findMany).mockResolvedValue([
      {
        interactionId: "DI-DUP-NEW",
        question: "Should we prioritize fixing quality issues?",
        options: ["Yes", "No"],
        outcomeType: "escalate",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/coworker-business",
        domainClass: "risk-assessment",
        createdAt: new Date("2026-05-27T12:00:00.000Z"),
        profile: {
          profileId: "profile-org",
          name: "WWWD Organization",
          kind: "organization",
        },
      },
      {
        interactionId: "DI-DUP-OLD",
        question: "  Should we prioritize fixing quality issues?  ",
        options: ["Yes", "No"],
        outcomeType: "escalate",
        outcomePayload: { unresolvedReason: "principle-gap" },
        buildId: null,
        taskRunId: null,
        routeContext: "/coworker-business",
        domainClass: "risk-assessment",
        createdAt: new Date("2026-05-26T12:00:00.000Z"),
        profile: {
          profileId: "profile-org",
          name: "WWWD Organization",
          kind: "organization",
        },
      },
    ] as never);

    const { default: FounderReviewPage } = await import("./page");
    const html = renderToStaticMarkup(await FounderReviewPage({}));

    expect(html).toContain("Should we prioritize fixing quality issues?");
    expect(html).toContain('href="/platform/ai/decisions/DI-DUP-NEW"');
    expect(html).not.toContain("DI-DUP-OLD");
    expect(html).toContain("1 waiting");
  });
});

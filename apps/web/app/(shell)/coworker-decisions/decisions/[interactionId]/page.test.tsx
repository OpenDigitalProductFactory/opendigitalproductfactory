import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    decisionInteraction: { findUnique: vi.fn(), findMany: vi.fn(async () => []) },
    // The record looks for a drafted resolution and for the work behind the
    // decision; both must answer "nothing" rather than blow up (BI-3D0FB84B).
    decisionResolutionProposal: { findFirst: vi.fn(async () => null) },
    workroom: { findFirst: vi.fn(async () => null) },
    taskRun: { findUnique: vi.fn(async () => null) },
    featureBuild: { findUnique: vi.fn(async () => null) },
    agent: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

import { prisma } from "@dpf/db";

describe("DecisionRecordPage", () => {
  it("retains a context-free audit row without presenting it as resolvable work", async () => {
    vi.mocked(prisma.decisionInteraction.findUnique).mockResolvedValue({
      interactionId: "DI-8BA5F423591B",
      profileId: "mark-dpf-platform",
      buildId: null,
      taskRunId: null,
      routeContext: "mcp:principle_decide",
      domainClass: "kernel-consult",
      question: "",
      options: ["cohesive-then-stop", "drain-to-zero"],
      rationale: "The recommendation conflicted with recorded commandments.",
      riskTier: "high",
      outcomeType: "escalate",
      principleConflict: true,
      outcomePayload: {
        optionDescriptions: {
          "cohesive-then-stop": "",
          "drain-to-zero": "",
        },
        topContributors: [],
      },
      humanOutcome: null,
      createdAt: new Date("2026-07-11T20:36:00.000Z"),
      profile: {
        profileId: "mark-dpf-platform",
        name: "Mark / DPF Platform",
        kind: "platform",
      },
      escalationCapture: null,
      deferralCapture: null,
    } as never);

    const { default: DecisionRecordPage } = await import("./page");
    const html = renderToStaticMarkup(
      await DecisionRecordPage({
        params: Promise.resolve({ interactionId: "DI-8BA5F423591B" }),
      }),
    );

    expect(html).toContain("Incomplete record");
    expect(html).toContain("does not contain enough context to resolve safely");
    expect(html).toContain("excluded from action queues");
    expect(html).not.toContain("De-conflict");
  });
});

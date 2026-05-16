import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/skill-proposal-actions", () => ({
  approveSkillProposalAction: vi.fn(),
  rejectSkillProposalAction: vi.fn(),
  rollbackSkillAction: vi.fn(),
}));

import { SkillProposalsPanel } from "./SkillProposalsPanel";
import type { SkillProposalRow } from "@/lib/skills/proposals";

const baseProposal: SkillProposalRow = {
  proposalId: "IP-SKL-AB12C",
  title: "Tighten build-page intro",
  description: "Replace the rambling intro with two clear sentences.",
  severity: "medium",
  submittedById: "user-1",
  agentId: "AGT-1",
  threadId: "thread-1",
  observedFriction: "Users keep asking what the skill is for.",
  proposedContent: "v1 proposed body",
  status: "proposed",
  reviewedById: null,
  reviewedAt: null,
  rejectionReason: null,
  createdAt: "2026-05-15T17:00:00.000Z",
};

describe("SkillProposalsPanel", () => {
  it("renders an empty state when there are no proposals", () => {
    const html = renderToStaticMarkup(
      <SkillProposalsPanel skillId="build-page" currentContent="v0" proposals={[]} />,
    );
    expect(html).toContain("No proposals filed against");
    expect(html).toContain("build-page");
  });

  it("renders a row per proposal with a Pending badge for proposed status", () => {
    const html = renderToStaticMarkup(
      <SkillProposalsPanel
        skillId="build-page"
        currentContent="v0 body"
        proposals={[baseProposal]}
      />,
    );
    expect(html).toContain(baseProposal.title);
    expect(html).toContain("Pending");
  });

  it("uses only theme tokens — no hardcoded hex colors", () => {
    const html = renderToStaticMarkup(
      <SkillProposalsPanel
        skillId="build-page"
        currentContent="v0"
        proposals={[baseProposal]}
      />,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).toContain("var(--dpf-");
  });

  it("renders a Rejected badge for rejected proposals", () => {
    const rejected: SkillProposalRow = {
      ...baseProposal,
      proposalId: "IP-SKL-REJ",
      status: "rejected",
      rejectionReason: "regression risk",
      reviewedAt: "2026-05-15T18:00:00.000Z",
      reviewedById: "reviewer-1",
    };
    const html = renderToStaticMarkup(
      <SkillProposalsPanel skillId="build-page" currentContent="v0" proposals={[rejected]} />,
    );
    expect(html).toContain("Rejected");
  });
});

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/actions/skill-proposal-actions", () => ({
  approveSkillProposalAction: vi.fn(),
  rejectSkillProposalAction: vi.fn(),
  rollbackSkillAction: vi.fn(),
}));

import { SkillRevisionHistoryPanel } from "./SkillRevisionHistoryPanel";
import type { SkillRevisionRow } from "@/lib/skills/proposals";

describe("SkillRevisionHistoryPanel", () => {
  it("renders an empty state when no revisions exist", () => {
    const html = renderToStaticMarkup(
      <SkillRevisionHistoryPanel skillId="build-page" revisions={[]} />,
    );
    expect(html).toContain("No revisions yet");
  });

  it("renders rows newest-first with version and changeReason", () => {
    const revisions: SkillRevisionRow[] = [
      {
        revisionId: "SREV-B",
        version: 2,
        changeReason: "approved proposal IP-SKL-AB12C",
        changedBy: "reviewer-1",
        proposalId: "IP-SKL-AB12C",
        createdAt: "2026-05-15T18:00:00.000Z",
      },
      {
        revisionId: "SREV-A",
        version: 1,
        changeReason: "pre-approval snapshot",
        changedBy: "reviewer-1",
        proposalId: null,
        createdAt: "2026-05-15T17:55:00.000Z",
      },
    ];
    const html = renderToStaticMarkup(
      <SkillRevisionHistoryPanel skillId="build-page" revisions={revisions} />,
    );
    expect(html).toContain("v2");
    expect(html).toContain("v1");
    expect(html).toContain("approved proposal");
    expect(html).toContain("pre-approval snapshot");
    expect(html).toContain("Roll back here");
  });

  it("uses only theme tokens — no hardcoded hex colors", () => {
    const revisions: SkillRevisionRow[] = [
      {
        revisionId: "SREV-1",
        version: 1,
        changeReason: "snapshot",
        changedBy: "u",
        proposalId: null,
        createdAt: "2026-05-15T17:00:00.000Z",
      },
    ];
    const html = renderToStaticMarkup(
      <SkillRevisionHistoryPanel skillId="build-page" revisions={revisions} />,
    );
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(html).toContain("var(--dpf-");
  });
});

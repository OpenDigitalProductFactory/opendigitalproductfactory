import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkforceRosterPanel } from "./WorkforceRosterPanel";
import type { WorkforceRoster } from "@/lib/workforce/workforce-roster";

const roster: WorkforceRoster = {
  members: [
    {
      kind: "human",
      id: "EMP-1",
      displayName: "Ada Lovelace",
      status: "active",
      role: "Engineer",
      group: "Product",
      agentNeeds: null,
    },
    {
      kind: "agent",
      id: "AGT-COO",
      displayName: "Chief of Staff",
      status: "active",
      role: "evaluate",
      group: "for_employees",
      agentNeeds: {
        valueStream: "evaluate",
        supervisorId: "HR-000",
        humanRoleParity: { roleId: "HR-000", roleName: "Chief Executive Officer" },
        approvalInterfaceOwner: { scope: "role", label: "Chief Executive Officer", roleId: "HR-000" },
        hitlTier: 2,
        lifecycleStage: "production",
        model: "claude-sonnet-4-6",
        dailyTokenLimit: 200000,
        perTaskTokenLimit: 20000,
        toolGrantCount: 5,
        skillCount: 3,
        unmetNeedCount: 2,
        certification: "certified" as const,
        certificationAt: new Date("2026-07-08T04:40:00Z"),
      },
    },
  ],
  summary: { total: 2, humans: 1, agents: 1, agentsWithUnmetNeeds: 1 },
};

describe("WorkforceRosterPanel", () => {
  it("renders both humans and AI agents with the agent-needs lens", () => {
    const html = renderToStaticMarkup(<WorkforceRosterPanel roster={roster} />);

    // both populations present
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("human");
    expect(html).toContain("Chief of Staff");
    expect(html).toContain("AI coworker");

    // agent-needs lens surfaced — incl. human-role parity + approval/interface owner
    expect(html).toContain("role parity");
    expect(html).toContain("approval owner");
    expect(html).toContain("Chief Executive Officer"); // resolved parity/owner role
    expect(html).toContain("(role)"); // broad-owner scope hint
    expect(html).toContain("Reviewed"); // oversight tier, plain language
    expect(html).toContain("claude-sonnet-4-6"); // model
    expect(html).toContain("200k/day"); // token budget
    expect(html).toContain("unmet needs");

    // summary
    expect(html).toContain("Workforce");
  });

  it("renders an empty state with no members", () => {
    const empty: WorkforceRoster = {
      members: [],
      summary: { total: 0, humans: 0, agents: 0, agentsWithUnmetNeeds: 0 },
    };
    const html = renderToStaticMarkup(<WorkforceRosterPanel roster={empty} />);
    expect(html).toContain("No workforce members yet");
  });
});

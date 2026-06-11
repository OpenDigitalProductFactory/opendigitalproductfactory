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
        hitlTier: 2,
        lifecycleStage: "production",
        model: "claude-sonnet-4-6",
        dailyTokenLimit: 200000,
        perTaskTokenLimit: 20000,
        toolGrantCount: 5,
        skillCount: 3,
        unmetNeedCount: 2,
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
    expect(html).toContain("AI agent");

    // agent-needs lens surfaced
    expect(html).toContain("HR-000"); // supervisor
    expect(html).toContain("T2"); // HITL tier
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

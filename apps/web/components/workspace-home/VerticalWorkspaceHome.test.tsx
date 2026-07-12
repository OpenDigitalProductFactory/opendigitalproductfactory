import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VerticalWorkspaceHome } from "./VerticalWorkspaceHome";
import { defaultWorkspaceHomeRegistry } from "@/lib/workspace-home/registry";
import type { PlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";

const platformData: Omit<PlatformWorkspaceHomeData, "storefrontConfig"> = {
  archetypeCategory: "trades-maintenance",
  workspaceCommandCenter: {
    attentionItems: [
      {
        id: "approval",
        label: "Approvals",
        description: "2 decisions need review",
        href: "/platform/ai/authority",
      },
    ],
    tileStatus: {},
    commandCenter: {
      commandStrip: [
        {
          id: "cmd-1",
          label: "Approval required",
          description: "2 proposals are waiting for review",
          severity: "warning",
          href: "/platform/ai/authority",
        },
      ],
      snapshot: [
        { id: "work", label: "Open work", value: 7, href: "/ops" },
      ],
      readiness: [],
      workInMotion: [],
    },
  },
  workspaceSections: [],
  calendarEvents: [],
  feedItems: [],
};

describe("VerticalWorkspaceHome", () => {
  it("renders a slim archetype identity banner (label, operating question, coverage, concerns) as context", () => {
    const contribution = defaultWorkspaceHomeRegistry.contributions.find(
      (candidate) => candidate.id === "home-waste-management",
    );

    expect(contribution).toBeDefined();

    const html = renderToStaticMarkup(
      <VerticalWorkspaceHome contribution={contribution!} data={platformData} />,
    );

    expect(html).toContain("Waste route operations home");
    expect(html).toContain("which route or missed pickup needs dispatch attention now?");
    // topConcerns render as muted "Watches for" context, not a numbered priority list.
    expect(html).toContain("missed pickups or contaminated loads");
    // Configured component titles render as "Covers" identity context.
    expect(html).toContain("Route completion and missed pickups");
    expect(html).toContain("Truck and crew capacity");
    expect(html).toContain("Dispatcher handoffs");
    expect(html).toContain("Covers");
    expect(html).toContain("Watches for");
    expect(html).toContain("Platform workspace");
    expect(html).not.toMatch(/gear|cockpit|ring|torque|slip|wear|triple/i);
  });

  it("no longer stacks a competing 'what to do now' surface (BI-2651043B): the static zone cards and primitive tiles are gone", () => {
    const contribution = defaultWorkspaceHomeRegistry.contributions.find(
      (candidate) => candidate.id === "home-waste-management",
    );

    const html = renderToStaticMarkup(
      <VerticalWorkspaceHome contribution={contribution!} data={platformData} />,
    );

    // The old zone-labeled action cards and formatted primitive-key tiles are gone;
    // live "what needs you now" lives only in the OperatorCockpit above.
    expect(html).not.toContain("Needs review");
    expect(html).not.toContain("Coworker briefing");
    expect(html).not.toContain("Geo Map");
    expect(html).not.toContain("Capacity Lanes");
    expect(html).toContain("What needs you now");
  });
});

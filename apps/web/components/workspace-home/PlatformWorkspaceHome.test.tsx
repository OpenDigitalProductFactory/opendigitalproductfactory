import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlatformWorkspaceHome } from "./PlatformWorkspaceHome";
import type { PlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";

const fixtureData: Omit<PlatformWorkspaceHomeData, "storefrontConfig"> = {
  archetypeCategory: null,
  calendarEvents: [],
  feedItems: [],
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
      readiness: [
        {
          id: "workspace",
          label: "Workspace",
          href: "/workspace",
          cells: [
            {
              key: "context",
              label: "Context",
              description: "Evidence, docs, and operating knowledge",
              state: "good",
              href: "/wiki",
            },
          ],
        },
      ],
      workInMotion: [
        {
          id: "tr-1",
          label: "Reconcile invoices",
          actor: "Finance coworker",
          status: "working",
          href: "/platform/ai/operations-map",
        },
      ],
    },
  },
  workspaceSections: [
    {
      key: "ai-control",
      label: "Platform work",
      description: "AI, builds, and shared platform tooling.",
      tiles: [
        {
          key: "ai_workforce",
          label: "AI Workforce",
          route: "/platform/ai",
          capabilityKey: "view_platform",
          accentColor: "var(--dpf-info)",
        },
      ],
    },
  ],
};

describe("PlatformWorkspaceHome", () => {
  it("keeps the first render focused on the command center before work-area launchers", () => {
    const html = renderToStaticMarkup(<PlatformWorkspaceHome data={fixtureData} />);

    expect(html.indexOf("Command Center")).toBeLessThan(html.indexOf("Work areas"));
    expect(html).toContain("Show areas");
    expect(html).not.toContain("AI Workforce");
    expect(html).not.toContain('href="/platform/ai"');
  });
});

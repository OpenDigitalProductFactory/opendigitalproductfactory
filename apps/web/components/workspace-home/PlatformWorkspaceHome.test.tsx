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
              reason: "5 documents on record",
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
  it("leads with day-to-day work (needs attention + today's agenda) before work-area launchers", () => {
    const html = renderToStaticMarkup(<PlatformWorkspaceHome data={fixtureData} />);

    // Critical strip and the business agenda come before the demoted launcher.
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf("Work areas"));
    expect(html).toContain("Today &amp; next");
    expect(html).toContain("Show areas");
    // Launcher stays collapsed: its tiles/links are not in the first render.
    expect(html).not.toContain("AI Workforce");
    expect(html).not.toContain('href="/platform/ai"');
  });

  it("does not render the platform readiness matrix on the business home", () => {
    const html = renderToStaticMarkup(<PlatformWorkspaceHome data={fixtureData} />);

    expect(html).not.toContain("Domain readiness");
    expect(html).not.toContain("Command Center");
  });

  it("simple density hides the work-area launcher so Simple mode changes the page body (BI-655418A7)", () => {
    const full = renderToStaticMarkup(<PlatformWorkspaceHome data={fixtureData} density="full" />);
    const simple = renderToStaticMarkup(<PlatformWorkspaceHome data={fixtureData} density="simple" />);

    expect(full).toContain("Work areas");
    expect(full).toContain("Show areas");
    expect(simple).not.toContain("Work areas");
    expect(simple).not.toContain("Show areas");
    expect(simple).toContain("Simple view");
    expect(simple).toContain('data-workspace-density="simple"');
  });
});

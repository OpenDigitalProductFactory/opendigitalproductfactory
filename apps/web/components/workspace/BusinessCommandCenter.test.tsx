import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessCommandCenter } from "./BusinessCommandCenter";
import type { WorkspaceCommandCenterView } from "@/lib/workspace/command-center";

const fixtureView: WorkspaceCommandCenterView = {
  commandStrip: [
    {
      id: "cmd-1",
      label: "Approval required",
      description: "2 proposals are waiting for containment review",
      severity: "warning",
      href: "/platform/ai/authority",
    },
  ],
  snapshot: [
    { id: "ai", label: "AI coworkers", value: 4, href: "/platform/ai" },
    { id: "work", label: "Open work", value: 7, href: "/ops" },
  ],
  readiness: [
    {
      id: "ai",
      label: "AI workforce",
      href: "/platform/ai/operations-map",
      cells: [
        {
          key: "context",
          label: "Context",
          description: "Evidence, docs, and operating knowledge",
          state: "good",
          href: "/wiki",
        },
        {
          key: "connections",
          label: "Connections",
          description: "Provider, integration, and customer-system links",
          state: "attention",
          href: "/platform/tools/integrations",
        },
        {
          key: "capabilities",
          label: "Capabilities",
          description: "People and AI coworkers able to act",
          state: "good",
          href: "/platform/ai",
        },
        {
          key: "cadence",
          label: "Cadence",
          description: "Scheduled work, reviews, and follow-up rhythm",
          state: "good",
          href: "/workspace",
        },
        {
          key: "confidence",
          label: "Confidence",
          description: "Recent receipts and low-risk signals",
          state: "attention",
          href: "/platform/ai/operations-map",
        },
        {
          key: "containment",
          label: "Containment",
          description: "Approvals, route scope, and side-effect controls",
          state: "blocked",
          href: "/platform/ai/authority",
        },
      ],
    },
  ],
  workInMotion: [
    {
      id: "tr-1",
      label: "Reconcile overdue invoices",
      actor: "Finance coworker",
      status: "working",
      href: "/platform/ai/operations-map",
    },
  ],
};

describe("BusinessCommandCenter", () => {
  it("renders the command center, six-C labels, work in motion, and AI Operations link", () => {
    const html = renderToStaticMarkup(<BusinessCommandCenter view={fixtureView} />);

    expect(html).toContain("Command Center");
    expect(html).toContain("Approval required");
    expect(html).toContain("Context");
    expect(html).toContain("Connections");
    expect(html).toContain("Capabilities");
    expect(html).toContain("Cadence");
    expect(html).toContain("Confidence");
    expect(html).toContain("Containment");
    expect(html).toContain("Reconcile overdue invoices");
    expect(html).toContain("AI Operations Map");
  });

  it("puts six-C descriptions into cell titles without adding another visible text tier", () => {
    const html = renderToStaticMarkup(<BusinessCommandCenter view={fixtureView} />);

    expect(html).toContain("Context: Good - Evidence, docs, and operating knowledge");
  });

  it("uses DPF theme tokens instead of hardcoded neutral color classes", () => {
    const html = renderToStaticMarkup(<BusinessCommandCenter view={fixtureView} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/text-gray-|bg-gray-|border-gray-|text-white|text-black|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});

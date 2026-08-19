import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BusinessCommandCenter } from "./BusinessCommandCenter";
import type { WorkspaceCommandCenterView } from "@/lib/workspace-home/command-center";

const fixtureView: WorkspaceCommandCenterView = {
  commandStrip: [
    {
      id: "cmd-1",
      label: "Approval required",
      description: "2 proposals are waiting for review",
      severity: "warning",
      href: "/ops/improvements",
    },
  ],
  snapshot: [
    { id: "ai", label: "AI coworkers", value: 4, href: "/platform/ai" },
    { id: "work", label: "Open work", value: 7, href: "/ops" },
  ],
  // Readiness is still present on the view (the loader builds it) but the
  // business command center must NOT render it — it relocated to the platform
  // surface (PlatformReadinessMatrix).
  readiness: [
    {
      id: "ai",
      label: "AI workforce",
      href: "/platform/ai/operations-map",
      cells: [
        { key: "context", label: "Context", description: "Evidence and operating knowledge", state: "good", reason: "5 documents on record", href: "/coworker-decisions" },
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
  it("renders the posture strip, snapshot, and work in motion", () => {
    const html = renderToStaticMarkup(<BusinessCommandCenter view={fixtureView} />);

    // Secondary "platform posture" watch — NOT a competing "what needs you" claim.
    expect(html).toContain("Platform posture");
    expect(html).not.toContain("Needs attention");
    expect(html).toContain("Approval required");
    expect(html).toContain("AI coworkers");
    expect(html).toContain("Open work");
    expect(html).toContain("Work in motion");
    expect(html).toContain("Reconcile overdue invoices");
  });

  it("never competes with the cockpit's attention count: empty strip reports clear POSTURE, not clear attention (BI-D35DE119 F2)", () => {
    const html = renderToStaticMarkup(
      <BusinessCommandCenter view={{ ...fixtureView, commandStrip: [] }} />,
    );

    expect(html).toContain("Platform posture is clear.");
    // The old wording that contradicted a non-empty cockpit count must be gone.
    expect(html).not.toContain("Nothing needs your attention right now.");
  });

  it("does NOT render the six-C readiness matrix (it moved to the platform surface)", () => {
    const html = renderToStaticMarkup(<BusinessCommandCenter view={fixtureView} />);

    expect(html).not.toContain("Domain readiness");
    expect(html).not.toContain("Containment");
    // No deep platform-meta drill links leak onto the business home.
    expect(html).not.toContain('href="/coworker-decisions"');
    expect(html).not.toContain("AI Operations Map");
  });

  it("uses DPF theme tokens instead of hardcoded neutral color classes", () => {
    const html = renderToStaticMarkup(<BusinessCommandCenter view={fixtureView} />);

    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/text-gray-|bg-gray-|border-gray-|text-white|text-black|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});

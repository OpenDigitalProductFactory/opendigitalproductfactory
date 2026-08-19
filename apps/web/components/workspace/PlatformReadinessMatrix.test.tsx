import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { PlatformReadinessMatrix } from "./PlatformReadinessMatrix";
import type { BusinessDomainReadiness } from "@/lib/workspace-home/command-center";

const readiness: BusinessDomainReadiness[] = [
  {
    id: "ai",
    label: "AI workforce",
    href: "/platform/ai/operations-map",
    cells: [
      {
        key: "context",
        label: "Context",
        description: "Evidence and operating knowledge",
        state: "good",
        reason: "5 documents, 3 architecture views",
        href: "/coworker-decisions",
      },
      {
        key: "connections",
        label: "Connections",
        description: "Provider and integration links",
        state: "attention",
        reason: "1 coworker pinned to an inactive provider",
        href: "/platform/tools/integrations",
        action: { label: "Review provider pins", href: "/platform/ai" },
      },
      {
        key: "capabilities",
        label: "Capabilities",
        description: "People and AI coworkers able to act",
        state: "good",
        reason: "4 AI coworkers able to act",
        href: "/platform/ai",
      },
      {
        key: "cadence",
        label: "Cadence",
        description: "Scheduled work and follow-up rhythm",
        state: "good",
        reason: "2 scheduled cadences active",
        href: "/workspace",
      },
      {
        key: "confidence",
        label: "Confidence",
        description: "Recent receipts and low-risk signals",
        state: "attention",
        reason: "No valid execution receipts in the last 7 days",
        href: "/platform/ai/operations-map",
        action: { label: "Review AI operations", href: "/platform/ai/operations-map" },
      },
      {
        key: "containment",
        label: "Containment",
        description: "Approvals and side-effect controls",
        state: "blocked",
        reason: "Coworkers can act but an approval path is missing",
        href: "/platform/ai/authority",
        action: { label: "Configure authority", href: "/platform/ai/authority" },
      },
    ],
  },
];

describe("PlatformReadinessMatrix", () => {
  it("renders the six-C labels and domain heading", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={readiness} />);

    expect(html).toContain("Domain readiness");
    for (const label of ["Context", "Connections", "Capabilities", "Cadence", "Confidence", "Containment"]) {
      expect(html).toContain(label);
    }
  });

  it("carries the cell reason and recommended action in the title", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={readiness} />);
    expect(html).toContain("Context: Good - 5 documents, 3 architecture views");
    expect(html).toContain("Containment: Blocked - Coworkers can act but an approval path is missing - Configure authority");
  });

  it("renders an actionable 'what needs attention' roll-up, blocked first", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={readiness} />);

    expect(html).toContain("What needs attention");
    // Action labels from the non-good cells surface as drill-down links.
    expect(html).toContain("Configure authority");
    expect(html).toContain("Review provider pins");
    // Within the attention roll-up, blocked containment sorts ahead of the
    // attention rows. (Reasons also appear in cell titles above, so scope the
    // ordering check to the roll-up substring.)
    const rollup = html.slice(html.indexOf("What needs attention"));
    const containmentIdx = rollup.indexOf("approval path is missing");
    const connectionsIdx = rollup.indexOf("pinned to an inactive provider");
    expect(containmentIdx).toBeGreaterThanOrEqual(0);
    expect(connectionsIdx).toBeGreaterThan(containmentIdx);
  });

  it("shows a positive empty state when every cell is good", () => {
    const allGood: BusinessDomainReadiness[] = [
      {
        id: "ai",
        label: "AI workforce",
        href: "/platform/ai",
        cells: readiness[0]!.cells.map((cell) => ({
          ...cell,
          state: "good" as const,
          action: undefined,
        })),
      },
    ];
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={allGood} />);
    expect(html).toContain("All domains are healthy");
  });

  it("renders nothing for an empty matrix", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={[]} />);
    expect(html).toBe("");
  });

  it("uses DPF theme tokens, not hardcoded colors", () => {
    const html = renderToStaticMarkup(<PlatformReadinessMatrix readiness={readiness} />);
    expect(html).toContain("var(--dpf-");
    expect(html).not.toMatch(/text-gray-|bg-gray-|border-gray-|text-white|text-black|bg-white|#[0-9a-fA-F]{3,6}/);
  });
});

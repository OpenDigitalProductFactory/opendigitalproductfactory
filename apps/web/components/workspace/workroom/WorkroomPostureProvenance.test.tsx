import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkroomPostureView } from "@/lib/work-management/room-posture";

import { WorkroomPostureProvenance } from "./WorkroomPostureProvenance";

const BALANCED = {
  costWeight: 1 / 3,
  qualityWeight: 1 / 3,
  timeWeight: 1 / 3,
  preset: "balanced" as const,
};

function posture(overrides: Partial<WorkroomPostureView> = {}): WorkroomPostureView {
  return {
    proactivityLevel: "balanced",
    actionBoundary: "propose",
    minimumTier: undefined,
    verificationDepth: undefined,
    priority: BALANCED,
    temporalBand: "in-hours",
    proactivitySource: "platform",
    prioritySource: "platform",
    adjustments: [],
    inert: false,
    ...overrides,
  } as WorkroomPostureView;
}

const OVERRIDDEN_BY_POLICY = [
  {
    field: "actionBoundary",
    from: "preauthorized",
    to: "propose",
    reasonCode: "room_declaration",
    reason: "The room declared this action boundary when it was convened.",
  },
  {
    field: "actionBoundary",
    from: "propose",
    to: "advise",
    reasonCode: "regulated_ceiling",
    reason: "This work is regulated, so the coworker advises rather than acts.",
  },
];

describe("WorkroomPostureProvenance", () => {
  it("renders the honest empty state for an inert posture", () => {
    const html = renderToStaticMarkup(<WorkroomPostureProvenance posture={posture({ inert: true })} />);
    expect(html).toContain("Running platform defaults");
    // No chain, no layer names — nothing implying decisions nobody made.
    expect(html).not.toContain("How this was decided");
    expect(html).not.toContain("Policy");
  });

  it("makes every precedence layer distinguishable", () => {
    const html = renderToStaticMarkup(
      <WorkroomPostureProvenance posture={posture({ adjustments: OVERRIDDEN_BY_POLICY })} />,
    );
    for (const label of [
      "Policy",
      "This room",
      "The work itself",
      "Default for rooms",
      "The coworker",
      "The organisation",
      "Platform default",
    ]) {
      expect(html, label).toContain(label);
    }
  });

  it("shows the clamp reason verbatim from the adjustment", () => {
    const html = renderToStaticMarkup(
      <WorkroomPostureProvenance posture={posture({ adjustments: OVERRIDDEN_BY_POLICY })} />,
    );
    expect(html).toContain("This work is regulated, so the coworker advises rather than acts.");
    expect(html).toContain("The room declared this action boundary when it was convened.");
  });

  // The load-bearing half: an operator whose declaration lost needs to see
  // that it lost, not just the value that won.
  it("marks a superseded clamp as overridden rather than hiding it", () => {
    const html = renderToStaticMarkup(
      <WorkroomPostureProvenance posture={posture({ adjustments: OVERRIDDEN_BY_POLICY })} />,
    );
    expect(html).toContain("Later overridden.");
  });

  it("names the input that drove a derived clamp", () => {
    const html = renderToStaticMarkup(
      <WorkroomPostureProvenance
        posture={posture({
          adjustments: [
            {
              field: "proactivityLevel",
              from: "balanced",
              to: "quiet",
              reasonCode: "clock_out_of_hours",
              reason: "The business is closed.",
            },
          ],
        })}
      />,
    );
    expect(html).toContain("from the clock");
  });

  it("says plainly when a layer contributed nothing", () => {
    const html = renderToStaticMarkup(
      <WorkroomPostureProvenance posture={posture({ adjustments: OVERRIDDEN_BY_POLICY })} />,
    );
    expect(html).toContain("Nothing from here.");
  });

  // AGENTS.md §9 — theme-aware styling is mandatory, so light mode, dark mode
  // and per-org branding all work without a second code path.
  it("uses only --dpf-* tokens for colour", () => {
    const html = renderToStaticMarkup(
      <WorkroomPostureProvenance posture={posture({ adjustments: OVERRIDDEN_BY_POLICY })} />,
    );
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toMatch(/text-(white|black)\b/);
    expect(html).not.toMatch(/-gray-\d/);
  });
});

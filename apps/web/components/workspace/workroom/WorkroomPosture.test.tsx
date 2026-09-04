import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkroomView } from "@/lib/work-management/room-types";

import { WorkroomPosture } from "./WorkroomPosture";

function room(posture: WorkroomView["posture"]): WorkroomView {
  return { posture } as unknown as WorkroomView;
}

const BALANCED = {
  costWeight: 1 / 3,
  qualityWeight: 1 / 3,
  timeWeight: 1 / 3,
  preset: "balanced" as const,
};

describe("WorkroomPosture", () => {
  it("says so honestly when the room has no resolved posture", () => {
    const html = renderToStaticMarkup(<WorkroomPosture room={room(null)} />);
    expect(html).toContain("Running on defaults");
    // It must not imply a decision that was never made.
    expect(html).not.toContain("Quiet");
    expect(html).not.toContain("Pushes");
  });

  it("renders the pace, the authority and where they came from", () => {
    const html = renderToStaticMarkup(
      <WorkroomPosture
        room={room({
          proactivityLevel: "assertive",
          actionBoundary: "propose",
          minimumTier: undefined,
          verificationDepth: undefined,
          priority: BALANCED,
          temporalBand: "pre-deadline",
          proactivitySource: "derived",
          prioritySource: "platform",
          adjustments: [
            {
              field: "proactivityLevel",
              from: "balanced",
              to: "assertive",
              reasonCode: "clock_pre_deadline",
              reason: "The obligation falls due soon.",
            },
          ],
          inert: false,
        })}
      />,
    );
    expect(html).toContain("Pushes");
    expect(html).toContain("asks first");
    expect(html).toContain("the work shape");
    expect(html).toContain("due soon");
    // The reason for the change is shown, not just the outcome.
    expect(html).toContain("The obligation falls due soon.");
  });

  it("states plainly when nothing about the room changed the pace", () => {
    const html = renderToStaticMarkup(
      <WorkroomPosture
        room={room({
          proactivityLevel: "balanced",
          actionBoundary: "propose",
          minimumTier: undefined,
          verificationDepth: undefined,
          priority: BALANCED,
          temporalBand: "in-hours",
          proactivitySource: "platform",
          prioritySource: "platform",
          adjustments: [],
          inert: true,
        })}
      />,
    );
    // BI-4EB2F1D0: the honest empty state names what IS running rather than
    // only what is not, and renders no provenance chain for decisions nobody
    // made.
    expect(html).toContain("Running platform defaults");
    expect(html).not.toContain("How this was decided");
    expect(html).toContain("open");
  });

  it("surfaces a verification requirement when one applies", () => {
    const html = renderToStaticMarkup(
      <WorkroomPosture
        room={room({
          proactivityLevel: "balanced",
          actionBoundary: "propose",
          minimumTier: undefined,
          verificationDepth: "deep",
          priority: BALANCED,
          temporalBand: "in-hours",
          proactivitySource: "platform",
          prioritySource: "derived",
          adjustments: [
            {
              field: "verificationDepth",
              from: undefined,
              to: "deep",
              reasonCode: "shape_outward_review",
              reason: "The action faces outward, so it is reviewed and verified before it leaves.",
            },
          ],
          inert: false,
        })}
      />,
    );
    expect(html).toContain("Verified before done");
  });

  it("uses only theme tokens, never a hardcoded colour", () => {
    const html = renderToStaticMarkup(
      <WorkroomPosture
        room={room({
          proactivityLevel: "quiet",
          actionBoundary: "advise",
          minimumTier: undefined,
          verificationDepth: undefined,
          priority: BALANCED,
          temporalBand: "out-of-hours",
          proactivitySource: "derived",
          prioritySource: "platform",
          adjustments: [],
          inert: true,
        })}
      />,
    );
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(html).not.toContain("text-white");
    expect(html).not.toMatch(/\btext-gray-/);
    expect(html).toContain("var(--dpf-");
  });
});

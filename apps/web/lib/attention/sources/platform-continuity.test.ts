import { describe, expect, it, vi } from "vitest";

import { classifyOwnerAttentionLane } from "../owner-routing";
import { headlineFor } from "../owner-decision-copy";
import { continuityIssueToAttentionItem, loadPlatformContinuityItems } from "./platform-continuity";

const DOWNTIME = {
  issueKey: "platform-downtime:2026-11-08T14:48:00.000Z",
  issueType: "platform_downtime",
  severity: "warn",
  summary: "The platform was down for 11 h 14 min (8 Nov 14:48 to 9 Nov 02:02 UTC)",
  details: {
    cause: "docker-or-host-restart",
    explanation: "Docker, or the computer running it, restarted during this time.",
    advice: ["Keep this Mac plugged in to its power adapter."],
    actionLabel: "Check how this computer is set up",
    href: "/ops/installation#host-posture",
  },
  firstDetectedAt: new Date("2026-11-09T02:02:00.000Z"),
};

const WORK_SYNC = {
  issueKey: "work-sync:link:link_d0ea1f3a6cb948ad",
  issueType: "work_sync_failure",
  severity: "warn",
  summary: "Work sync with the development installation has failed since 8 Nov 14:50 UTC",
  details: {
    peerLabel: "the development installation",
    explanation: "The other installation could not be reached.",
    nextSteps: ["Check that the other computer is switched on."],
    actionLabel: "Review work sync",
    href: "/ops/installation#work-sync",
  },
  firstDetectedAt: new Date("2026-11-08T20:50:00.000Z"),
};

describe("continuityIssueToAttentionItem", () => {
  it("projects a downtime row as a Needs-you card under its own title", () => {
    const item = continuityIssueToAttentionItem(DOWNTIME);
    expect(item.id).toBe("platform-health:platform-downtime:2026-11-08T14:48:00.000Z");
    expect(item.source).toBe("platform-health");
    expect(item.context).toBe("Docker, or the computer running it, restarted during this time. Keep this Mac plugged in to its power adapter.");
    expect(item.deepLink).toBe("/ops/installation#host-posture");
    expect(item.actions).toEqual([{ kind: "open-in-context", label: "Check how this computer is set up", href: "/ops/installation#host-posture" }]);
    expect(classifyOwnerAttentionLane(item).lane).toBe("needs-you-now");
    expect(headlineFor(item)).toBe(DOWNTIME.summary);
  });

  it("projects a work-sync row naming the peer and the next steps", () => {
    const item = continuityIssueToAttentionItem(WORK_SYNC);
    expect(item.id).toBe("platform-health:work-sync:link:link_d0ea1f3a6cb948ad");
    expect(item.triage.blastRadius).toBe("the development installation");
    expect(item.context).toContain("Check that the other computer is switched on.");
    expect(classifyOwnerAttentionLane(item).lane).toBe("needs-you-now");
  });
});

describe("loadPlatformContinuityItems", () => {
  it("reads open operator-estate rows of both continuity types", async () => {
    const findMany = vi.fn(async () => [DOWNTIME, WORK_SYNC]);
    const items = await loadPlatformContinuityItems({ portfolioQualityIssue: { findMany } } as never);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { issueType: { in: ["platform_downtime", "work_sync_failure"] }, status: "open", customerAccountId: null },
    }));
    expect(items.map((item) => item.id)).toEqual([
      "platform-health:platform-downtime:2026-11-08T14:48:00.000Z",
      "platform-health:work-sync:link:link_d0ea1f3a6cb948ad",
    ]);
  });
});

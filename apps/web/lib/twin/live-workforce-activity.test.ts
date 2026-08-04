// apps/web/lib/twin/live-workforce-activity.test.ts
import { describe, expect, it } from "vitest";
import {
  activeAwarePresence,
  activeWorkToFeed,
  mergeTwinFeed,
  relativeTime,
  STALE_ACTIVITY_MS,
  type ActiveWorkRow,
} from "./live-workforce-activity";
import type { WorkforceMember } from "@/lib/workforce/workforce-roster";
import type { FeedEventData } from "@/components/twin";

const NOW = new Date("2026-08-04T12:00:00.000Z");

function member(over: Partial<WorkforceMember> & Pick<WorkforceMember, "id" | "kind">): WorkforceMember {
  return {
    status: "active",
    role: null,
    displayName: over.displayName ?? over.id,
    ...over,
  } as WorkforceMember;
}

function work(over: Partial<ActiveWorkRow> & Pick<ActiveWorkRow, "taskRunId" | "currentAgentId">): ActiveWorkRow {
  return {
    title: over.title ?? "some task",
    startedAt: over.startedAt ?? new Date(NOW.getTime() - 60_000),
    lastHeartbeatAt: over.lastHeartbeatAt ?? new Date(NOW.getTime() - 30_000),
    ...over,
  };
}

const agent = (id: string, name: string) => member({ id, kind: "agent", displayName: name, role: "inventory" });
const human = (id: string, name: string) => member({ id, kind: "human", displayName: name, role: "server" });

describe("activeAwarePresence", () => {
  it("shows what an active coworker is doing (task title as focus), not the static role", () => {
    const members = [agent("a1", "Inventory Specialist")];
    const rows = [work({ taskRunId: "t1", currentAgentId: "a1", title: "Discovery Taxonomy Gap Triage" })];
    const [p] = activeAwarePresence(members, rows, NOW);
    expect(p.name).toBe("Inventory Specialist");
    expect(p.kind).toBe("ai");
    expect(p.focus).toBe("Discovery Taxonomy Gap Triage");
  });

  it("keeps an idle coworker present with their role focus, not removed", () => {
    const [p] = activeAwarePresence([human("h1", "Maria")], [], NOW);
    expect(p.name).toBe("Maria");
    expect(p.kind).toBe("human");
    expect(p.focus).toBe("server");
  });

  it("marks a coworker whose loop went stale as unresponsive (the original cognitive-load fix, generalized)", () => {
    const stale = new Date(NOW.getTime() - (STALE_ACTIVITY_MS + 60_000));
    const rows = [work({ taskRunId: "t1", currentAgentId: "a1", title: "Gap Triage", startedAt: stale, lastHeartbeatAt: stale })];
    const [p] = activeAwarePresence([agent("a1", "Spec")], rows, NOW);
    expect(p.focus).toBe("Gap Triage (unresponsive)");
  });

  it("sorts active coworkers ahead of idle ones, and AI ahead of humans", () => {
    const members = [human("h1", "Idle Human"), agent("a1", "Idle AI"), human("h2", "Busy Human")];
    const rows = [work({ taskRunId: "t1", currentAgentId: "h2", title: "seating T4" })];
    const names = activeAwarePresence(members, rows, NOW).map((p) => p.name);
    expect(names[0]).toBe("Busy Human"); // active first
    expect(names.indexOf("Idle AI")).toBeLessThan(names.indexOf("Idle Human")); // AI before human
  });

  it("classifies a partner member via the classifier", () => {
    const members = [member({ id: "p1", kind: "human", displayName: "Reseller Partner", role: "reseller" })];
    const [p] = activeAwarePresence(members, [], NOW, { isPartner: (m) => m.id === "p1" });
    expect(p.kind).toBe("partner");
  });
});

describe("activeWorkToFeed", () => {
  it("attributes each active run to its coworker, most-recent first", () => {
    const members = [agent("a1", "Spec"), human("h1", "Maria")];
    const rows = [
      work({ taskRunId: "t1", currentAgentId: "a1", title: "old", startedAt: new Date(NOW.getTime() - 300_000) }),
      work({ taskRunId: "t2", currentAgentId: "h1", title: "new", startedAt: new Date(NOW.getTime() - 60_000) }),
    ];
    const feed = activeWorkToFeed(rows, members, NOW);
    expect(feed.map((f) => f.actor.name)).toEqual(["Maria", "Spec"]); // newest first
    expect(feed[0]).toMatchObject({ action: "is working on", target: "new" });
    expect(feed[0].actor.kind).toBe("human");
  });

  it("labels a stalled run and never fabricates entries for an empty input", () => {
    const stale = new Date(NOW.getTime() - (STALE_ACTIVITY_MS + 60_000));
    const rows = [work({ taskRunId: "t1", currentAgentId: "a1", title: "wedged", startedAt: stale, lastHeartbeatAt: stale })];
    expect(activeWorkToFeed(rows, [agent("a1", "Spec")], NOW)[0].action).toBe("is stalled on");
    expect(activeWorkToFeed([], [], NOW)).toEqual([]);
  });
});

describe("relativeTime + mergeTwinFeed", () => {
  it("formats relative time compactly", () => {
    expect(relativeTime(new Date(NOW.getTime() - 30_000), NOW)).toBe("just now");
    expect(relativeTime(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m");
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3h");
    expect(relativeTime(new Date(NOW.getTime() - 2 * 86_400_000), NOW)).toBe("2d");
  });

  it("puts real coworker activity ahead of demand events and caps the feed", () => {
    const activity: FeedEventData[] = [{ key: "a", actor: { name: "Spec", kind: "ai" }, action: "is working on" }];
    const demand: FeedEventData[] = Array.from({ length: 8 }, (_, i) => ({
      key: `d${i}`,
      actor: { name: "Front desk", kind: "human" },
      action: "took a booking",
    }));
    const merged = mergeTwinFeed(activity, demand, 6);
    expect(merged).toHaveLength(6);
    expect(merged[0].key).toBe("a"); // activity first
  });
});

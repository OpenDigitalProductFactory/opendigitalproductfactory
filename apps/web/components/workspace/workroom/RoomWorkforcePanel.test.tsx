import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RoomWorkforcePanel } from "./RoomWorkforcePanel";
import type { EffectiveHumanAccountability } from "@/lib/work-management/human-accountability";
import type { NamedWorker, WorkerGroup } from "@/lib/work-management/worker-rollup";

const w = (over: Partial<NamedWorker> & { workerId: string }): NamedWorker => ({
  displayName: over.workerId,
  executorKinds: ["portal"],
  state: "unknown",
  currentTask: null,
  lastProgressAt: null,
  parentage: { kind: "unknown" },
  subagentCount: 0,
  ...over,
});

const render = (
  accountability: EffectiveHumanAccountability,
  groups: WorkerGroup[] = [],
  extra: { displayName?: string | null; matched?: number; partial?: boolean } = {},
) =>
  renderToStaticMarkup(
    <RoomWorkforcePanel
      accountability={accountability}
      accountableDisplayName={extra.displayName ?? null}
      groups={groups}
      matched={extra.matched ?? 0}
      partial={extra.partial ?? false}
    />,
  );

describe("RoomWorkforcePanel", () => {
  it("names the accountable human and where the answer came from", () => {
    const html = render(
      { state: "resolved", principalId: "p1", source: "organization-owner", inheritedFrom: [] },
      [],
      { displayName: "Dana Reyes" },
    );
    expect(html).toContain("Dana Reyes");
    expect(html).toContain("organization&#x27;s recorded owner");
  });

  it("says how far an inherited answer travelled", () => {
    const html = render(
      { state: "resolved", principalId: "p1", source: "inherited-room", inheritedFrom: ["r1", "r2"] },
      [],
      { displayName: "Dana Reyes" },
    );
    expect(html).toContain("2 steps up");
  });

  it("asks for setup instead of naming somebody when no owner is recorded", () => {
    const html = render({
      state: "setup-required",
      reason: "no-organization-owner-recorded",
      message: "No organization owner is recorded.",
      atWorkroomId: null,
    });
    expect(html).toContain("No accountable person is recorded.");
    expect(html).toContain("No organization owner is recorded.");
  });

  it("keeps accountability distinct from coordination and permission", () => {
    const html = render({
      state: "resolved",
      principalId: "p1",
      source: "explicit-room",
      inheritedFrom: [],
    });
    expect(html).toContain("separate from who coordinates it");
  });

  it("groups delegated subagents under their delegator", () => {
    const parent = w({ workerId: "lead", displayName: "Lead", parentage: { kind: "root" }, subagentCount: 2 });
    const html = render(
      { state: "resolved", principalId: "p1", source: "explicit-room", inheritedFrom: [] },
      [
        {
          parent,
          unknownParentage: false,
          members: [
            w({ workerId: "a", displayName: "Specialist A", parentage: { kind: "delegated", byWorkerId: "lead" } }),
          ],
        },
      ],
    );
    expect(html).toContain("Lead");
    expect(html).toContain("2 subagents");
    expect(html).toContain("Specialist A");
  });

  it("labels unrecorded delegation rather than implying a parent", () => {
    const html = render(
      { state: "resolved", principalId: "p1", source: "explicit-room", inheritedFrom: [] },
      [{ parent: null, unknownParentage: true, members: [w({ workerId: "x", displayName: "Worker X" })] }],
    );
    expect(html).toContain("Delegation not recorded");
  });

  it("says a worker's state is not recorded rather than calling it idle", () => {
    const html = render(
      { state: "resolved", principalId: "p1", source: "explicit-room", inheritedFrom: [] },
      [{ parent: null, unknownParentage: true, members: [w({ workerId: "x", currentTask: "Drafting" })] }],
    );
    expect(html).toContain("state not recorded");
    expect(html).toContain("Drafting");
  });

  it("reports how many of a hundred workers it is showing", () => {
    const members = Array.from({ length: 20 }, (_, i) => w({ workerId: `w-${i}` }));
    const html = render(
      { state: "resolved", principalId: "p1", source: "explicit-room", inheritedFrom: [] },
      [{ parent: null, unknownParentage: true, members }],
      { matched: 100, partial: true },
    );
    expect(html).toContain("Showing 20 of 100 workers.");
  });

  it("passes only serialisable data across the server boundary", () => {
    const props = {
      accountability: { state: "resolved", principalId: "p1", source: "explicit-room", inheritedFrom: [] },
      accountableDisplayName: null,
      groups: [],
      matched: 0,
      partial: false,
    };
    for (const value of Object.values(props)) expect(typeof value).not.toBe("function");
    expect(() => JSON.stringify(props)).not.toThrow();
  });
});

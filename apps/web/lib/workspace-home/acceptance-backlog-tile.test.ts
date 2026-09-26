import { describe, expect, it, vi } from "vitest";

import type { TileStatus } from "@/components/shell/WorkspaceTiles";
import {
  loadAcceptanceBacklogShare,
  withAcceptanceBacklogTile,
  type AcceptanceBacklogDb,
} from "./acceptance-backlog-tile";

const now = new Date("2026-09-25T00:00:00.000Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

function baseTiles(): Record<string, TileStatus> {
  return {
    backlog: {
      metrics: [
        { label: "Open", value: 5, color: "var(--dpf-info)" },
        { label: "In progress", value: 2, color: "var(--dpf-warning)" },
        { label: "Done", value: 11, color: "var(--dpf-success)" },
      ],
      badge: "2 improvements pending",
    },
    build: { metrics: [{ label: "Builds", value: 8 }] },
  };
}

describe("loadAcceptanceBacklogShare", () => {
  it("counts awaiting and aged items with one pool read and one activity read", async () => {
    const itemFindMany = vi.fn(async (_args: unknown) => [
      { id: "entered-recently", status: "awaiting-acceptance", createdAt: daysAgo(60) },
      { id: "entered-long-ago", status: "awaiting-acceptance", createdAt: daysAgo(60) },
      { id: "no-entry-row", status: "awaiting-acceptance", createdAt: daysAgo(30) },
    ]);
    const activityFindMany = vi.fn(async (_args: unknown) => [
      {
        backlogItemId: "entered-recently",
        kind: "status_change",
        recordedAt: daysAgo(1),
        payload: { from: "in-progress", to: "awaiting-acceptance" },
      },
      {
        backlogItemId: "entered-long-ago",
        kind: "status_change",
        recordedAt: daysAgo(21),
        payload: { from: "in-progress", to: "awaiting-acceptance" },
      },
    ]);
    const db = {
      backlogItem: { findMany: itemFindMany },
      backlogItemActivity: { findMany: activityFindMany },
    } as unknown as AcceptanceBacklogDb;

    const share = await loadAcceptanceBacklogShare(db, now);

    expect(itemFindMany).toHaveBeenCalledTimes(1);
    expect(itemFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { status: "awaiting-acceptance" } });
    expect(activityFindMany).toHaveBeenCalledTimes(1);
    expect(share).toEqual({ awaiting: 3, aged: 2, agedByCreation: 1 });
  });
});

describe("withAcceptanceBacklogTile", () => {
  it("places awaiting acceptance and its aged share before Done, leaving Done unchanged", () => {
    const tiles = withAcceptanceBacklogTile(baseTiles(), { awaiting: 7, aged: 3, agedByCreation: 0 });

    expect(tiles.backlog?.metrics).toEqual([
      { label: "Open", value: 5, color: "var(--dpf-info)" },
      { label: "In progress", value: 2, color: "var(--dpf-warning)" },
      { label: "Awaiting acceptance", value: 7, color: "var(--dpf-warning)" },
      { label: "Awaiting 14+ days", value: "3", color: "var(--dpf-error)" },
      { label: "Done", value: 11, color: "var(--dpf-success)" },
    ]);
    expect(tiles.backlog?.badge).toBe("2 improvements pending");
    expect(tiles.build).toEqual(baseTiles().build);
  });

  it("marks the aged count as a ceiling when some ages are measured from creation", () => {
    const tiles = withAcceptanceBacklogTile(baseTiles(), { awaiting: 7, aged: 3, agedByCreation: 2 });

    expect(tiles.backlog?.metrics?.find((m) => m.label === "Awaiting 14+ days")?.value).toBe("up to 3");
  });

  it("shows a zero awaiting count without an aged row", () => {
    const tiles = withAcceptanceBacklogTile(baseTiles(), { awaiting: 0, aged: 0, agedByCreation: 0 });

    expect(tiles.backlog?.metrics?.map((m) => m.label)).toEqual([
      "Open",
      "In progress",
      "Awaiting acceptance",
      "Done",
    ]);
  });

  it("uses theme tokens only", () => {
    const tiles = withAcceptanceBacklogTile(baseTiles(), { awaiting: 1, aged: 1, agedByCreation: 0 });

    for (const metric of tiles.backlog?.metrics ?? []) {
      expect(metric.color).toMatch(/^var\(--dpf-[a-z-]+\)$/);
    }
  });
});

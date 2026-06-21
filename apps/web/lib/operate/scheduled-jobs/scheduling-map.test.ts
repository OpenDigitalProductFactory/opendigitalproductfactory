// BI-SCHED-CANONICAL-MAP + BI-SCHED-STAGGER / EP-SCHEDULING-SURFACE.
//
// Guards the canonical scheduling map: it must span every substrate, map each
// to a data-model node (so the EA extractor can draw cross-layer edges), and —
// the contention guard — no cron expression may be shared by 3+ scheduled units
// (the thundering-herd the stagger removed).

import { describe, it, expect } from "vitest";

import {
  SCHEDULING_MAP,
  SUBSTRATE_DATA_MODEL,
  cronCollisions,
} from "./scheduling-map";
import { SCHEDULED_JOB_CATALOG } from "./catalog";

describe("canonical scheduling map", () => {
  it("includes every Inngest cron from the catalog, plus the 4 seeded agent tasks", () => {
    const cronIds = SCHEDULING_MAP.filter((e) => e.substrate === "inngest-cron")
      .map((e) => e.id)
      .sort();
    const catalogIds = SCHEDULED_JOB_CATALOG.map((e) => e.inngestId).sort();
    expect(cronIds).toEqual(catalogIds);

    expect(
      SCHEDULING_MAP.filter((e) => e.substrate === "scheduled-agent-task"),
    ).toHaveLength(4);
  });

  it("maps every substrate present in the map to a data-model node", () => {
    for (const e of SCHEDULING_MAP) {
      expect(SUBSTRATE_DATA_MODEL[e.substrate]).toBeTruthy();
    }
  });

  // BI-SCHED-STAGGER: no thundering herd. If this fails, a new or edited job
  // landed on a tick already shared by 2 others — pick a free minute offset
  // (see the stagger pattern in the queue/functions crons).
  it("has no cron expression shared by 3 or more jobs (contention guard)", () => {
    const herd = [...cronCollisions().entries()]
      .filter(([, arr]) => arr.length >= 3)
      .map(([cron, arr]) => `${cron} -> ${arr.map((e) => e.id).join(", ")}`);
    expect(herd).toEqual([]);
  });
});

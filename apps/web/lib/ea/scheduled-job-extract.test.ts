// EP-SCHEDULING-SURFACE — pure extractor tests for the Scheduling SysML
// projection. No DB: drives buildSchedulingModel directly.

import { describe, it, expect } from "vitest";

import {
  buildSchedulingModel,
  SCHEDULING_PACKAGE_KEY,
  dataModelKeyFor,
} from "./scheduled-job-extract";
import {
  SCHEDULING_MAP,
  type SchedulingMapEntry,
} from "@/lib/operate/scheduled-jobs/scheduling-map";

const SAMPLE: SchedulingMapEntry[] = [
  { id: "ops/x", name: "Cron X", substrate: "inngest-cron", cron: "*/15 * * * *", cadence: "Every 15 minutes", category: "core", purpose: "p" },
  { id: "ops/y", name: "Cron Y", substrate: "inngest-cron", cron: "0 3 * * *", cadence: "Daily at 03:00", category: "editable", purpose: "q" },
  { id: "agent-z", name: "Agent Z", substrate: "scheduled-agent-task", cron: "0 4 * * *", cadence: "Daily at 04:00", category: "core", purpose: "r" },
];

describe("buildSchedulingModel", () => {
  it("emits a package, one part_definition per substrate, and a part_usage per job", () => {
    const m = buildSchedulingModel(SAMPLE);
    const pkg = m.elements.find((e) => e.sysmlKey === SCHEDULING_PACKAGE_KEY);
    expect(pkg?.typeSlug).toBe("package");
    expect(m.elements.filter((e) => e.typeSlug === "part_definition")).toHaveLength(2); // 2 substrates
    expect(m.elements.filter((e) => e.typeSlug === "part_usage")).toHaveLength(3); // 3 jobs
  });

  it("traces each job to its substrate's data-model node", () => {
    const m = buildSchedulingModel(SAMPLE);
    const traces = m.crossLayerRelationships ?? [];
    expect(traces).toHaveLength(3);
    expect(traces.every((r) => r.relSlug === "traces")).toBe(true);
    expect(new Set(traces.map((r) => r.toKey))).toEqual(
      new Set(["prisma:model:ScheduledJob", "prisma:model:ScheduledAgentTask"]),
    );
    expect(dataModelKeyFor("inngest-cron")).toBe("prisma:model:ScheduledJob");
    expect(dataModelKeyFor("scheduled-agent-task")).toBe("prisma:model:ScheduledAgentTask");
  });

  it("projects every entry in the real scheduling map as a part_usage", () => {
    const m = buildSchedulingModel();
    const usages = m.elements.filter((e) => e.typeSlug === "part_usage");
    expect(usages).toHaveLength(SCHEDULING_MAP.length);
  });
});

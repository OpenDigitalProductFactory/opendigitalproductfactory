import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory state to exercise classify + emit without a live DB. Designed
// to also catch the curator if it ever tries to write a field other than
// `lifecycleState` on `SkillDefinition`.

const state = vi.hoisted(() => ({
  skills: [] as Array<{
    skillId: string;
    category: string;
    skillMdContent: string;
    lifecycleState: string;
    assignments: Array<{ id: string }>;
  }>,
  usageEvents: [] as Array<{ skillId: string; phase: string; createdAt: Date }>,
  signalsTouched: [] as Array<Record<string, unknown>>,
  taskRunsCreated: [] as Array<Record<string, unknown>>,
  artifactsCreated: [] as Array<Record<string, unknown>>,
  skillUpdates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    skillDefinition: {
      findMany: vi.fn(async () => state.skills),
      update: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        state.skillUpdates.push(args);
        const s = state.skills.find((sk) => sk.skillId === (args.where.skillId as string));
        if (!s) throw new Error("skill not found");
        Object.assign(s, args.data);
        return s;
      }),
    },
    skillUsageEvent: {
      groupBy: vi.fn(async () => {
        const groups = new Map<string, number>();
        for (const e of state.usageEvents) {
          const k = `${e.skillId}:${e.phase}`;
          groups.set(k, (groups.get(k) ?? 0) + 1);
        }
        return Array.from(groups.entries()).map(([k, c]) => {
          const [skillId, phase] = k.split(":");
          return { skillId, phase, _count: { _all: c } };
        });
      }),
      findMany: vi.fn(async () => {
        const seen = new Map<string, Date>();
        for (const e of state.usageEvents) {
          if (!seen.has(e.skillId) || e.createdAt > (seen.get(e.skillId) as Date)) {
            seen.set(e.skillId, e.createdAt);
          }
        }
        return Array.from(seen.entries()).map(([skillId, createdAt]) => ({ skillId, createdAt }));
      }),
    },
    taskRun: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const row = { ...args.data, id: `tr-${state.taskRunsCreated.length + 1}` };
        state.taskRunsCreated.push(row);
        return row;
      }),
    },
    taskArtifact: {
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        state.artifactsCreated.push(args.data);
        return args.data;
      }),
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock("@/lib/improvement-flywheel/signals", () => ({
  createOrTouchImprovementSignal: vi.fn(async (input: Record<string, unknown>) => {
    state.signalsTouched.push(input);
    return { signalId: `IS-${state.signalsTouched.length}`, isNew: true };
  }),
}));

import { runSkillCurator, CURATOR_REPORT_KIND } from "./curator";

beforeEach(() => {
  state.skills.length = 0;
  state.usageEvents.length = 0;
  state.signalsTouched.length = 0;
  state.taskRunsCreated.length = 0;
  state.artifactsCreated.length = 0;
  state.skillUpdates.length = 0;
});

function addSkill(partial: Partial<(typeof state.skills)[number]> & { skillId: string }) {
  state.skills.push({
    skillId: partial.skillId,
    category: partial.category ?? "build",
    skillMdContent: partial.skillMdContent ?? "body",
    lifecycleState: partial.lifecycleState ?? "active",
    assignments: partial.assignments ?? [],
  });
}

describe("runSkillCurator — happy path", () => {
  it("classifies, emits one signal per non-active finding, writes one report", async () => {
    addSkill({ skillId: "active-skill", skillMdContent: "body" });
    addSkill({ skillId: "stale-skill", skillMdContent: "body" });
    state.usageEvents.push({
      skillId: "active-skill",
      phase: "invoked",
      createdAt: new Date("2026-05-01"),
    });

    const report = await runSkillCurator({ invokedByUserId: "system" });

    // The stale skill produced a finding and a signal.
    expect(report.findings.find((f) => f.skillId === "stale-skill")?.toState).toBe("stale");
    expect(state.signalsTouched).toHaveLength(1);
    expect(state.signalsTouched[0]?.sourceType).toBe("curator-finding");
    expect(state.signalsTouched[0]?.sourceId).toBe("stale-skill:stale");

    // Exactly one TaskArtifact with the right metadata kind.
    expect(state.artifactsCreated).toHaveLength(1);
    expect(
      (state.artifactsCreated[0]?.metadata as { kind?: string })?.kind,
    ).toBe(CURATOR_REPORT_KIND);
  });
});

describe("runSkillCurator — pin protection invariant", () => {
  it("never updates a pinned skill (signal-only, no DB update)", async () => {
    addSkill({
      skillId: "pinned-skill",
      lifecycleState: "pinned",
      skillMdContent: "",
      assignments: [],
    });
    // Even with zero content + zero assignments + zero use, a pinned skill
    // would otherwise be a candidate to archive — but pin protection
    // overrides everything.

    const report = await runSkillCurator({ invokedByUserId: "system" });

    // No skill update was made for the pinned skill.
    expect(state.skillUpdates).toHaveLength(0);
    // The finding records that the state stayed pinned.
    const f = report.findings.find((x) => x.skillId === "pinned-skill");
    expect(f?.fromState).toBe("pinned");
    expect(f?.toState).toBe("pinned");
    expect(f?.changed).toBe(false);
    // Pinned/quarantined skills don't emit an ImprovementSignal because the
    // operator already chose this state; further signals would be noise.
    // Sanity: the only signals (if any) are for OTHER skills, not the pinned one.
    expect(
      state.signalsTouched.find(
        (s) => (s.sourceId as string)?.startsWith("pinned-skill:"),
      ),
    ).toBeUndefined();
  });

  it("never updates a quarantined skill either", async () => {
    addSkill({
      skillId: "q-skill",
      lifecycleState: "quarantined",
      skillMdContent: "body",
      assignments: [{ id: "a-1" }],
    });
    state.usageEvents.push({
      skillId: "q-skill",
      phase: "invoked",
      createdAt: new Date("2026-05-01"),
    });

    const report = await runSkillCurator({ invokedByUserId: "system" });
    expect(state.skillUpdates).toHaveLength(0);
    expect(report.findings.find((f) => f.skillId === "q-skill")?.toState).toBe(
      "quarantined",
    );
  });
});

describe("runSkillCurator — no skillMdContent mutation", () => {
  it("only writes lifecycleState in any skill update", async () => {
    addSkill({ skillId: "stale-skill" });

    await runSkillCurator({ invokedByUserId: "system" });

    // The curator may or may not produce an update on any given skill,
    // but every update it DOES produce must touch only lifecycleState.
    for (const upd of state.skillUpdates) {
      const keys = Object.keys(upd.data);
      expect(keys).toEqual(["lifecycleState"]);
      expect(keys).not.toContain("skillMdContent");
    }
  });
});

describe("runSkillCurator — dedupe", () => {
  it("re-running the curator over the same population produces the same signal sourceIds", async () => {
    addSkill({ skillId: "stale-skill" });

    await runSkillCurator({ invokedByUserId: "system" });
    const firstIds = state.signalsTouched.map((s) => s.sourceId);

    state.signalsTouched.length = 0;
    state.skillUpdates.length = 0;
    state.artifactsCreated.length = 0;
    state.taskRunsCreated.length = 0;

    await runSkillCurator({ invokedByUserId: "system" });
    const secondIds = state.signalsTouched.map((s) => s.sourceId);

    expect(secondIds).toEqual(firstIds);
    // The signal writer dedupes on (sourceType, sourceId); since both runs
    // emit the same sourceIds, re-running just increments recurrenceCount
    // rather than creating parallel signals. The curator itself doesn't
    // verify that — it's a contract of createOrTouchImprovementSignal.
  });
});

describe("runSkillCurator — empty population", () => {
  it("still writes a TaskRun + TaskArtifact with zero findings when no skills exist", async () => {
    const report = await runSkillCurator({ invokedByUserId: "system" });
    expect(report.findings).toEqual([]);
    expect(state.taskRunsCreated).toHaveLength(1);
    expect(state.artifactsCreated).toHaveLength(1);
  });
});

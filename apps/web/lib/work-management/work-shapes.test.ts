import { describe, expect, it } from "vitest";

import { parseStoredWorkroomCycle } from "./room-cycle-adapter";
import {
  OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY,
  WORK_SHAPE_TRIGGER_CLASSES,
  agentsWithDeclaredShape,
  getWorkShape,
  listWorkShapes,
  projectWorkShapeCycleBoundary,
  readWorkShapeDefinitionContract,
  validateWorkShape,
  type WorkShapeDefinition,
} from "./work-shapes";

describe("the §8.11 conformance rules", () => {
  it("holds for every registered shape", () => {
    expect(listWorkShapes().length).toBeGreaterThan(0);
    for (const shape of listWorkShapes()) {
      expect(validateWorkShape(shape), shape.key).toEqual([]);
    }
  });

  it("rejects a shape that can start itself and cannot stop itself", () => {
    const base = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const noFailureExit: WorkShapeDefinition = {
      ...base,
      stopConditions: base.stopConditions.filter((stop) => stop.kind !== "failure"),
    };
    expect(validateWorkShape(noFailureExit)).toContain(
      `${base.key}: no failure exit — only a successful one`,
    );
  });

  it("rejects a shape that can start itself and has no budget stop", () => {
    const base = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const noBudgetStop: WorkShapeDefinition = {
      ...base,
      stopConditions: base.stopConditions.filter((stop) => stop.kind !== "budget"),
    };
    expect(validateWorkShape(noBudgetStop)).toContain(
      `${base.key}: no budget stop — a self-starting shape without a spend ceiling is unbounded`,
    );
  });

  it("rejects a shape with no review point", () => {
    const base = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    expect(
      validateWorkShape({ ...base, reviewPoint: { everyDays: 0, description: "" } }),
    ).toContain(`${base.key}: no review point`);
  });

  it("rejects a trigger outside the §8.11.1 vocabulary", () => {
    const base = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const issues = validateWorkShape({
      ...base,
      triggers: ["whenever-it-feels-like-it"] as never,
    });
    expect(issues.join(" ")).toContain("outside the §8.11.1 vocabulary");
  });

  it("rejects a stage with no accountable principal", () => {
    const base = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const issues = validateWorkShape({
      ...base,
      stages: base.stages.map((stage) => ({ ...stage, accountablePrincipalRef: "" })),
    });
    expect(issues.join(" ")).toContain("no accountable principal");
  });
});

describe("the obligation assurance watch", () => {
  const shape = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;

  it("is triggered on a cadence AND on a deadline horizon", () => {
    expect(shape.triggers).toContain("cadence");
    expect(shape.triggers).toContain("deadline-horizon");
    for (const trigger of shape.triggers) {
      expect(WORK_SHAPE_TRIGGER_CLASSES).toContain(trigger);
    }
  });

  it("requires a governed decision to advance the response — not a status write", () => {
    const decide = shape.stages.find((stage) => stage.key === "decide")!;
    expect(decide.advance.kind).toBe("governed-decision");
    // The coworker sweeps and raises; a human-accountable role decides.
    expect(decide.accountablePrincipalRef).not.toMatch(/^agent:/);
  });

  it("names the compliance officer as accountable for the sweep", () => {
    expect(agentsWithDeclaredShape()).toContain("compliance-officer");
  });
});

describe("projection onto the existing room-cycle substrate", () => {
  it("emits a cycle boundary the room adapter already parses", () => {
    const shape = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const projected = projectWorkShapeCycleBoundary({
      shape,
      trigger: "deadline-horizon",
      startedAt: new Date("2026-08-21T00:00:00.000Z"),
    });

    const parsed = parseStoredWorkroomCycle(projected);
    expect(parsed).not.toBeNull();
    expect(parsed!.trigger).toBe("deadline-horizon:obligation-assurance-watch@1.0.0");
    expect(parsed!.accountablePrincipalRef).toBe("agent:compliance-officer");
    // Review point is carried as a real date, not left implicit.
    expect(parsed!.expectedReviewAt).toBe("2026-09-20T00:00:00.000Z");
    expect(parsed!.stopConditions.some((stop) => stop.startsWith("failure:"))).toBe(true);
  });
});

describe("the definition-level trigger/grant/measure contract (BI-EFFD97B4)", () => {
  it("exposes typed grants, measures, and budgets on the canonical shape — not a second table", () => {
    const shape = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const contract = readWorkShapeDefinitionContract(shape);
    expect(contract.key).toBe(shape.key);
    expect(contract.version).toBe(shape.version);
    expect(contract.triggers.length).toBeGreaterThan(0);
    expect(contract.grants).toEqual(expect.arrayContaining(["tool:read"]));
    expect(contract.measures.some((measure) => measure.key === "findings-raised")).toBe(true);
    expect(contract.budgets.some((budget) => budget.kind === "findings-per-run" && budget.limit === 200)).toBe(true);
    expect(contract.reviewPoint.everyDays).toBe(30);
    expect(contract.stopConditions.some((stop) => stop.kind === "budget")).toBe(true);
  });

  it("does not smuggle a dispatcher, scheduler, or roster onto the definition contract", () => {
    const shape = getWorkShape(OBLIGATION_ASSURANCE_WATCH_SHAPE_KEY)!;
    const contract = readWorkShapeDefinitionContract(shape);
    expect(contract).not.toHaveProperty("dispatch");
    expect(contract).not.toHaveProperty("schedule");
    expect(contract).not.toHaveProperty("participants");
  });
});

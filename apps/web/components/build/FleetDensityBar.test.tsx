import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FleetDensityBar } from "@/components/build/FleetDensityBar";
import type { BuildPlanDoc, TaskResult } from "@/lib/feature-build-types";

function plan(taskCount: number): BuildPlanDoc {
  return {
    fileStructure: [],
    tasks: Array.from({ length: taskCount }, (_, i) => ({
      title: `Task ${i + 1}`,
      testFirst: "",
      implement: "",
      verify: "",
    })),
  };
}

function result(title: string, passed: boolean): TaskResult {
  return {
    taskIndex: 0,
    title,
    testResult: { passed, output: "" },
    codeReview: { issues: [] } as unknown as TaskResult["codeReview"],
  };
}

describe("FleetDensityBar render gate", () => {
  it("renders nothing when buildPlan is null", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar taskResults={null} buildPlan={null} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when the plan has zero tasks", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar taskResults={null} buildPlan={plan(0)} />,
    );
    expect(html).toBe("");
  });

  it("renders the bar (0 done) even when taskResults is null — a started build with no results yet", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar taskResults={null} buildPlan={plan(8)} />,
    );
    expect(html).toContain('data-testid="fleet-density-bar"');
    expect(html).toContain('aria-label="Tasks: 0 of 8 done"');
    expect(html).toContain('data-done="0"');
    expect(html).toContain('data-total="8"');
  });
});

describe("FleetDensityBar counts", () => {
  it("counts passing results as done and sizes the fill proportionally", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar
        taskResults={[result("Task 1", true)]}
        buildPlan={plan(4)}
      />,
    );
    expect(html).toContain('aria-label="Tasks: 1 of 4 done"');
    // 1/4 → 25% done fill, no failed segment.
    expect(html).toContain("width:25%");
    expect(html).toContain("var(--dpf-success)");
    expect(html).not.toContain("var(--dpf-error)");
  });

  it("counts failing results separately and adds them to the label", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar
        taskResults={[result("Task 1", true), result("Task 2", false)]}
        buildPlan={plan(4)}
      />,
    );
    expect(html).toContain('aria-label="Tasks: 1 of 4 done, 1 failed"');
    expect(html).toContain('data-done="1"');
    expect(html).toContain('data-failed="1"');
    // Both a success and an error segment render.
    expect(html).toContain("var(--dpf-success)");
    expect(html).toContain("var(--dpf-error)");
  });

  it("dedupes a retried task by title — last result wins (fail → pass counts as done)", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar
        taskResults={[result("Task 1", false), result("Task 1", true)]}
        buildPlan={plan(4)}
      />,
    );
    // Only one entry for Task 1, and the later pass wins: 1 done, 0 failed.
    expect(html).toContain('data-done="1"');
    expect(html).toContain('data-failed="0"');
    expect(html).toContain('aria-label="Tasks: 1 of 4 done"');
  });

  it("widens the denominator when results exceed the plan length (segments never exceed 100%)", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar
        taskResults={[
          result("Task 1", true),
          result("Task 2", true),
          result("Task 3", true),
        ]}
        buildPlan={plan(2)}
      />,
    );
    // denom = max(2, 3) = 3 → 100% done; label still reports the plan total.
    expect(html).toContain('aria-label="Tasks: 3 of 2 done"');
    expect(html).toContain("width:100%");
  });

  it("renders a full bar when every task passes", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar
        taskResults={[result("Task 1", true), result("Task 2", true)]}
        buildPlan={plan(2)}
      />,
    );
    expect(html).toContain('aria-label="Tasks: 2 of 2 done"');
    expect(html).toContain("width:100%");
  });
});

describe("FleetDensityBar DPF token invariant", () => {
  it("renders no raw hex literals (uses only --dpf-* tokens)", () => {
    const html = renderToStaticMarkup(
      <FleetDensityBar
        taskResults={[result("Task 1", true), result("Task 2", false)]}
        buildPlan={plan(4)}
      />,
    );
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});

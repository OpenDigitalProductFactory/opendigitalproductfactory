// apps/web/components/build/AgentActivityStrip.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AgentActivityStrip } from "./AgentActivityStrip";
import type { FeatureBuildRow } from "@/lib/feature-build-types";

// Minimal FeatureBuildRow fixture for the strip's needs
function makeRow(overrides: Partial<FeatureBuildRow> = {}): FeatureBuildRow {
  return {
    buildId: "build-test-01",
    phase: "build",
    buildPlan: {
      fileStructure: [
        { path: "packages/db/prisma/schema.prisma", action: "modify", purpose: "add table" },
        { path: "apps/web/components/ui/Card.tsx", action: "create", purpose: "new component" },
        { path: "apps/web/components/ui/Card.test.tsx", action: "create", purpose: "unit test" },
        { path: "apps/web/lib/utils.ts", action: "create", purpose: "helper" },
        { path: "apps/web/app/page.tsx", action: "modify", purpose: "route" },
      ],
      tasks: [
        { title: "Extend schema", testFirst: "", implement: "", verify: "" },
        { title: "Create Card component", testFirst: "", implement: "", verify: "" },
        { title: "Wire route", testFirst: "", implement: "", verify: "" },
        { title: "Add utils helper", testFirst: "", implement: "", verify: "" },
        { title: "Write Card test", testFirst: "", implement: "", verify: "" },
      ],
    },
    taskResults: null,
    // satisfy remaining required fields with minimal values
    backlogItemId: null,
    orgId: "org-1",
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ideateOutput: null,
    planOutput: null,
    reviewOutput: null,
    verificationOut: null,
    acceptanceMet: null,
    planReview: null,
    buildExecState: null,
    reviewIterations: null,
    ...overrides,
  } as unknown as FeatureBuildRow;
}

describe("AgentActivityStrip render gate", () => {
  it("renders nothing when phase is not build", () => {
    const { container } = render(<AgentActivityStrip build={makeRow({ phase: "plan" })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when buildPlan is null", () => {
    const { container } = render(<AgentActivityStrip build={makeRow({ buildPlan: null })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when fewer than 5 tasks", () => {
    const row = makeRow();
    const shortPlan = { ...row.buildPlan!, tasks: row.buildPlan!.tasks.slice(0, 3) };
    const { container } = render(<AgentActivityStrip build={makeRow({ buildPlan: shortPlan })} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the strip when phase is build and has enough tasks", () => {
    render(<AgentActivityStrip build={makeRow()} />);
    expect(screen.getByTestId("agent-activity-strip")).toBeTruthy();
  });
});

describe("AgentActivityStrip cell state priority", () => {
  it("marks tasks with a passing taskResult as done", () => {
    const row = makeRow({
      taskResults: [
        { taskIndex: 0, title: "Extend schema", testResult: { passed: true, output: "" }, codeReview: { issues: [] } as any },
      ],
    });
    render(<AgentActivityStrip build={row} />);
    // The aria-label on each cell encodes state
    const cell = screen.getByRole("img", { name: /Extend schema: done/i });
    expect(cell).toBeTruthy();
  });

  it("marks tasks with a failing taskResult as failed", () => {
    const row = makeRow({
      taskResults: [
        { taskIndex: 1, title: "Create Card component", testResult: { passed: false, output: "fail" }, codeReview: { issues: [] } as any },
      ],
    });
    render(<AgentActivityStrip build={row} />);
    expect(screen.getByRole("img", { name: /Create Card component: failed/i })).toBeTruthy();
  });

  it("marks tasks with no result as queued initially", () => {
    render(<AgentActivityStrip build={makeRow()} />);
    // All 5 tasks have no results and no active events — all should be queued
    const cells = screen.getAllByRole("img", { name: /: queued/i });
    expect(cells.length).toBe(5);
  });

  it("transitions task to running on orchestrator:task_dispatched event", async () => {
    render(<AgentActivityStrip build={makeRow()} />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("build-progress-update", {
          detail: {
            type: "orchestrator:task_dispatched",
            buildId: "build-test-01",
            taskTitle: "Extend schema",
          },
        }),
      );
    });

    expect(screen.getByRole("img", { name: /Extend schema: running/i })).toBeTruthy();
  });

  it("ignores events for different builds", async () => {
    render(<AgentActivityStrip build={makeRow()} />);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("build-progress-update", {
          detail: {
            type: "orchestrator:task_dispatched",
            buildId: "other-build",
            taskTitle: "Extend schema",
          },
        }),
      );
    });

    // Should still be queued, not running
    expect(screen.getByRole("img", { name: /Extend schema: queued/i })).toBeTruthy();
  });

  it("transitions running task back to done when taskResult arrives on re-render", () => {
    const { rerender } = render(<AgentActivityStrip build={makeRow()} />);

    const withResult = makeRow({
      taskResults: [
        { taskIndex: 0, title: "Extend schema", testResult: { passed: true, output: "" }, codeReview: { issues: [] } as any },
      ],
    });
    rerender(<AgentActivityStrip build={withResult} />);

    expect(screen.getByRole("img", { name: /Extend schema: done/i })).toBeTruthy();
  });
});

describe("AgentActivityStrip meta label", () => {
  it("shows task count summary", () => {
    render(<AgentActivityStrip build={makeRow()} />);
    expect(screen.getByText(/0 \/ 5 tasks/)).toBeTruthy();
  });

  it("updates summary after tasks complete", () => {
    const row = makeRow({
      taskResults: [
        { taskIndex: 0, title: "Extend schema", testResult: { passed: true, output: "" }, codeReview: { issues: [] } as any },
        { taskIndex: 1, title: "Create Card component", testResult: { passed: true, output: "" }, codeReview: { issues: [] } as any },
      ],
    });
    render(<AgentActivityStrip build={row} />);
    expect(screen.getByText(/2 \/ 5 tasks/)).toBeTruthy();
  });
});

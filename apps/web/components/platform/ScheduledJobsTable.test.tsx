// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/ai-providers", () => ({
  runScheduledJobNow: vi.fn(),
  updateScheduledJob: vi.fn(),
}));
vi.mock("@/components/ui/LocalTime", () => ({
  LocalTime: ({ value, mode }: { value: Date | null; mode: string }) => (
    <span data-mode={mode}>{value?.toISOString() ?? "empty"}</span>
  ),
}));

import { ScheduledJobsTable } from "./ScheduledJobsTable";

describe("ScheduledJobsTable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders job instants through the hydration-safe date surface", () => {
    render(
      <ScheduledJobsTable
        canWrite={false}
        jobs={[{
          id: "job-row-1",
          jobId: "provider-registry-sync",
          name: "Provider registry sync",
          schedule: "daily",
          lastRunAt: new Date("2026-08-13T00:30:00.000Z"),
          nextRunAt: new Date("2026-08-14T00:30:00.000Z"),
          lastStatus: "ok",
          lastError: null,
        }]}
      />,
    );

    expect(screen.getByText("2026-08-13T00:30:00.000Z")).toHaveAttribute("data-mode", "date");
    expect(screen.getByText("2026-08-14T00:30:00.000Z")).toHaveAttribute("data-mode", "date");
  });
});

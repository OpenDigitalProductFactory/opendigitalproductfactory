import { describe, expect, it, vi } from "vitest";

import { runWorkPatternExperiment } from "./work-pattern-experiment";

describe("runWorkPatternExperiment", () => {
  it("resumes idempotently and skips terminal cells after interruption", async () => {
    const cells = [
      { taskRunId: "TR-1", status: "completed" },
      { taskRunId: "TR-2", status: "submitted" },
      { taskRunId: "TR-3", status: "working" },
    ];
    const executeCell = vi
      .fn()
      .mockResolvedValueOnce({ taskRunId: "TR-2", completed: true })
      .mockRejectedValueOnce(new Error("interrupted"));
    const transition = vi.fn();
    const analyze = vi.fn();

    await expect(
      runWorkPatternExperiment(
        { parentTaskRunId: "TR-PARENT" },
        {
          loadCells: vi.fn().mockResolvedValue(cells),
          executeCell,
          analyze,
          transition,
        },
      ),
    ).rejects.toThrow("interrupted");
    expect(executeCell.mock.calls.map(([cell]) => cell.taskRunId)).toEqual(["TR-2", "TR-3"]);

    cells[1]!.status = "completed";
    executeCell.mockReset().mockResolvedValue({ taskRunId: "TR-3", completed: true });
    await runWorkPatternExperiment(
      { parentTaskRunId: "TR-PARENT" },
      {
        loadCells: vi.fn().mockResolvedValue(cells),
        executeCell,
        analyze,
        transition,
      },
    );

    expect(executeCell).toHaveBeenCalledTimes(1);
    expect(executeCell).toHaveBeenCalledWith(cells[2]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(analyze).toHaveBeenCalledWith("TR-PARENT", cells);
    expect(transition.mock.calls.map((call) => call[1])).toEqual([
      "running",
      "running",
      "analyzing",
      "completed",
    ]);
  });
});

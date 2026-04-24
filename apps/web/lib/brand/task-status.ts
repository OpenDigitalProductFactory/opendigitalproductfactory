type TaskPayload = {
  task?: {
    taskId?: string;
    state?: string;
    progressPayload?: unknown;
  };
};

export type BrandExtractionTaskStatus =
  | { kind: "running"; taskRunId: string; stage: string; message: string; percent: number }
  | { kind: "complete"; taskRunId: string; summary: string }
  | { kind: "failed"; taskRunId: string; error: string }
  | { kind: "queued"; taskRunId: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function extractBrandExtractionStatusFromTaskResponse(
  payload: unknown,
): BrandExtractionTaskStatus | null {
  const task = isRecord(payload) && isRecord((payload as TaskPayload).task)
    ? (payload as TaskPayload).task
    : isRecord(payload)
      ? payload as TaskPayload["task"]
      : null;

  if (!task || typeof task.taskId !== "string" || typeof task.state !== "string") {
    return null;
  }

  const progress = isRecord(task.progressPayload) ? task.progressPayload : null;

  if (task.state === "completed") {
    return {
      kind: "complete",
      taskRunId: task.taskId,
      summary: typeof progress?.summary === "string" ? progress.summary : "Brand extraction complete.",
    };
  }

  if (task.state === "failed") {
    return {
      kind: "failed",
      taskRunId: task.taskId,
      error: typeof progress?.error === "string" ? progress.error : "Brand extraction failed.",
    };
  }

  if (task.state === "working") {
    return {
      kind: "running",
      taskRunId: task.taskId,
      stage: typeof progress?.stage === "string" ? progress.stage : "working",
      message: typeof progress?.message === "string" ? progress.message : "Working on your brand extraction.",
      percent: typeof progress?.percent === "number" ? progress.percent : 0,
    };
  }

  if (task.state === "submitted") {
    return {
      kind: "queued",
      taskRunId: task.taskId,
      message: typeof progress?.message === "string" ? progress.message : "Working on it — I'll update this panel as progress comes in.",
    };
  }

  return null;
}

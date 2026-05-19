import type { TruthNumericSnapshot } from "./progress-visibility-types";

export type NormalizedTaskResult = {
  taskIndex: number | null;
  title: string;
  specialist: string;
  outcome: string;
  durationMs: number | null;
  summary: string | null;
  files: string[];
};

export type NormalizedTaskResults = {
  completedTasks: number;
  totalTasks: number;
  tasks: NormalizedTaskResult[];
  source: TruthNumericSnapshot;
};

type JsonRecord = Record<string, unknown>;

const EMPTY_RESULTS: NormalizedTaskResults = {
  completedTasks: 0,
  totalTasks: 0,
  tasks: [],
  source: {
    source: "db-task-results",
    completed: 0,
    total: 0,
    observedAt: null,
  },
};

export function normalizeTaskResults(value: unknown): NormalizedTaskResults {
  if (Array.isArray(value)) {
    const tasks = value.map(normalizeLegacyTaskResult).filter((task): task is NormalizedTaskResult => task !== null);
    const completedTasks = countCompleted(tasks);
    return {
      completedTasks,
      totalTasks: tasks.length,
      tasks,
      source: {
        source: "db-task-results",
        completed: completedTasks,
        total: tasks.length,
        observedAt: null,
      },
    };
  }

  if (!isRecord(value)) {
    return EMPTY_RESULTS;
  }

  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  const tasks = rawTasks.map(normalizeTaskResult).filter((task): task is NormalizedTaskResult => task !== null);
  const completedTasks = numberOrNull(value.completedTasks) ?? countCompleted(tasks);
  const totalTasks = numberOrNull(value.totalTasks) ?? tasks.length;
  const observedAt = stringOrNull(value.timestamp) ?? stringOrNull(value.updatedAt);

  return {
    completedTasks,
    totalTasks,
    tasks,
    source: {
      source: "db-task-results",
      completed: completedTasks,
      total: totalTasks,
      observedAt,
    },
  };
}

function normalizeTaskResult(value: unknown, index: number): NormalizedTaskResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringOrNull(value.title);
  if (!title) {
    return null;
  }

  const taskIndex = numberOrNull(value.taskIndex) ?? index;
  const specialist = stringOrNull(value.specialist) ?? "unknown";
  const outcome = stringOrNull(value.outcome) ?? "UNKNOWN";
  const durationMs = numberOrNull(value.durationMs);
  const summary = stringOrNull(value.artifactSummary)
    ?? stringOrNull(value.summary)
    ?? stringOrNull(value.content);

  return {
    taskIndex,
    title,
    specialist,
    outcome,
    durationMs,
    summary,
    files: normalizeFiles(value.files),
  };
}

function normalizeLegacyTaskResult(value: unknown, index: number): NormalizedTaskResult | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringOrNull(value.title) ?? `Task ${numberOrNull(value.taskIndex) ?? index}`;
  const testResult = isRecord(value.testResult) ? value.testResult : null;
  const codeReview = isRecord(value.codeReview) ? value.codeReview : null;
  const testPassed = testResult ? valueAsBoolean(testResult.passed) : false;
  const reviewPassed = codeReview ? codeReview.decision === "pass" : false;

  return {
    taskIndex: numberOrNull(value.taskIndex) ?? index,
    title,
    specialist: stringOrNull(value.specialist) ?? "software-engineer",
    outcome: testPassed && reviewPassed ? "DONE" : stringOrNull(value.outcome) ?? "BLOCKED",
    durationMs: numberOrNull(value.durationMs),
    summary: stringOrNull(value.content) ?? stringOrNull(value.summary),
    files: normalizeFiles(value.files),
  };
}

function normalizeFiles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (isRecord(item)) {
        return stringOrNull(item.path);
      }
      return null;
    })
    .filter((path): path is string => Boolean(path));
}

function countCompleted(tasks: NormalizedTaskResult[]): number {
  return tasks.filter((task) => task.outcome === "DONE" || task.outcome === "DONE_WITH_CONCERNS").length;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valueAsBoolean(value: unknown): boolean {
  return value === true;
}

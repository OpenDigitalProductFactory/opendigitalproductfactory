// apps/web/lib/integrate/task-dependency-graph.ts
// Pure function: plan structure -> ordered execution phases with parallel groups.
// No DB imports. No side effects. Fully testable.

export type PlanFileEntry = {
  path: string;
  action: "create" | "modify";
  purpose: string;
};

export type PlanTask = {
  title: string;
  testFirst: string;
  implement: string;
  verify: string;
};

export type SpecialistRole = "data-architect" | "software-engineer" | "frontend-engineer" | "qa-engineer";

export type AssignedTask = {
  taskIndex: number;
  title: string;
  specialist: SpecialistRole;
  files: PlanFileEntry[];
  task: PlanTask;
};

export type ExecutionPhase = {
  phaseIndex: number;
  parallel: boolean;
  tasks: AssignedTask[];
};

// --- Specialist Assignment ---------------------------------------------------

const SCHEMA_PATTERNS = [/packages\/db\/prisma\//i, /\.prisma$/i, /migration/i];
const API_PATTERNS = [/app\/api\//i, /actions\//i, /server-action/i, /lib\/.*(?:action|service)/i];
const FRONTEND_PATTERNS = [/components?\//i, /app\/\(shell\)\//i, /\.tsx$/i, /\.css$/i];

function classifyFile(path: string): SpecialistRole {
  if (SCHEMA_PATTERNS.some(p => p.test(path))) return "data-architect";
  if (API_PATTERNS.some(p => p.test(path))) return "software-engineer";
  if (FRONTEND_PATTERNS.some(p => p.test(path))) return "frontend-engineer";
  // Default: software-engineer handles misc files (lib utilities, configs, etc.)
  return "software-engineer";
}

function assignSpecialist(task: PlanTask, taskIndex: number, files: PlanFileEntry[]): AssignedTask {
  // Match task to files by index (plan tasks align 1:1 with file groups)
  // or by title keyword matching as fallback
  const taskFiles = files.filter((_f, i) => i === taskIndex) || [];
  const specialist = taskFiles.length > 0
    ? classifyFile(taskFiles[0]!.path)
    : classifyFromTitle(task.title);

  return { taskIndex, title: task.title, specialist, files: taskFiles, task };
}

function classifyFromTitle(title: string): SpecialistRole {
  const lower = title.toLowerCase();
  if (lower.includes("schema") || lower.includes("model") || lower.includes("migration") || lower.includes("database")) return "data-architect";
  if (lower.includes("api") || lower.includes("route") || lower.includes("action") || lower.includes("endpoint")) return "software-engineer";
  if (lower.includes("ui") || lower.includes("page") || lower.includes("component") || lower.includes("frontend") || lower.includes("layout")) return "frontend-engineer";
  if (lower.includes("test") || lower.includes("verify") || lower.includes("typecheck")) return "qa-engineer";
  return "software-engineer";
}

// --- Dependency Ordering -----------------------------------------------------

const ROLE_PRIORITY: Record<SpecialistRole, number> = {
  "data-architect": 0,    // Schema first -- everything depends on models
  "software-engineer": 1, // API routes depend on schema
  "frontend-engineer": 2, // Frontend depends on API types
  "qa-engineer": 3,       // Tests run after all code generation
};

/**
 * Build a dependency-aware execution plan from the build plan's file structure and tasks.
 *
 * Rules:
 * 1. Tasks are assigned to specialists based on file paths
 * 2. Tasks are grouped by specialist priority level (schema -> API -> frontend)
 * 3. Tasks at the same priority level run in parallel UNLESS they touch the same file
 * 4. A QA phase is always appended at the end
 */
export function buildDependencyGraph(
  files: PlanFileEntry[],
  tasks: PlanTask[],
): ExecutionPhase[] {
  // Assign specialists to tasks
  const assigned = tasks.map((task, i) => assignSpecialist(task, i, files));

  // Group by priority level
  const byPriority = new Map<number, AssignedTask[]>();
  for (const task of assigned) {
    if (task.specialist === "qa-engineer") continue; // QA always goes last
    const priority = ROLE_PRIORITY[task.specialist];
    const group = byPriority.get(priority) ?? [];
    group.push(task);
    byPriority.set(priority, group);
  }

  // Build phases -- split groups that have file overlaps
  const phases: ExecutionPhase[] = [];
  const sortedPriorities = [...byPriority.keys()].sort((a, b) => a - b);

  for (const priority of sortedPriorities) {
    const group = byPriority.get(priority)!;
    const subPhases = splitByFileOverlap(group);
    for (const sub of subPhases) {
      phases.push({
        phaseIndex: phases.length,
        parallel: sub.length > 1,
        tasks: sub,
      });
    }
  }

  // Always append QA phase
  phases.push({
    phaseIndex: phases.length,
    parallel: false,
    tasks: [{
      taskIndex: -1, // Synthetic task -- not from the plan
      title: "Full verification: tests + typecheck",
      specialist: "qa-engineer",
      files: [],
      task: { title: "Full verification", testFirst: "", implement: "", verify: "run_sandbox_tests + tsc --noEmit" },
    }],
  });

  return phases;
}

/**
 * Split a group of tasks into sub-groups where tasks with overlapping file
 * targets are in separate sub-groups (sequential), and non-overlapping tasks
 * are in the same sub-group (parallel).
 */
function splitByFileOverlap(tasks: AssignedTask[]): AssignedTask[][] {
  if (tasks.length <= 1) return [tasks];

  const result: AssignedTask[][] = [];
  const usedPaths = new Set<string>();

  let currentBatch: AssignedTask[] = [];

  for (const task of tasks) {
    const taskPaths = task.files.map(f => f.path);
    const hasOverlap = taskPaths.some(p => usedPaths.has(p));

    if (hasOverlap) {
      // Flush current batch, start new one
      if (currentBatch.length > 0) result.push(currentBatch);
      currentBatch = [task];
      usedPaths.clear();
      taskPaths.forEach(p => usedPaths.add(p));
    } else {
      currentBatch.push(task);
      taskPaths.forEach(p => usedPaths.add(p));
    }
  }

  if (currentBatch.length > 0) result.push(currentBatch);
  return result;
}

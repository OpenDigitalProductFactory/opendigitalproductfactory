// apps/web/lib/build/task-dependency-graph.ts
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

export type SpecialistRole =
  | "data-architect"
  | "software-engineer"
  | "frontend-engineer"
  | "documentation-specialist"
  | "qa-engineer";

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

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizePlanFileEntry(value: unknown): PlanFileEntry | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const path = stringField(row.path).trim();
  if (!path) return null;

  const action = row.action === "create" || row.action === "modify"
    ? row.action
    : "modify";
  const purpose = stringField(row.purpose).trim() || stringField(row.change).trim();

  return { path, action, purpose };
}

function normalizePlanTask(value: unknown, index: number): PlanTask | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = stringField(row.title).trim() || `Task ${index + 1}`;

  return {
    title,
    testFirst: stringField(row.testFirst),
    implement: stringField(row.implement) || stringField(row.change),
    verify: stringField(row.verify) || stringField(row.acceptanceCriterion),
  };
}

// --- Specialist Assignment ---------------------------------------------------

const SCHEMA_PATTERNS = [/packages\/db\/prisma\//i, /\.prisma$/i, /migration/i];
const API_PATTERNS = [/app\/api\//i, /actions\//i, /server-action/i, /lib\/.*(?:action|service)/i];
const FRONTEND_PATTERNS = [/components?\//i, /app\/\(shell\)\//i, /\.tsx$/i, /\.css$/i];
const DOCUMENTATION_PATTERNS = [
  /^docs\//i,
  /(?:^|\/)README\.md$/i,
  /^AGENTS\.md$/i,
  /^prompts\//i,
  /^packages\/db\/data\/agent_registry\.json$/i,
];

function classifyFile(path: string): SpecialistRole {
  if (DOCUMENTATION_PATTERNS.some(p => p.test(path))) return "documentation-specialist";
  if (SCHEMA_PATTERNS.some(p => p.test(path))) return "data-architect";
  if (API_PATTERNS.some(p => p.test(path))) return "software-engineer";
  if (FRONTEND_PATTERNS.some(p => p.test(path))) return "frontend-engineer";
  // Default: software-engineer handles misc files (lib utilities, configs, etc.)
  return "software-engineer";
}

function assignSpecialist(task: PlanTask, taskIndex: number, files: PlanFileEntry[]): AssignedTask {
  // Match task to files by scanning file purposes/paths for keywords from the task title.
  // Falls back to title-based classification if no files match.
  const titleLower = task.title.toLowerCase();
  const titleWords = titleLower.split(/\s+/).filter(w => w.length > 3);
  const taskFiles = files.filter(f => {
    const purposeLower = f.purpose.toLowerCase();
    const pathLower = f.path.toLowerCase();
    return titleWords.some(w => purposeLower.includes(w) || pathLower.includes(w));
  });

  // Classify by the matched files, or fall back to title keywords
  const heuristicSpecialist = classifyFromTask(task);
  const specialist = taskFiles.length > 0
    ? heuristicSpecialist === "qa-engineer"
      ? "qa-engineer"
      : classifyFile(taskFiles[0]!.path)
    : heuristicSpecialist;

  return { taskIndex, title: task.title, specialist, files: taskFiles, task };
}

function classifyFromTask(task: PlanTask): SpecialistRole {
  const lower = [
    task.title,
    task.testFirst,
    task.implement,
    task.verify,
  ].join(" ").toLowerCase();

  if (
    lower.includes("documentation")
    || lower.includes("docs")
    || lower.includes("user guide")
    || lower.includes("public site")
    || lower.includes("readme")
    || lower.includes("release note")
    || lower.includes("operator guide")
    || lower.includes("docs impact")
    || lower.includes("no-docs-needed")
  ) {
    return "documentation-specialist";
  }
  if (lower.includes("schema") || lower.includes("model") || lower.includes("migration") || lower.includes("database")) return "data-architect";
  if (lower.includes("api") || lower.includes("route") || lower.includes("action") || lower.includes("endpoint")) return "software-engineer";
  if (lower.includes("ui") || lower.includes("page") || lower.includes("component") || lower.includes("frontend") || lower.includes("layout")) return "frontend-engineer";
  if (
    lower.includes("test")
    || lower.includes("verify")
    || lower.includes("typecheck")
    || lower.includes("regression")
    || lower.includes("acceptance criteria")
    || lower.includes("manual desktop checks")
    || lower.includes("200% zoom")
    || lower.includes("reflow")
    || lower.includes("accessibility")
  ) {
    return "qa-engineer";
  }
  return "software-engineer";
}

// --- Redundant verification task pruning -------------------------------------
//
// buildDependencyGraph ALWAYS appends a synthetic QA phase ("Full verification:
// tests + typecheck", run via scoped run_sandbox_tests). When the LLM planner
// ALSO emits explicit "run the full test suite" / "full verification" tasks, the
// build runs the whole monorepo suite redundantly — slow, brittle, and the exact
// over-decomposition that let an unrelated broken test stall FB-69231490. Those
// tasks duplicate the synthetic QA phase, so prune them.

const FULL_SUITE_VERIFICATION_PATTERNS: RegExp[] = [
  /\bfull(?:\s+|-)test\s+suite\b/i,
  /\bentire\s+test\s+suite\b/i,
  /\brun\s+(?:the\s+)?(?:full|entire|all|complete|whole)\s+(?:test\s+suite|tests)\b/i,
  /\bfull\s+verification\b/i,
  /\bpnpm\s+(?:-r\s+|--filter\s+\S+\s+)?test\b/i,
  /\bregression\s+suite\b/i,
];

/**
 * True when a planner task merely re-runs the whole suite / re-verifies — work
 * the always-appended synthetic QA phase already does. Pure + testable.
 */
export function isRedundantVerificationTask(task: PlanTask): boolean {
  const text = [task.title, task.testFirst, task.implement, task.verify].join(" ");
  return FULL_SUITE_VERIFICATION_PATTERNS.some((p) => p.test(text));
}

// --- Dependency Ordering -----------------------------------------------------

const ROLE_PRIORITY: Record<SpecialistRole, number> = {
  "data-architect": 0,    // Schema first -- everything depends on models
  "software-engineer": 1, // API routes depend on schema
  "frontend-engineer": 2, // Frontend depends on API types
  "documentation-specialist": 3, // Docs read the final implementation before QA
  "qa-engineer": 4,       // Tests run after all code generation and doc updates
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
  files: PlanFileEntry[] | null | undefined,
  tasks: PlanTask[],
): ExecutionPhase[] {
  // Tolerate partial/legacy JSON shapes. BuildPlanDoc is stricter than the
  // Prisma JSON column, and stored plans can contain `{ path, change }` file
  // entries or task rows without every optional planning field.
  const safeFiles = Array.isArray(files)
    ? files.flatMap((file) => {
        const normalized = normalizePlanFileEntry(file);
        return normalized ? [normalized] : [];
      })
    : [];
  const safeTasks = Array.isArray(tasks)
    ? tasks.flatMap((task, index) => {
        const normalized = normalizePlanTask(task, index);
        return normalized ? [normalized] : [];
      })
    : [];

  // Prune redundant full-suite/verification tasks — the synthetic QA phase
  // below always runs scoped verification, so these only add slow, brittle
  // whole-monorepo runs. Right-sizes an over-decomposed plan.
  const prunableTasks = safeTasks.filter((task) => !isRedundantVerificationTask(task));
  const prunedCount = safeTasks.length - prunableTasks.length;
  if (prunedCount > 0) {
    console.log(
      `[task-graph] pruned ${prunedCount} redundant full-suite/verification task(s); the synthetic QA phase covers verification.`,
    );
  }

  // Assign specialists to tasks
  const assigned = prunableTasks.map((task, i) => assignSpecialist(task, i, safeFiles));

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

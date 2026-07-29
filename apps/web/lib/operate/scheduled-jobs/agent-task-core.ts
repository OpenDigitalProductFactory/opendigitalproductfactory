// Scheduled-agent-task management core (BI-1C44A93A).
//
// The create / list / cancel logic for recurring agent tasks lives here,
// EXPLICITLY userId-parameterized and NOT marked "use server", so it can be
// shared by two callers with different identity sources without either letting a
// caller spoof a user:
//   - the web server actions (apps/web/lib/actions/agent-task-scheduler.ts)
//     resolve userId from auth() and delegate here;
//   - the MCP tools (apps/web/lib/mcp-tools.ts) pass the MCP-authenticated
//     userId (the tool layer already gated scope + grants).
// A "use server" file exports only client-callable actions, so a userId
// parameter there would be client-spoofable — hence this separate core.

import { Prisma, prisma } from "@dpf/db";
import { randomUUID } from "crypto";
import { SCHEDULING_MAP } from "@/lib/operate/scheduled-jobs/scheduling-map";
import { occupiedTicks, deconflictCron } from "@/lib/operate/scheduled-jobs/scheduling-allocator";
import { computeNextCronRun } from "@/lib/operate/cron-next-run";
import {
  ProductIntelligenceScopeError,
  assertProductIntelligenceScopeExists,
  normalizeProductIntelligenceScope,
  type ProductIntelligenceScopeInput,
} from "@/lib/product-management/product-intelligence-scope";
import {
  isScheduledAgentTaskKind,
  type ScheduledAgentTaskKind,
} from "./agent-task-kind";
import {
  PRODUCT_INTELLIGENCE_WATCH_TASK_KIND,
  parseProductIntelligenceWatchConfig,
} from "@/lib/product-management/product-intelligence-watch-contract";
import {
  PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
  getProductManagementPlaybook,
  parseProductManagementPlaybookConfig,
  productManagementPlaybookScopeKind,
} from "@/lib/product-management/product-management-playbook";

export type ScheduleAgentTaskInput = {
  agentId: string;
  title: string;
  prompt: string;
  routeContext: string;
  /** Cron expression (5-field). */
  schedule: string;
  timezone?: string;
  /** Omit all three fields for a generic user-owned task. */
  organizationId?: string | null;
  productLineId?: string | null;
  businessProductId?: string | null;
  /** Typed discriminator/config for deterministic scheduler branches. */
  taskKind?: ScheduledAgentTaskKind | null;
  taskConfig?: Record<string, unknown> | null;
};

export type ScheduleAgentTaskResult =
  | { success: true; taskId: string; note?: string }
  | { success: false; error: string };

export type ScheduledAgentTaskView = {
  taskId: string;
  agentId: string;
  title: string;
  prompt: string;
  schedule: string;
  isActive: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  organizationId: string | null;
  productLineId: string | null;
  businessProductId: string | null;
  taskKind: ScheduledAgentTaskKind | null;
  taskConfig: unknown;
};

function scheduleScopeData(input: ScheduleAgentTaskInput) {
  const hasProductScope =
    input.organizationId !== undefined ||
    input.productLineId !== undefined ||
    input.businessProductId !== undefined;
  if (!hasProductScope) {
    return null;
  }
  return normalizeProductIntelligenceScope({
    organizationId: input.organizationId ?? "",
    productLineId: input.productLineId,
    businessProductId: input.businessProductId,
  });
}

/**
 * Create a recurring agent task owned by `userId`. De-conflicts the cron tick at
 * creation (BI-SCHED-ALLOCATE) and registers a mirror ScheduledJob row so the
 * task shows up in calendar projections. Caller is responsible for authorizing
 * `userId` (auth() in the web action; scope+grant gate in the MCP tool).
 */
export async function scheduleAgentTaskFor(
  userId: string,
  input: ScheduleAgentTaskInput,
): Promise<ScheduleAgentTaskResult> {
  if (input.taskKind != null && !isScheduledAgentTaskKind(input.taskKind)) {
    return { success: false, error: "Unsupported scheduled agent task kind." };
  }
  if (input.timezone && input.timezone !== "UTC") {
    return {
      success: false,
      error: "Non-UTC timezones are not yet supported. All schedules run in UTC.",
    };
  }

  let productScope: ReturnType<typeof scheduleScopeData>;
  try {
    productScope = scheduleScopeData(input);
    if (productScope) {
      await assertProductIntelligenceScopeExists(productScope, prisma);
    }
  } catch (error) {
    if (error instanceof ProductIntelligenceScopeError) {
      return { success: false, error: error.message };
    }
    throw error;
  }
  if (input.taskKind === PRODUCT_INTELLIGENCE_WATCH_TASK_KIND) {
    if (!productScope) {
      return {
        success: false,
        error: "Product intelligence watches require an organization scope.",
      };
    }
    try {
      parseProductIntelligenceWatchConfig(input.taskConfig);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Invalid product intelligence watch configuration.",
      };
    }
  }
  if (input.taskKind === PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND) {
    if (!productScope) {
      return {
        success: false,
        error:
          "Product-management playbooks require an organization scope.",
      };
    }
    try {
      const config = parseProductManagementPlaybookConfig(input.taskConfig);
      const recipe = getProductManagementPlaybook(config.recipeId);
      const scopeKind = productManagementPlaybookScopeKind(productScope.kind);
      if (!recipe.supportedScopes.includes(scopeKind)) {
        return {
          success: false,
          error: `${recipe.label} does not support ${scopeKind} scope.`,
        };
      }
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Invalid product-management playbook configuration.",
      };
    }
  }

  const taskId = `agent-task-${randomUUID().slice(0, 8)}`;
  const now = new Date();

  // De-conflict at creation so a new task does not pile onto a tick already in
  // use (canonical scheduling map + other live agent tasks). Interval cadences
  // pass through untouched.
  const liveTasks = await prisma.scheduledAgentTask.findMany({
    where: { isActive: true },
    select: { schedule: true },
  });
  const occupied = occupiedTicks([
    ...SCHEDULING_MAP.map((e) => e.cron),
    ...liveTasks.map((t) => t.schedule),
  ]);
  const { cron: schedule, note } = deconflictCron(input.schedule, occupied);

  const nextRunAt = computeNextCronRun(schedule, now);

  await prisma.scheduledAgentTask.create({
    data: {
      taskId,
      agentId: input.agentId,
      title: input.title,
      prompt: input.prompt,
      routeContext: input.routeContext,
      schedule,
      timezone: input.timezone ?? "UTC",
      ownerUserId: userId,
      organizationId: productScope?.organizationId ?? null,
      productLineId: productScope?.productLineId ?? null,
      businessProductId: productScope?.businessProductId ?? null,
      taskKind: input.taskKind ?? null,
      taskConfig:
        input.taskConfig === undefined
          ? undefined
          : (input.taskConfig as Prisma.InputJsonValue),
      nextRunAt,
    },
  });

  // Mirror as a ScheduledJob so it appears in calendar projections.
  await prisma.scheduledJob.upsert({
    where: { jobId: taskId },
    create: { jobId: taskId, name: `Agent: ${input.title}`, schedule, nextRunAt },
    update: { name: `Agent: ${input.title}`, schedule, nextRunAt },
  });

  return note ? { success: true, taskId, note } : { success: true, taskId };
}

/** List the recurring agent tasks owned by `userId`, newest first. */
export async function getScheduledAgentTasksFor(
  userId: string,
  scope?: Omit<ProductIntelligenceScopeInput, "digitalProductId">,
): Promise<ScheduledAgentTaskView[]> {
  const normalizedScope = scope ? normalizeProductIntelligenceScope(scope) : null;
  const tasks = await prisma.scheduledAgentTask.findMany({
    where: {
      ownerUserId: userId,
      ...(normalizedScope
        ? {
            organizationId: normalizedScope.organizationId,
            productLineId: normalizedScope.productLineId,
            businessProductId: normalizedScope.businessProductId,
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      taskId: true,
      agentId: true,
      title: true,
      prompt: true,
      schedule: true,
      isActive: true,
      nextRunAt: true,
      lastRunAt: true,
      lastStatus: true,
      organizationId: true,
      productLineId: true,
      businessProductId: true,
      taskKind: true,
      taskConfig: true,
    },
  });

  return tasks.map((t) => ({
    ...t,
    taskKind: isScheduledAgentTaskKind(t.taskKind) ? t.taskKind : null,
    nextRunAt: t.nextRunAt?.toISOString() ?? null,
    lastRunAt: t.lastRunAt?.toISOString() ?? null,
  }));
}

/**
 * Deactivate a recurring agent task. Ownership-checked: only the owning `userId`
 * may cancel it (so an MCP caller cannot cancel another user's task by id).
 */
export async function cancelAgentTaskFor(
  userId: string,
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  return setAgentTaskActiveFor(userId, taskId, false);
}

export async function setAgentTaskActiveFor(
  userId: string,
  taskId: string,
  isActive: boolean,
): Promise<{ success: boolean; error?: string }> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
    select: { ownerUserId: true, schedule: true },
  });
  if (!task) return { success: false, error: "Scheduled agent task not found" };
  if (task.ownerUserId !== userId) {
    return { success: false, error: "Not authorized to change this scheduled agent task" };
  }

  const nextRunAt = isActive ? computeNextCronRun(task.schedule, new Date()) : null;
  await prisma.scheduledAgentTask.update({
    where: { taskId },
    data: { isActive, nextRunAt },
  });
  await prisma.scheduledJob
    .update({
      where: { jobId: taskId },
      data: {
        schedule: isActive ? task.schedule : "disabled",
        nextRunAt,
      },
    })
    .catch(() => {});

  return { success: true };
}

export async function rerunAgentTaskFor(
  userId: string,
  taskId: string,
): Promise<{ success: boolean; error?: string }> {
  const task = await prisma.scheduledAgentTask.findUnique({
    where: { taskId },
    select: { ownerUserId: true, schedule: true },
  });
  if (!task) return { success: false, error: "Scheduled agent task not found" };
  if (task.ownerUserId !== userId) {
    return { success: false, error: "Not authorized to rerun this scheduled agent task" };
  }

  const nextRunAt = new Date();
  await prisma.scheduledAgentTask.update({
    where: { taskId },
    data: { isActive: true, nextRunAt },
  });
  await prisma.scheduledJob
    .update({
      where: { jobId: taskId },
      data: { schedule: task.schedule, nextRunAt },
    })
    .catch(() => {});
  return { success: true };
}

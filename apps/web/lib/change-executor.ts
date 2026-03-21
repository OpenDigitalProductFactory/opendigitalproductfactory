"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import { executeRollback, type RollbackResult } from "./rollback-strategies";

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireOpsAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_operations"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HealthCheckResult {
  healthy: boolean;
  message: string;
}

export interface ChangeItemResult {
  changeItemId: string;
  status: "completed" | "failed" | "rolled-back" | "skipped";
  message: string;
}

export interface ExecutionResult {
  success: boolean;
  results: ChangeItemResult[];
  rollbackTriggered: boolean;
}

// ─── Health Check ────────────────────────────────────────────────────────────

export async function runHealthCheck(
  entityId: string
): Promise<HealthCheckResult> {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    select: { properties: true },
  });

  if (!entity) {
    return { healthy: true, message: `Entity ${entityId} not found — skipping health check` };
  }

  const properties = entity.properties as Record<string, unknown> | null;
  const healthEndpoint = properties?.healthEndpoint as string | undefined;

  if (!healthEndpoint) {
    return { healthy: true, message: "No health endpoint configured — assumed healthy" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(healthEndpoint, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return { healthy: true, message: `Health check passed (${response.status})` };
    }

    return {
      healthy: false,
      message: `Health check failed: HTTP ${response.status}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      healthy: false,
      message: `Health check error: ${msg}`,
    };
  }
}

// ─── Change Execution Engine ─────────────────────────────────────────────────

export async function executeChangeItems(
  rfcId: string
): Promise<ExecutionResult> {
  await requireOpsAccess();

  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: {
      changeItems: {
        orderBy: { executionOrder: "asc" },
      },
    },
  });

  if (!rfc) {
    throw new Error(`RFC not found: ${rfcId}`);
  }

  if (rfc.status !== "in-progress") {
    throw new Error(
      `RFC must be in "in-progress" status to execute. Current status: "${rfc.status}"`
    );
  }

  const results: ChangeItemResult[] = [];
  const completedItemIds: string[] = [];

  for (const item of rfc.changeItems) {
    if (item.status !== "pending") {
      results.push({
        changeItemId: item.id,
        status: "skipped",
        message: `Skipped — already in "${item.status}" status`,
      });
      continue;
    }

    try {
      // Mark item as in-progress
      await prisma.changeItem.update({
        where: { id: item.id },
        data: { status: "in-progress" },
      });

      // Execute the change (stub — actual type-specific executors come later)
      await prisma.changeItem.update({
        where: { id: item.id },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });

      completedItemIds.push(item.id);

      results.push({
        changeItemId: item.id,
        status: "completed",
        message: "Change item executed successfully",
      });

      // Health gate: check entity health after each item
      if (item.inventoryEntityId) {
        const healthResult = await runHealthCheck(item.inventoryEntityId);

        if (!healthResult.healthy) {
          // Health check failed — rollback completed items in reverse order
          const rollbackResults = await rollbackCompletedItems(
            completedItemIds,
            healthResult.message
          );

          // Mark remaining items as skipped
          const remainingItems = rfc.changeItems.slice(
            rfc.changeItems.indexOf(item) + 1
          );
          for (const remaining of remainingItems) {
            if (remaining.status === "pending") {
              results.push({
                changeItemId: remaining.id,
                status: "skipped",
                message: `Skipped — rollback triggered by health check failure on ${item.id}`,
              });
            }
          }

          // Update RFC to rolled-back
          await prisma.changeRequest.update({
            where: { rfcId },
            data: {
              status: "rolled-back",
              outcome: "rolled-back",
              outcomeNotes: `Health check failed after item ${item.id}: ${healthResult.message}`,
            },
          });

          revalidatePath("/ops");

          return {
            success: false,
            results,
            rollbackTriggered: true,
          };
        }
      }
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);

      results.push({
        changeItemId: item.id,
        status: "failed",
        message: `Execution error: ${errorMsg}`,
      });

      // Rollback completed items in reverse order
      await rollbackCompletedItems(completedItemIds, errorMsg);

      // Mark remaining items as skipped
      const currentIndex = rfc.changeItems.indexOf(item);
      const remainingItems = rfc.changeItems.slice(currentIndex + 1);
      for (const remaining of remainingItems) {
        if (remaining.status === "pending") {
          results.push({
            changeItemId: remaining.id,
            status: "skipped",
            message: `Skipped — rollback triggered by execution failure on ${item.id}`,
          });
        }
      }

      // Update RFC to rolled-back
      await prisma.changeRequest.update({
        where: { rfcId },
        data: {
          status: "rolled-back",
          outcome: "rolled-back",
          outcomeNotes: `Execution failed on item ${item.id}: ${errorMsg}`,
        },
      });

      revalidatePath("/ops");

      return {
        success: false,
        results,
        rollbackTriggered: true,
      };
    }
  }

  // All items completed successfully
  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "completed",
      completedAt: new Date(),
      outcome: "success",
    },
  });

  revalidatePath("/ops");

  return {
    success: true,
    results,
    rollbackTriggered: false,
  };
}

// ─── Internal: Rollback completed items in reverse order ─────────────────────

async function rollbackCompletedItems(
  completedItemIds: string[],
  reason: string
): Promise<RollbackResult[]> {
  const results: RollbackResult[] = [];
  // Reverse order — last completed item rolled back first
  for (const itemId of [...completedItemIds].reverse()) {
    const result = await executeRollback(itemId);
    results.push(result);
  }
  return results;
}

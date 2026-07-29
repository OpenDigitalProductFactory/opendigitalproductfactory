"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  loadCurrentProductOperatingContextByKey,
} from "@/lib/product-management/current-product-operating-context.server";
import {
  PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
  isProductManagementPlaybookId,
  productManagementPlaybookScopeKind,
} from "@/lib/product-management/product-management-playbook";
import { scheduleAgentTaskFor } from "@/lib/operate/scheduled-jobs/agent-task-core";
import type { ProductOperatingScope } from "@/lib/product-management/product-operating-context";

type ScheduleProductManagementPlaybookInput = {
  scope: ProductOperatingScope;
  recipeId: string;
  approvedPermissionsDigest: string;
  schedule: string;
};

type ProductManagementPlaybookActionResult =
  | { ok: true; taskId: string; message: string }
  | { ok: false; error: string };

function routeFor(scope: ProductOperatingScope): string {
  if (scope.kind === "product") {
    return `/portfolio/product/${encodeURIComponent(scope.id)}/direction`;
  }
  if (scope.kind === "product-line") {
    return `/portfolio/product-line/${encodeURIComponent(scope.id)}/direction`;
  }
  return "/portfolio";
}

function cleanCron(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (cleaned.split(" ").length !== 5 || cleaned.length > 100) {
    throw new Error("Choose a valid five-field UTC schedule.");
  }
  return cleaned;
}

export async function scheduleProductManagementPlaybookAction(
  input: ScheduleProductManagementPlaybookInput,
): Promise<ProductManagementPlaybookActionResult> {
  try {
    const session = await auth();
    if (!session?.user?.id) return { ok: false, error: "Unauthorized" };
    if (!isProductManagementPlaybookId(input.recipeId)) {
      return { ok: false, error: "Unknown product-management playbook." };
    }
    const recipe = getProductManagementPlaybook(input.recipeId);
    const permissionDigest = buildPlaybookPermissionDigest(recipe);
    if (input.approvedPermissionsDigest !== permissionDigest) {
      return {
        ok: false,
        error:
          "This playbook's permission or write scope changed. Preview it again before scheduling.",
      };
    }
    const context = await loadCurrentProductOperatingContextByKey(
      input.scope.kind,
      input.scope.id,
    );
    const scopeKind = productManagementPlaybookScopeKind(context.scope.kind);
    if (!recipe.supportedScopes.includes(scopeKind)) {
      return {
        ok: false,
        error: `${recipe.label} does not support ${scopeKind} scope.`,
      };
    }
    const result = await scheduleAgentTaskFor(session.user.id, {
      agentId: "portfolio-advisor",
      title: recipe.label,
      prompt:
        "Execute the selected typed product-management recipe from canonical Product Operating Context. The scheduler prepares the current evidence and permission boundary at run time.",
      routeContext: routeFor(context.scope),
      schedule: cleanCron(input.schedule),
      timezone: "UTC",
      organizationId: context.provider.id,
      productLineId:
        context.scope.kind === "product-line"
          ? context.scope.id
          : null,
      businessProductId:
        context.scope.kind === "product"
          ? context.scope.id
          : null,
      taskKind: PRODUCT_MANAGEMENT_PLAYBOOK_TASK_KIND,
      taskConfig: {
        schemaVersion: 1,
        recipeId: recipe.id,
        permissionsDigest: permissionDigest,
        minimumRefreshMinutes: 60,
      },
    });
    if (!result.success) return { ok: false, error: result.error };
    revalidatePath(routeFor(context.scope));
    return {
      ok: true,
      taskId: result.taskId,
      message: `${recipe.label} scheduled. The first run will use the previewed evidence and approval boundary.`,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The product-management playbook could not be scheduled.",
    };
  }
}

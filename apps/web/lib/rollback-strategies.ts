"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

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

// ─── Per-Item Rollback ───────────────────────────────────────────────────────

export interface RollbackResult {
  success: boolean;
  message: string;
}

export async function executeRollback(
  changeItemId: string
): Promise<RollbackResult> {
  const item = await prisma.changeItem.findUnique({
    where: { id: changeItemId },
    include: { changePromotion: true },
  });

  if (!item) {
    return { success: false, message: `Change item not found: ${changeItemId}` };
  }

  const now = new Date();
  let message: string;

  switch (item.itemType) {
    case "code_deployment": {
      if (item.changePromotionId && item.changePromotion) {
        await prisma.changePromotion.update({
          where: { id: item.changePromotion.id },
          data: {
            status: "rolled_back",
            rolledBackAt: now,
            rollbackReason: `Rollback triggered for change item ${changeItemId}`,
          },
        });
        message = `Code deployment rolled back — ChangePromotion ${item.changePromotion.promotionId} marked as rolled_back`;
      } else {
        message = `Code deployment rolled back — no linked ChangePromotion`;
      }
      break;
    }

    case "infrastructure": {
      const snapshot = item.rollbackSnapshot as Record<string, unknown> | null;
      if (snapshot) {
        message = `Infrastructure rollback: snapshot available, restore from snapshot data`;
      } else {
        message = `Infrastructure rollback: no snapshot available, manual restore may be required`;
      }
      break;
    }

    case "configuration": {
      const snapshot = item.rollbackSnapshot as Record<string, unknown> | null;
      if (snapshot) {
        message = `Configuration rollback: snapshot available, restore from snapshot data`;
      } else {
        message = `Configuration rollback: no snapshot available, manual restore may be required`;
      }
      break;
    }

    case "external": {
      message = "Manual rollback required";
      break;
    }

    default: {
      message = `Unknown item type "${item.itemType}" — manual rollback required`;
      break;
    }
  }

  // Always update the ChangeItem with rollback metadata
  await prisma.changeItem.update({
    where: { id: changeItemId },
    data: {
      status: "rolled-back",
      rolledBackAt: now,
      rollbackNotes: message,
    },
  });

  return { success: true, message };
}

// ─── Full RFC Rollback ───────────────────────────────────────────────────────

export interface RFCRollbackResult {
  success: boolean;
  results: RollbackResult[];
}

export async function rollbackRFC(
  rfcId: string,
  reason: string
): Promise<RFCRollbackResult> {
  await requireOpsAccess();

  const rfc = await prisma.changeRequest.findUnique({
    where: { rfcId },
    include: {
      changeItems: {
        where: { status: "completed" },
        orderBy: { executionOrder: "desc" },
      },
    },
  });

  if (!rfc) {
    throw new Error(`RFC not found: ${rfcId}`);
  }

  if (rfc.status !== "completed" && rfc.status !== "in-progress") {
    throw new Error(
      `Cannot rollback RFC in "${rfc.status}" status. Must be "completed" or "in-progress".`
    );
  }

  const results: RollbackResult[] = [];

  for (const item of rfc.changeItems) {
    const result = await executeRollback(item.id);
    results.push(result);
  }

  await prisma.changeRequest.update({
    where: { rfcId },
    data: {
      status: "rolled-back",
      outcome: "rolled-back",
      outcomeNotes: reason,
    },
  });

  revalidatePath("/ops");

  return { success: true, results };
}

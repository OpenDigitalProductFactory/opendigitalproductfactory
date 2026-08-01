"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

import {
  createOperationalCommandBoundary,
  type OperationalAssignmentCommand,
  type OperationalCommandResult,
} from "./operations-command";
import { createRestaurantFloorCommandAdapter } from "./restaurant-floor-command.server";
import {
  executeRestaurantTurnStageCommand as executeTurnStageCommand,
  type RestaurantTurnStageCommand,
} from "./restaurant-turn-command.server";
import {
  executeRestaurantMoveCommand,
  type RestaurantMoveCommand,
} from "./restaurant-move-command.server";

function rejected(
  command: { idempotencyKey: string },
  reasonCode: string,
  message: string,
): OperationalCommandResult {
  return {
    status: "rejected",
    idempotencyKey: command.idempotencyKey,
    replayed: false,
    reasonCode,
    message,
  };
}

export async function executeRestaurantFloorCommand(
  command: OperationalAssignmentCommand,
): Promise<OperationalCommandResult> {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      {
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      },
      "view_storefront",
    )
  ) {
    return rejected(
      command,
      "unauthorized",
      "You do not have permission to change the restaurant floor.",
    );
  }

  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true },
  });
  if (!config) {
    return rejected(
      command,
      "storefront-not-configured",
      "The restaurant storefront is not configured.",
    );
  }

  try {
    const boundary = createOperationalCommandBoundary(
      createRestaurantFloorCommandAdapter({
        database: prisma as never,
        organizationId: config.organizationId,
        storefrontId: config.id,
        actorRef: session.user.id,
      }),
    );
    const result = await boundary.execute(command);
    if (result.status === "confirmed") {
      revalidatePath("/workspace");
      revalidatePath("/storefront/tables");
    }
    return result;
  } catch {
    return rejected(
      command,
      "operation-unavailable",
      "The floor could not be updated right now. Nothing changed.",
    );
  }
}

export async function advanceRestaurantServiceTurn(
  command: RestaurantTurnStageCommand,
): Promise<OperationalCommandResult> {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      {
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      },
      "view_storefront",
    )
  ) {
    return rejected(
      command,
      "unauthorized",
      "You do not have permission to change the restaurant floor.",
    );
  }

  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true },
  });
  if (!config) {
    return rejected(
      command,
      "storefront-not-configured",
      "The restaurant storefront is not configured.",
    );
  }

  try {
    const result = await executeTurnStageCommand({
      database: prisma as never,
      organizationId: config.organizationId,
      actorRef: session.user.id,
      command,
    });
    if (result.status === "confirmed") {
      revalidatePath("/workspace");
      revalidatePath("/storefront/tables");
    }
    return result;
  } catch {
    return rejected(
      command,
      "operation-unavailable",
      "The table status could not be updated right now. Nothing changed.",
    );
  }
}

export async function moveRestaurantParty(
  command: RestaurantMoveCommand,
): Promise<OperationalCommandResult> {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      {
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      },
      "view_storefront",
    )
  ) {
    return rejected(
      command,
      "unauthorized",
      "You do not have permission to change the restaurant floor.",
    );
  }

  const config = await prisma.storefrontConfig.findFirst({
    select: { id: true, organizationId: true },
  });
  if (!config) {
    return rejected(
      command,
      "storefront-not-configured",
      "The restaurant storefront is not configured.",
    );
  }

  try {
    const result = await executeRestaurantMoveCommand({
      database: prisma as never,
      organizationId: config.organizationId,
      storefrontId: config.id,
      actorRef: session.user.id,
      command,
    });
    if (result.status === "confirmed") {
      revalidatePath("/workspace");
      revalidatePath("/storefront/tables");
    }
    return result;
  } catch {
    return rejected(
      command,
      "operation-unavailable",
      "The party could not be moved right now. Nothing changed.",
    );
  }
}

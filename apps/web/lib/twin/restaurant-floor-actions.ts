"use server";

import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { newId } from "@/lib/shared/new-id";
import {
  parseRestaurantTableAttributes,
  serializeRestaurantTableAttributes,
  type RestaurantTableBookingAccess,
} from "@/lib/storefront/restaurant-table-attributes";

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

export type RestaurantWalkInInput = {
  name: string;
  covers: number;
  phone?: string;
  notes?: string;
  idempotencyKey: string;
};

export type RestaurantWalkInResult =
  | { ok: true; bookingId: string; bookingRef: string; replayed: boolean }
  | { ok: false; error: string };

export async function createRestaurantWalkIn(
  input: RestaurantWalkInInput,
): Promise<RestaurantWalkInResult> {
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
    return { ok: false, error: "You do not have permission to add a walk-in." };
  }

  const name = input.name.trim();
  const phone = input.phone?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (
    name.length < 1 ||
    name.length > 120 ||
    !Number.isInteger(input.covers) ||
    input.covers < 1 ||
    input.covers > 30 ||
    (phone?.length ?? 0) > 40 ||
    (notes?.length ?? 0) > 500 ||
    input.idempotencyKey.length < 8 ||
    input.idempotencyKey.length > 200
  ) {
    return { ok: false, error: "Enter a party name and a party size from 1 to 30." };
  }

  const config = await prisma.storefrontConfig.findFirst({
    where: { archetype: { archetypeId: "restaurant" } },
    select: {
      id: true,
      organizationId: true,
      items: {
        where: { isActive: true, ctaType: "booking" },
        orderBy: { sortOrder: "asc" },
        take: 1,
        select: { id: true },
      },
    },
  });
  const itemId = config?.items[0]?.id;
  if (!config || !itemId) {
    return { ok: false, error: "Restaurant booking setup is incomplete." };
  }

  try {
    const existing = await prisma.storefrontBooking.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, bookingRef: true },
    });
    if (existing) return { ok: true, bookingId: existing.id, bookingRef: existing.bookingRef, replayed: true };

    const created = await prisma.storefrontBooking.create({
      data: {
        bookingRef: `BK-${newId(8).toUpperCase()}`,
        organizationId: config.organizationId,
        storefrontId: config.id,
        itemId,
        customerName: name,
        customerEmail: null,
        customerPhone: phone,
        covers: input.covers,
        notes,
        demandKind: "walk-in",
        status: "waiting",
        scheduledAt: new Date(),
        durationMinutes: 90,
        idempotencyKey: input.idempotencyKey,
      },
      select: { id: true, bookingRef: true },
    });
    revalidatePath("/workspace");
    revalidatePath("/storefront/tables");
    return { ok: true, bookingId: created.id, bookingRef: created.bookingRef, replayed: false };
  } catch {
    return { ok: false, error: "The walk-in could not be added. Nothing changed." };
  }
}

export async function setRestaurantTableBookingAccess(input: {
  resourceId: string;
  expectedVersion: number;
  bookingAccess: RestaurantTableBookingAccess;
  idempotencyKey: string;
}): Promise<OperationalCommandResult> {
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
    return rejected(input, "unauthorized", "You do not have permission to change table access.");
  }
  if (!Number.isInteger(input.expectedVersion) || !["online", "in-house"].includes(input.bookingAccess)) {
    return rejected(input, "invalid-table-access", "Choose online or in-house access.");
  }

  const resource = await prisma.hospitalityResource.findFirst({
    where: { id: input.resourceId, kind: "table" },
    select: { id: true, organizationId: true, attributes: true, version: true },
  });
  if (!resource) return rejected(input, "table-not-found", "That table is no longer available.");
  const attributes = parseRestaurantTableAttributes(resource.attributes);
  if (attributes.bookingAccess === input.bookingAccess) {
    return {
      status: "confirmed",
      idempotencyKey: input.idempotencyKey,
      replayed: true,
      newVersion: String(resource.version),
      changedFacts: [],
    };
  }
  const changed = await prisma.hospitalityResource.updateMany({
    where: {
      id: resource.id,
      organizationId: resource.organizationId,
      version: input.expectedVersion,
    },
    data: {
      attributes: serializeRestaurantTableAttributes({
        ...attributes,
        bookingAccess: input.bookingAccess,
      }) as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (changed.count !== 1) {
    return {
      status: "conflict",
      idempotencyKey: input.idempotencyKey,
      replayed: false,
      currentVersion: String(resource.version),
      changedFacts: [],
      alternatives: [],
    };
  }
  revalidatePath("/workspace");
  revalidatePath("/storefront/tables");
  return {
    status: "confirmed",
    idempotencyKey: input.idempotencyKey,
    replayed: false,
    newVersion: String(input.expectedVersion + 1),
    changedFacts: [{
      entityId: resource.id,
      field: "bookingAccess",
      value: input.bookingAccess,
    }],
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

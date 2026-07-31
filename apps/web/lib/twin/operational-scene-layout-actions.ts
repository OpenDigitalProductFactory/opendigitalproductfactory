"use server";

import type { CartesianSceneLayout } from "@dpf/storefront-templates";
import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

import {
  saveExistingCartesianScene,
  type OperationalSceneLayoutDatabase,
  type OperationalSceneLayoutSaveResult,
} from "./operational-scene-layout-repository";

const UNAUTHORIZED_RESULT: OperationalSceneLayoutSaveResult = {
  ok: false,
  code: "unauthorized",
  error: "You do not have permission to change this operational layout.",
};

export async function saveOperationalCartesianScene(input: {
  sceneId: string;
  expectedVersion: number;
  layout: CartesianSceneLayout;
}): Promise<OperationalSceneLayoutSaveResult> {
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
    return UNAUTHORIZED_RESULT;
  }

  const organization = await prisma.organization.findFirst({
    select: { orgId: true },
  });
  if (!organization) {
    return {
      ok: false,
      code: "not-found",
      error: "The business organization is not configured.",
    };
  }

  try {
    const result = await saveExistingCartesianScene({
      database: prisma as unknown as OperationalSceneLayoutDatabase,
      organizationOrgId: organization.orgId,
      sceneId: input.sceneId,
      expectedVersion: input.expectedVersion,
      layout: input.layout,
    });
    if (result.ok) {
      revalidatePath("/workspace");
      revalidatePath("/storefront/tables");
    }
    return result;
  } catch {
    return {
      ok: false,
      code: "unavailable",
      error: "The layout could not be saved right now. Try again.",
    };
  }
}

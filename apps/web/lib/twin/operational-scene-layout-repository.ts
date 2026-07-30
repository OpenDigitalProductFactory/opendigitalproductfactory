import type { CartesianSceneLayout } from "@dpf/storefront-templates";

import { validateCartesianSceneLayout } from "./cartesian-scene";

export type OperationalSceneLayoutSaveResult =
  | { ok: true; version: number }
  | {
      ok: false;
      code:
        | "invalid"
        | "not-found"
        | "conflict"
        | "unauthorized"
        | "unavailable";
      error: string;
    };

export interface OperationalSceneLayoutDatabase {
  operationalSceneLayout: {
    findFirst(input: {
      where: { id: string; orgId: string };
      select: { id: true; version: true; spaceKind: true };
    }): Promise<{
      id: string;
      version: number;
      spaceKind: string;
    } | null>;
    updateMany(input: {
      where: { id: string; orgId: string; version: number };
      data: {
        layoutState: CartesianSceneLayout;
        underlayRef: string | null;
        version: { increment: 1 };
      };
    }): Promise<{ count: number }>;
  };
}

const CONFLICT_ERROR =
  "This layout changed in another session. Refresh before moving more resources.";

export async function saveExistingCartesianScene(input: {
  database: OperationalSceneLayoutDatabase;
  organizationOrgId: string;
  sceneId: string;
  expectedVersion: number;
  layout: unknown;
}): Promise<OperationalSceneLayoutSaveResult> {
  if (
    !input.organizationOrgId.trim() ||
    !input.sceneId.trim() ||
    !Number.isInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    return {
      ok: false,
      code: "invalid",
      error: "The layout save request is invalid.",
    };
  }

  const validated = validateCartesianSceneLayout(input.layout);
  if (!validated.ok) {
    return { ok: false, code: "invalid", error: validated.error };
  }

  const existing = await input.database.operationalSceneLayout.findFirst({
    where: { id: input.sceneId, orgId: input.organizationOrgId },
    select: { id: true, version: true, spaceKind: true },
  });
  if (!existing) {
    return {
      ok: false,
      code: "not-found",
      error: "This operational layout is no longer available.",
    };
  }
  if (existing.spaceKind !== "cartesian-interior") {
    return {
      ok: false,
      code: "invalid",
      error: "This saved layout does not use cartesian coordinates.",
    };
  }
  if (existing.version !== input.expectedVersion) {
    return { ok: false, code: "conflict", error: CONFLICT_ERROR };
  }

  const update = await input.database.operationalSceneLayout.updateMany({
    where: {
      id: input.sceneId,
      orgId: input.organizationOrgId,
      version: input.expectedVersion,
    },
    data: {
      layoutState: validated.value,
      underlayRef: validated.value.underlayRef ?? null,
      version: { increment: 1 },
    },
  });
  if (update.count !== 1) {
    return { ok: false, code: "conflict", error: CONFLICT_ERROR };
  }

  return { ok: true, version: input.expectedVersion + 1 };
}

import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";
import {
  projectArchetypeValueStream,
  type ProjectArchetypeValueStreamInput,
} from "@dpf/db/archetype-value-stream-projection";

type Db = ProjectArchetypeValueStreamInput["db"];

/**
 * App-layer orchestration for P0 "Capture": resolve the template archetype,
 * derive its Operational Value Stream Model, and project it into the EA
 * substrate. Called from storefront setup (with the package Prisma client) and
 * from archetype-reset (with the reset transaction, so the projection commits or
 * rolls back atomically with the rest of the reset).
 */
export async function projectOperationalValueStreamForArchetype(input: {
  db?: Db;
  organizationId: string;
  archetypeId: string;
}) {
  const template = ALL_ARCHETYPES.find((a) => a.archetypeId === input.archetypeId);
  if (!template) {
    throw new Error(`Template archetype ${input.archetypeId} not found in ALL_ARCHETYPES`);
  }
  const ovsm = deriveOperationalValueStream(template);
  return projectArchetypeValueStream({ db: input.db, orgId: input.organizationId, ovsm });
}

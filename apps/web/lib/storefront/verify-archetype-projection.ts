import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "@dpf/db";
import { ALL_ARCHETYPES, deriveOperationalValueStream } from "@dpf/storefront-templates";
import { buildArchetypeRoomDefinitions } from "@dpf/db/archetype-room-definition-projection";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/govern/permissions";
import { loadEnvironmentClassResolution } from "@/lib/install/environment-class";
import type { ToolResult } from "@/lib/mcp-tool-types";
import { projectOperationalValueStreamModel } from "./project-operational-value-stream";
import { observeWithRollback, requireVerificationEnvironment } from "./verify-archetype-projection-contract";

/** No organization/model parameter: every write belongs to this transaction's
 * generated fixture. No seed, reset, provider call or durable business write. */
export async function verifyArchetypeProjectionTool(
  params: Record<string, unknown>, userId: string,
): Promise<ToolResult> {
  if (Object.keys(params).length) throw new Error("This verification accepts no business identities or overrides.");
  const user = await currentUserContext(userId);
  if (!user || !can(user, "manage_platform")) throw new Error("Platform management permission is required.");
  const environment = await loadEnvironmentClassResolution({ readConfig: async key =>
    (await prisma.platformConfig.findUnique({ where: { key } }))?.value ?? null });
  requireVerificationEnvironment(environment.environmentClass);
  const orgId = `projection-verification-${randomUUID()}`;
  const template = ALL_ARCHETYPES.find(row => row.archetypeId === "pet-rescue");
  assert.ok(template, "Pet-rescue template is unavailable");
  const ovsm = deriveOperationalValueStream(template);
  const expected = buildArchetypeRoomDefinitions(ovsm).definitions;
  assert.ok(expected.length >= 2, "Verification needs at least two declared stages");
  const where = { AND: [
    { properties: { path: ["projection", "orgId"], equals: orgId } },
    { properties: { path: ["projection", "source"], equals: "archetype-room-definition" } },
  ] };
  const observed = await observeWithRollback(
    work => prisma.$transaction(work, { timeout: 30_000, maxWait: 5_000 }),
    async (tx: Prisma.TransactionClient) => {
      await tx.organization.create({ data: { orgId, slug: orgId, name: "Temporary projection verification" } });
      const project = (model = ovsm) => projectOperationalValueStreamModel({
        db: tx, organizationId: orgId, archetypeId: template.archetypeId, ovsm: model,
      });
      const first = await project();
      assert.equal(first.roomDefinitions.created, expected.length);
      const rows = await tx.eaElement.findMany({ where, orderBy: { id: "asc" } });
      assert.equal(rows.length, expected.length);
      for (const row of rows) {
        const properties = row.properties as { roomDefinition: Record<string, unknown> };
        const actual = properties.roomDefinition;
        const definition = expected.find(d => d.sourceKey === actual.sourceKey);
        assert.ok(definition, "Unexpected room definition");
        for (const field of ["trigger", "outcome", "requiredParticipantRole", "gateBindings", "measureBindings"] as const) {
          assert.deepEqual(actual[field], definition[field], `Incorrect ${field}`);
        }
      }
      const second = await project();
      assert.equal(second.roomDefinitions.created, 0);
      assert.equal(second.viewId, first.viewId);
      assert.deepEqual((await tx.eaElement.findMany({ where, orderBy: { id: "asc" } })).map(r => r.id), rows.map(r => r.id));
      const retained = rows[0]!;
      const key = (retained.properties as { roomDefinition: { sourceKey: string } }).roomDefinition.sourceKey;
      const notation = await tx.eaNotation.findUniqueOrThrow({ where: { slug: "archimate4" } });
      const type = await tx.eaRelationshipType.findFirstOrThrow({ where: { notationId: notation.id } });
      const relationship = await tx.eaRelationship.create({ data: {
        fromElementId: retained.id, toElementId: rows[1]!.id, relationshipTypeId: type.id, notationSlug: notation.slug,
      } });
      const view = await tx.eaView.create({ data: {
        notationId: notation.id, name: orgId, layoutType: "manual", scopeType: "test", scopeRef: orgId,
      } });
      const reference = await tx.eaViewElement.create({ data: { viewId: view.id, elementId: retained.id } });
      const reduced = { ...ovsm, stages: ovsm.stages.filter(stage => stage.key !== key),
        streams: ovsm.streams.map(stream => ({ ...stream, stages: stream.stages.filter(stage => stage.key !== key) })),
        loadBearingStageKeys: ovsm.loadBearingStageKeys.filter(stageKey => stageKey !== key),
      };
      await project(reduced);
      const withdrawn = await tx.eaElement.findUniqueOrThrow({ where: { id: retained.id } });
      assert.equal(withdrawn.lifecycleStatus, "inactive");
      assert.equal(await tx.eaElement.count({ where: { AND: [
        { properties: { path: ["projection", "orgId"], equals: orgId } },
        { properties: { path: ["projection", "layoutRole"], equals: "stream_stage" } },
        { properties: { path: ["projection", "stageKey"], equals: key } },
      ] } }), 0, "EA projection still contains the withdrawn stage");
      assert.equal(await tx.eaElement.count({ where: { ...where, lifecycleStatus: { not: "inactive" } } }), expected.length - 1);
      await project();
      const restored = await tx.eaElement.findMany({ where, orderBy: { id: "asc" } });
      assert.deepEqual(restored.map(r => r.id), rows.map(r => r.id));
      assert.ok(restored.every(r => r.lifecycleStatus !== "inactive"));
      assert.ok(await tx.eaRelationship.findUnique({ where: { id: relationship.id } }));
      assert.ok(await tx.eaViewElement.findUnique({ where: { id: reference.id } }));
      const events = await tx.lifecycleEvent.findMany({ where: { governedThingKind: "EaElement", governedThingId: retained.id }, orderBy: { createdAt: "asc" } });
      assert.equal(events.length, 2, "Withdrawal and restoration must both have history");
      assert.ok(events.some(event => event.fromStatus === retained.lifecycleStatus && event.toStatus === "inactive"));
      assert.ok(events.some(event => event.fromStatus === "inactive" && event.toStatus === "active"));
      assert.ok(events.every(event => event.fromStage === retained.lifecycleStage && event.toStage === retained.lifecycleStage));
      return { organizationId: orgId, definitionCount: expected.length, definitionIds: rows.map(r => r.id),
        retainedDefinitionId: retained.id, relationshipId: relationship.id, viewReferenceId: reference.id,
        lifecycleEventIds: events.map(e => e.id), checks: ["bindings", "repeat-identity", "withdraw", "restore", "retained-references", "lifecycle-history"] };
    },
  );
  assert.equal(await prisma.organization.count({ where: { orgId } }), 0, "Fixture organization survived rollback");
  assert.equal(await prisma.eaElement.count({ where }), 0, "Fixture definitions survived rollback");
  assert.equal(await prisma.eaView.count({ where: { scopeRef: { in: [orgId, `${orgId}:operational`] } } }), 0, "Fixture views survived rollback");
  assert.equal(await prisma.lifecycleEvent.count({ where: { id: { in: observed.lifecycleEventIds } } }), 0, "Fixture history survived rollback");
  return { success: true, message: "Archetype lifecycle verification passed; temporary fixture rolled back.",
    data: { ...observed, fixtureRolledBack: true, observedAt: new Date().toISOString() } };
}

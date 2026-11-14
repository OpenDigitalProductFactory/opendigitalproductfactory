"use server";

// BI-A63A9476: the reference view for a client surface (the backlog item panel
// and the epic card). Everything is resolved for the signed-in person by the
// shared reader: which ids in the body they may open, and what references the
// entity. The body is read from the database, never taken from the client.

import { prisma } from "@dpf/db";
import { extractEntityIds } from "@dpf/db/wiki-frontmatter";

import { requireUser } from "@/lib/actions/shared/guards";
import { listInbound, resolveReadableEntityHrefs, type ReferenceRow } from "@/lib/references/read-references";
import { personReferenceReader, referenceReadDeps } from "@/lib/references/reference-reader.server";

export type EntityReferenceView = { hrefs: Record<string, string>; referencedBy: ReferenceRow[] };

export async function loadEntityReferenceView(input: { kind: "backlog" | "epic"; key: string }): Promise<EntityReferenceView> {
  const user = await requireUser();
  const reader = await personReferenceReader({ id: user.id, platformRole: user.platformRole, isSuperuser: user.isSuperuser });
  if (!reader.canReadBacklog) return { hrefs: {}, referencedBy: [] };
  const body = input.kind === "backlog"
    ? (await prisma.backlogItem.findUnique({ where: { itemId: input.key }, select: { body: true } }))?.body
    : (await prisma.epic.findUnique({ where: { epicId: input.key }, select: { description: true } }))?.description;
  const deps = referenceReadDeps(reader);
  const [hrefs, inbound] = await Promise.all([
    resolveReadableEntityHrefs(extractEntityIds(body ?? ""), reader, deps),
    listInbound(input.key, reader, {}, deps),
  ]);
  return { hrefs, referencedBy: inbound.rows };
}

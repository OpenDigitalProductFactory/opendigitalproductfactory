// BI-A63A9476: the app's hooks into the reference writer (spec 2026-10-14 §5,
// "Write path"). Every committed body write calls one of these after the save.
// The writer (@dpf/db syncEntityReferences) re-reads the committed row, so a
// hook needs only the row's id. A failure is logged and never fails the save;
// the weekly `knowledge/entity-references-rebuild` job repairs any gap.

import {
  prisma,
  recordScope,
  removeEntityReferences,
  repointReferenceTarget,
  syncEntityReferences,
  type EntityReferenceSourceInput,
} from "@dpf/db";

import { getErrorMessage } from "@/lib/shared/get-error-message";

/** The provenance an edge records (R3): the agent when one acted, else the person. */
export function referenceWriter(actor: { userId?: string | null; agentId?: string | null; principalId?: string | null }): string | null {
  if (actor.agentId) return `agent:${actor.agentId}`;
  if (actor.userId) return `user:${actor.userId}`;
  if (actor.principalId) return `principal:${actor.principalId}`;
  return null;
}

async function guarded(label: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.warn(`[references] ${label} failed; the weekly rebuild repairs it: ${getErrorMessage(err)}`);
  }
}

async function sync(source: EntityReferenceSourceInput, body: string | null | undefined): Promise<void> {
  await syncEntityReferences(source, body ?? "");
}

export async function syncBacklogItemReferences(where: { id?: string; itemId?: string }, writtenBy: string | null): Promise<void> {
  await guarded(`backlog item ${where.itemId ?? where.id}`, async () => {
    const row = await prisma.backlogItem.findFirst({ where, select: { itemId: true, organizationId: true, body: true } });
    if (!row) return;
    await sync({ kind: "backlog", key: row.itemId, organizationId: row.organizationId, field: "body", writtenBy }, row.body);
  });
}

export async function syncEpicReferences(where: { id?: string; epicId?: string }, writtenBy: string | null): Promise<void> {
  await guarded(`epic ${where.epicId ?? where.id}`, async () => {
    const row = await prisma.epic.findFirst({ where, select: { epicId: true, description: true } });
    if (!row) return;
    await sync({ kind: "epic", key: row.epicId, organizationId: null, field: "description", writtenBy }, row.description);
  });
}

/** The text of the document's new current version. */
export async function syncDocumentReferences(documentId: string, writtenBy: string | null): Promise<void> {
  await guarded(`document ${documentId}`, async () => {
    const row = await prisma.document.findFirst({
      where: { documentId },
      select: { documentId: true, organizationId: true, currentVersion: { select: { contentText: true } } },
    });
    if (!row) return;
    await sync({ kind: "document", key: row.documentId, organizationId: row.organizationId, field: "body", writtenBy }, row.currentVersion?.contentText);
  });
}

/** A Workroom message, written once and keyed by its own id. A message on a work item no room anchors is not a room message. */
export async function syncWorkroomMessageReferences(messageRowId: string, writtenBy: string | null): Promise<void> {
  await guarded(`message ${messageRowId}`, async () => {
    const row = await prisma.workItemMessage.findUnique({
      where: { id: messageRowId },
      select: { id: true, body: true, workItem: { select: { capsules: { select: { id: true }, take: 1, orderBy: { createdAt: "asc" } } } } },
    });
    const roomId = row?.workItem.capsules[0]?.id;
    if (!row || !roomId) return;
    await sync({ kind: "message", key: row.id, organizationId: null, field: "message", writtenBy, roomId }, row.body);
  });
}

/** A wiki body on revision commit: entity ids only; page-to-page links stay on LINKS_TO. */
export async function syncWikiPageReferences(
  page: { pageId: string; organizationId: string | null; slug?: string; body: string },
  writtenBy: string | null,
): Promise<void> {
  await guarded(`wiki page ${page.pageId}`, () =>
    sync({ kind: "wiki", key: page.pageId, organizationId: page.organizationId, slug: page.slug, field: "body", writtenBy }, page.body),
  );
}

/** merge_backlog_items: the merged item's inbound references now point at the survivor. */
export async function repointBacklogReferences(fromItemId: string, survivor: { itemId: string; organizationId: string | null }): Promise<void> {
  await guarded(`merge ${fromItemId}`, () => repointReferenceTarget(fromItemId, survivor.itemId, recordScope(survivor.organizationId)));
}

/** A deleted entity: drop the edges that start or end at it. */
export async function removeReferences(key: string): Promise<void> {
  await guarded(`delete ${key}`, () => removeEntityReferences(key));
}

import { decodeWorkCaseKey, encodeWorkCaseKey } from "./case-key";
import type { WorkspaceCasePrismaClient } from "./workspace-case-loader";

/** Where a work-capsule case key should actually be read.
 *
 *  A Workroom is anchored to its WorkItem by Workroom.workItemId (BI-650994D7),
 *  and that WorkItem owns exactly one case key — on the live install every
 *  FK-anchored room points at a `backlog-item` case. So `work-capsule:<WC-x>` is
 *  not a second case for the same work; it is another way to say the anchored
 *  item's case. Resolving it here keeps one case per unit of work while making
 *  the room reachable from every surface that addresses it by capsule id
 *  (BI-EBEB77E2).
 *
 *  Returns the canonical key when it differs from the requested one, else null.
 */
export async function resolveCanonicalWorkCaseKey(
  prismaClient: WorkspaceCasePrismaClient,
  caseKey: string,
): Promise<string | null> {
  const decoded = decodeWorkCaseKey(caseKey);
  if (!decoded || decoded.sourceType !== "work-capsule") return null;
  if (!prismaClient.workroom.findFirst) return null;

  const room = await prismaClient.workroom.findFirst({
    where: { capsuleId: decoded.sourceId },
    select: { workItemId: true },
  });
  if (!room?.workItemId) return null;

  const item = await prismaClient.workItem.findFirst({ where: { id: room.workItemId } });
  if (!item?.sourceType || !item.sourceId) return null;

  const canonical = encodeWorkCaseKey({ sourceType: item.sourceType, sourceId: item.sourceId });
  return canonical === caseKey ? null : canonical;
}

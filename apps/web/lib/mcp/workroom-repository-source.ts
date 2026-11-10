import { prisma, type Prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { resolveWorkroomReadSource } from "./backlog-workroom-read-source";
import { prepareCurrentArtifactObservation, type ArtifactObservationDb } from "@/lib/backlog/initiative-readiness/current-artifact-observation";
import type { RepositorySourceAdmission } from "@/lib/backlog/initiative-readiness/repository-artifact";

type SourceDb = Pick<typeof prisma, "workroom" | "backlogItem"> & ArtifactObservationDb;
type Binding = { kind: "bound"; itemRowId: string; room: { capsuleId: string; createdByPrincipalId: string }; source: {
  itemId: string; workroomId: string; repositoryFullName: string; branchName: string; baseSha: string; headSha: string;
} } | { kind: "unavailable" };

/** The selector supplies no source or authority; both come from existing owners. */
export async function prepareWorkroomRepositorySource(args: {
  workroomId: unknown; userId?: string; agentId: string | null; itemId?: string;
  target?: { repositoryFullName: string; commitSha: string };
}, db: SourceDb = prisma): Promise<{
  sourceAdmission: RepositorySourceAdmission;
  admissionGuard: (db?: Prisma.TransactionClient) => Promise<boolean>;
} | null> {
  if (typeof args.workroomId !== "string" || !args.workroomId.trim() || !args.userId || !args.agentId) return null;
  const workroomId = args.workroomId;
  const load = async (store: SourceDb): Promise<Binding> => {
    const room = await store.workroom.findFirst({ where: { capsuleId: workroomId },
      select: { capsuleId: true, backlogItemId: true, createdByPrincipalId: true } });
    if (!room?.backlogItemId || !room.createdByPrincipalId) return { kind: "unavailable" };
    const item = await store.backlogItem.findFirst({ where: { OR: [{ id: room.backlogItemId }, { itemId: room.backlogItemId }] },
      select: { id: true, itemId: true } });
    if (!item || (args.itemId !== undefined && args.itemId !== item.itemId)) return { kind: "unavailable" };
    const selected = await resolveWorkroomReadSource({ workroomId, userId: args.userId, agentId: args.agentId,
      itemId: item.itemId, itemRowId: item.id });
    if (!selected.ok || !await selected.isCurrent()) return { kind: "unavailable" };
    if (args.target && (args.target.repositoryFullName.toLowerCase() !== selected.source.repositoryFullName.toLowerCase()
      || args.target.commitSha !== selected.source.headSha)) return { kind: "unavailable" };
    return { kind: "bound", itemRowId: item.id,
      room: { capsuleId: workroomId, createdByPrincipalId: room.createdByPrincipalId }, source: {
      itemId: item.itemId, workroomId, repositoryFullName: selected.source.repositoryFullName,
      branchName: selected.source.headBranch, baseSha: selected.source.baseSha, headSha: selected.source.headSha,
    } };
  };
  let binding: Binding;
  try { binding = await load(db); } catch { return null; }
  if (binding.kind !== "bound") return null;
  const fingerprint = canonicalJson(binding);
  const current = async (store: SourceDb) => {
    try { return canonicalJson(await load(store)) === fingerprint; } catch { return false; }
  };
  // The same source/actor selection is re-read while the existing subject and
  // Workroom locks are held. Provider I/O stays outside receipt transactions.
  const observation = await prepareCurrentArtifactObservation<Binding, boolean>({
    db, load: store => load(store as SourceDb), read: async selected => canonicalJson(selected) === fingerprint,
    unbound: () => false, unavailable: false, isUnavailable: value => !value,
  });
  if (!observation.evidence) return null;
  return { sourceAdmission: { ...binding.source, isCurrent: () => current(db) },
    admissionGuard: async store => observation.admissionGuard((store ?? db) as ArtifactObservationDb) };
}

import { prisma } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { resolveAgentWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { isFullSourceCommitSha } from "@/lib/work-capsules/work-capsule-branch-identity";

const terminal = new Set(["abandoned", "archived", "superseded", "complete"]);
const select = { id: true, capsuleId: true, backlogItemId: true, status: true, archivedAt: true,
  repositoryFullName: true, headBranch: true, baseSha: true, headSha: true } as const;

/** A public locator selects persisted evidence; it never supplies source or authority. */
export async function resolveWorkroomReadSource(args: {
  workroomId: unknown; userId?: string; agentId: string | null; itemId: string; itemRowId: string;
}) {
  const denied = { ok: false as const };
  if (typeof args.workroomId !== "string" || !args.workroomId.trim() || !args.userId || !args.agentId) return denied;
  const workroomId = args.workroomId;
  const userId = args.userId;
  const agentId = args.agentId;
  const load = async () => {
    const room = await prisma.workroom.findFirst({ where: { capsuleId: workroomId }, select });
    if (!room || room.capsuleId !== workroomId || room.archivedAt !== null || terminal.has(room.status)
      || ![args.itemId, args.itemRowId].includes(room.backlogItemId ?? "")
      || !room.repositoryFullName || !room.headBranch
      || !isFullSourceCommitSha(room.baseSha) || !isFullSourceCommitSha(room.headSha)) return null;
    if ((await resolveAgentWorkroomAccess({ userId, agentId, workroomId: room.id, requested: "action" })).decision.level !== "action") return null;
    return { id: room.id, backlogItemId: room.backlogItemId, status: room.status, source: {
      workroomId, repositoryFullName: room.repositoryFullName, headBranch: room.headBranch,
      baseSha: room.baseSha!, headSha: room.headSha!,
    } };
  };
  try {
    const initial = await load();
    if (!initial) return denied;
    const fingerprint = canonicalJson(initial);
    return { ok: true as const, source: initial.source, isCurrent: async () => {
      try { return canonicalJson(await load()) === fingerprint; } catch { return false; }
    } };
  } catch { return denied; }
}

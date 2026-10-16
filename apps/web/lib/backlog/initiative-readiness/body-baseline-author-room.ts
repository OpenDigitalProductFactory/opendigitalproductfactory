import type { Prisma } from "@dpf/db";
import { selectLatestExactPullRequestObservation } from "@/lib/contributor-change-lanes/pull-request-observation";

type AuthorRoomDb = Pick<Prisma.TransactionClient, "workroom" | "contributorInventorySnapshot">;
const select = { id: true, capsuleId: true, backlogItemId: true, repositoryFullName: true,
  baseSha: true, headBranch: true, headSha: true, createdByPrincipalId: true,
  pullRequestNumber: true, status: true, archivedAt: true, createdAt: true } as const;

/** Resolve source authorship only. This never grants an execution lease or room access. */
export async function resolveBodyBaselineAuthorRoom(db: AuthorRoomDb,
  item: { id: string; itemId: string }) {
  const backlogItemId = { in: [item.id, item.itemId] };
  const active = await db.workroom.findMany({ where: { backlogItemId, archivedAt: null,
    status: { notIn: ["abandoned", "archived", "superseded"] } }, select, take: 2 });
  if (active.length > 0) return active.length === 1 ? active[0]! : null;

  // The newest attempt owns the source. Never search backward past a newer,
  // incomplete, abandoned or superseded attempt for a convenient merged head.
  const attempts = await db.workroom.findMany({ where: { backlogItemId }, select,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 2 });
  const room = attempts[0];
  if (!room || !room.archivedAt || room.status !== "archived"
    || !room.createdByPrincipalId || !room.repositoryFullName || !room.headBranch
    || !room.headSha || !/^[a-f0-9]{40}$/i.test(room.headSha)
    || !room.baseSha || !/^[a-f0-9]{40}$/i.test(room.baseSha)
    || !room.pullRequestNumber || !room.createdAt
    || (attempts[1] && attempts[1].createdAt.getTime() === room.createdAt.getTime())
    || ![item.id, item.itemId].includes(room.backlogItemId ?? "")) return null;
  const snapshots = await db.contributorInventorySnapshot.findMany({
    where: { source: "github-pr", sourceKey: String(room.pullRequestNumber) },
    orderBy: { fetchedAt: "desc" }, take: 20, select: { payload: true },
  });
  const observed = selectLatestExactPullRequestObservation(snapshots.map(row => row.payload), {
    repositoryFullName: room.repositoryFullName, pullRequestNumber: room.pullRequestNumber,
    headSha: room.headSha,
  });
  return observed?.state === "merged" && !observed.isDraft && observed.headBranch === room.headBranch
    ? room : null;
}

/** Bound readers/writers may accept only the same current delivered author. */
export async function isCurrentDeliveredBodyAuthor(db: AuthorRoomDb,
  item: { id: string; itemId: string }, expected: {
    workroomId: string; repositoryFullName: string; branchName: string; headSha: string;
  }): Promise<boolean> {
  const room = await resolveBodyBaselineAuthorRoom(db, item);
  return Boolean(room?.archivedAt && room.capsuleId === expected.workroomId
    && room.repositoryFullName?.toLowerCase() === expected.repositoryFullName.toLowerCase()
    && room.headBranch === expected.branchName && room.headSha?.toLowerCase() === expected.headSha.toLowerCase());
}

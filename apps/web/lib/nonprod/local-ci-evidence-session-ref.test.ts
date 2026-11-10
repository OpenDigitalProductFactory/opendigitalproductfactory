import { describe, expect, it } from "vitest";
import { findLocalCiEvidenceWorkroom } from "./local-ci-evidence-workroom";

type Room = { id: string; headBranch: string; executorRef: string; headSha: string | null; archivedAt: Date | null };

/** A Workroom reader that applies the lookup's where clause the way Prisma would. */
function reader(rooms: Room[]) {
  return {
    async findMany(args: unknown) {
      const where = (args as { where: { headBranch: string; executorRef: string | { in: string[] }; archivedAt: null } }).where;
      const refs = typeof where.executorRef === "string" ? [where.executorRef] : where.executorRef.in;
      return rooms
        .filter((room) => room.headBranch === where.headBranch && refs.includes(room.executorRef) && room.archivedAt === null)
        .map(({ id, headSha }) => ({ id, headSha }));
    },
  };
}

const sha = "a".repeat(40);
const sessionId = "4a07b0d3-f23c-4d56-b3e1-b8e00ced9065";

describe("BI-82D15653: local-CI evidence finds the session's room whatever form its session reference took", () => {
  it("links a room recorded with the bare client thread id", async () => {
    const workroom = reader([{ id: "room-bare", headBranch: "feat/x", executorRef: sessionId, headSha: sha, archivedAt: null }]);
    expect(await findLocalCiEvidenceWorkroom(workroom, { branch: "feat/x", sha, sessionId })).toEqual({ id: "room-bare" });
  });

  it("links a room whose session reference carries its executor-kind prefix", async () => {
    const workroom = reader([{ id: "room-prefixed", headBranch: "feat/x", executorRef: `claude-desktop-${sessionId}`, headSha: sha, archivedAt: null }]);
    expect(await findLocalCiEvidenceWorkroom(workroom, { branch: "feat/x", sha, sessionId })).toEqual({ id: "room-prefixed" });
  });

  it("does not link another session's room on the same branch", async () => {
    const workroom = reader([{ id: "room-other", headBranch: "feat/x", executorRef: "claude-desktop-ffffffff-0000-0000-0000-000000000000", headSha: sha, archivedAt: null }]);
    expect(await findLocalCiEvidenceWorkroom(workroom, { branch: "feat/x", sha, sessionId })).toBeNull();
  });

  it("does not treat an arbitrary prefix as the same session", async () => {
    const workroom = reader([{ id: "room-spoof", headBranch: "feat/x", executorRef: `someone-${sessionId}`, headSha: sha, archivedAt: null }]);
    expect(await findLocalCiEvidenceWorkroom(workroom, { branch: "feat/x", sha, sessionId })).toBeNull();
  });
});

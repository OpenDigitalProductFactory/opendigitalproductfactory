import { describe, expect, it } from "vitest";
import { findLocalCiEvidenceWorkroom } from "./local-ci-evidence-workroom";

// BI-53BED66C: PR #7011 (WC-1920C35F), 2026-11-12. T3's gate recorded the Codex
// thread id; the room had been claimed as "codex-bi-ef5e89a5-runtime-trial".
// The passing gate was saved unlinked and the review could not resolve it.
type Room = { id: string; headBranch: string; executorRef: string | null; headSha: string | null; archivedAt: Date | null;
  leaseHolderPrincipalId?: string | null; createdByPrincipalId?: string | null; requestedByPrincipalId?: string | null };
function reader(rooms: Room[]) {
  return {
    async findMany(args: unknown) {
      const where = (args as { where: Record<string, any> }).where;
      return rooms.filter((room) => room.headBranch === where.headBranch && room.archivedAt === null
        && (where.executorRef === undefined || where.executorRef.in.includes(room.executorRef))
        && (where.headSha === undefined || room.headSha === where.headSha)
        && (where.OR === undefined || where.OR.some((clause: Record<string, string>) =>
          Object.entries(clause).every(([key, value]) => (room as Record<string, unknown>)[key] === value))))
        .map(({ id, headSha }) => ({ id, headSha }));
    },
  };
}
const sha = "c".repeat(40);
const run = { branch: "fix/bi-ef5e89a5-dependabot-zwsp", sha, sessionId: "01a1d330-193d-73c2-aa02-2cadfeaaea6d", ownerPrincipalId: "owner" };
const trialRoom: Room = { id: "WC-1920C35F", headBranch: run.branch, executorRef: "codex-bi-ef5e89a5-runtime-trial", headSha: sha,
  archivedAt: null, leaseHolderPrincipalId: "build-specialist", createdByPrincipalId: "owner", requestedByPrincipalId: "owner" };

describe("gate evidence reaches the same person's room whatever its session is called (BI-53BED66C)", () => {
  it("links the caller's single live room at exactly the gated commit, and says how", async () => {
    expect(await findLocalCiEvidenceWorkroom(reader([trialRoom]), run)).toEqual({ id: "WC-1920C35F", attribution: "same-owner-exact-head" });
  });
  it("does not link it without an authenticated owner", async () => {
    expect(await findLocalCiEvidenceWorkroom(reader([trialRoom]), { ...run, ownerPrincipalId: null })).toBeNull();
  });
  it("does not link another person's room", async () => {
    const other = { ...trialRoom, createdByPrincipalId: "someone", requestedByPrincipalId: "someone", leaseHolderPrincipalId: "someone" };
    expect(await findLocalCiEvidenceWorkroom(reader([other]), run)).toBeNull();
  });
  it("does not link a room at another commit", async () => {
    expect(await findLocalCiEvidenceWorkroom(reader([{ ...trialRoom, headSha: "d".repeat(40) }]), run)).toBeNull();
  });
  it("leaves two of the person's rooms at that commit unlinked rather than guessing", async () => {
    expect(await findLocalCiEvidenceWorkroom(reader([trialRoom, { ...trialRoom, id: "WC-TWIN" }]), run)).toBe("ambiguous");
  });
  it("still prefers the room whose session matches", async () => {
    const own = { ...trialRoom, id: "WC-SESSION", executorRef: run.sessionId };
    expect(await findLocalCiEvidenceWorkroom(reader([trialRoom, own]), run)).toEqual({ id: "WC-SESSION" });
  });
});

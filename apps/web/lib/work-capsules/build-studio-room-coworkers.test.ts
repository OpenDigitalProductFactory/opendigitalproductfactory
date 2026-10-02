import { describe, expect, it, vi } from "vitest";

import {
  BUILD_STUDIO_ROOM_COWORKERS,
  admitBuildStudioRoomCoworkers,
  describeBuildStudioRoomCoworkers,
  hasBuildStudioRoomCoworkerDb,
} from "./build-studio-room-coworkers";

type Row = { id: string; principalId: string; roles: string[]; lifecycle: string };

function fakeDb(args: { aliases: Record<string, string>; rows?: Row[] }) {
  const rows: Row[] = [...(args.rows ?? [])];
  const created: Array<Record<string, unknown>> = [];
  return {
    created,
    rows,
    principalAlias: {
      findFirst: vi.fn(async ({ where }: { where: { aliasValue: string } }) =>
        args.aliases[where.aliasValue] ? { principalId: args.aliases[where.aliasValue] } : null),
    },
    workroomParticipant: {
      findMany: vi.fn(async ({ where }: { where: { principalId: string } }) => rows.filter((r) => r.principalId === where.principalId)),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        rows.push({ id: `row-${rows.length}`, principalId: data.principalId as string, roles: data.roles as string[], lifecycle: "active" });
        return data;
      }),
      update: vi.fn(async () => undefined),
    },
  };
}

describe("admitBuildStudioRoomCoworkers (BI-00588B51)", () => {
  it("admits every Build Studio coworker with a principal as a contributor, once", async () => {
    const aliases = Object.fromEntries(BUILD_STUDIO_ROOM_COWORKERS.map((id) => [id, `PRN-${id}`]));
    const db = fakeDb({ aliases });

    const first = await admitBuildStudioRoomCoworkers({ db, workroomId: "room-1" });
    expect(first.admitted).toEqual([...BUILD_STUDIO_ROOM_COWORKERS]);
    expect(db.created.every((row) => row.roles && (row.roles as string[]).includes("contributor") && row.lifecycle === "active")).toBe(true);

    const second = await admitBuildStudioRoomCoworkers({ db, workroomId: "room-1" });
    expect(second.admitted).toEqual([]);
    expect(second.alreadyPresent).toEqual([...BUILD_STUDIO_ROOM_COWORKERS]);
    expect(describeBuildStudioRoomCoworkers(second)).toBeNull();
  });

  it("never re-admits a coworker the owner removed, and reports a coworker with no principal", async () => {
    const db = fakeDb({
      aliases: { "AGT-WS-BUILD": "PRN-build" },
      rows: [{ id: "row-0", principalId: "PRN-build", roles: ["contributor"], lifecycle: "removed" }],
    });

    const out = await admitBuildStudioRoomCoworkers({ db, workroomId: "room-1", coworkers: ["AGT-WS-BUILD", "AGT-ORCH-300"] });

    expect(out.admitted).toEqual([]);
    expect(out.skipped[0]).toContain("AGT-WS-BUILD");
    expect(out.unresolved).toEqual(["AGT-ORCH-300"]);
    expect(db.created).toEqual([]);
    expect(describeBuildStudioRoomCoworkers(out)).toContain("not re-admitted");
  });

  it("recognises a database that can admit participants", () => {
    expect(hasBuildStudioRoomCoworkerDb(fakeDb({ aliases: {} }))).toBe(true);
    expect(hasBuildStudioRoomCoworkerDb({ workroom: {} })).toBe(false);
    expect(hasBuildStudioRoomCoworkerDb(null)).toBe(false);
  });
});

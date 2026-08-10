import { describe, expect, it, vi } from "vitest";

import { findFirstMirrorAcrossPages } from "./mirror-page";

describe("findFirstMirrorAcrossPages", () => {
  it("pages past a batch that would have been dropped by a silent take:1000", async () => {
    const pages = [
      [
        { mirrorId: "m1", payload: { n: 1 } },
        { mirrorId: "m2", payload: { n: 2 } },
      ],
      [{ mirrorId: "m3", payload: { n: 3 } }],
    ];
    const findMany = vi.fn().mockImplementation((args: {
      take: number;
      cursor?: { mirrorId: string };
      skip?: number;
    }) => {
      if (!args.cursor) return Promise.resolve(pages[0]!.slice(0, args.take));
      if (args.cursor.mirrorId === "m2") return Promise.resolve(pages[1]!);
      return Promise.resolve([]);
    });

    type Row = { mirrorId?: string | null; payload: { n: number } };
    const hit = await findFirstMirrorAcrossPages<Row>(
      findMany,
      { where: { federationLinkId: "link_1" }, select: { mirrorId: true, payload: true } },
      (row) => row.payload.n === 3,
      { pageSize: 2 },
    );

    expect(hit).toEqual({ mirrorId: "m3", payload: { n: 3 } });
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[1][0]).toMatchObject({
      take: 2,
      cursor: { mirrorId: "m2" },
      skip: 1,
    });
  });

  it("returns null when no page matches", async () => {
    const findMany = vi.fn().mockResolvedValue([{ mirrorId: "m1", payload: {} }]);
    await expect(
      findFirstMirrorAcrossPages(
        findMany,
        { where: {} },
        () => false,
        { pageSize: 10 },
      ),
    ).resolves.toBeNull();
  });
});

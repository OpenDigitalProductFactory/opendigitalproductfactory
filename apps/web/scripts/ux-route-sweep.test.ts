import { describe, expect, it } from "vitest";

import { withIsolatedSweepPage } from "./ux-route-sweep";

describe("withIsolatedSweepPage", () => {
  it("gives each route a fresh page and closes it after measurement", async () => {
    const events: string[] = [];
    let nextId = 0;
    const context = {
      newPage: async () => {
        const id = ++nextId;
        events.push(`open:${id}`);
        return {
          id,
          close: async () => {
            events.push(`close:${id}`);
          },
        };
      },
    };

    const first = await withIsolatedSweepPage(context, async (page) => {
      events.push(`measure:${page.id}`);
      return page.id;
    });
    const second = await withIsolatedSweepPage(context, async (page) => {
      events.push(`measure:${page.id}`);
      return page.id;
    });

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(events).toEqual([
      "open:1",
      "measure:1",
      "close:1",
      "open:2",
      "measure:2",
      "close:2",
    ]);
  });

  it("closes the route page when measurement fails", async () => {
    let closed = false;
    const page = {
      close: async () => {
        closed = true;
      },
    };

    await expect(
      withIsolatedSweepPage(
        { newPage: async () => page },
        async () => {
          throw new Error("measurement failed");
        },
      ),
    ).rejects.toThrow("measurement failed");

    expect(closed).toBe(true);
  });
});

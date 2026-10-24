import { describe, expect, it, vi } from "vitest";

import { FEDERATION_REACHED_AT_CONFIG, hostnameFromHostHeader, readReachedAtHosts, recordReachedAtHost, type ReachedAtDb } from "./reached-at";

const now = new Date("2026-09-04T12:00:00.000Z");

function db(initial?: unknown): ReachedAtDb & { rows: Record<string, unknown>; upserts: number } {
  const rows: Record<string, unknown> = initial ? { [FEDERATION_REACHED_AT_CONFIG]: initial } : {};
  const store = {
    rows,
    upserts: 0,
    platformConfig: {
      findUnique: vi.fn(async (args: { where: { key: string } }) => (rows[args.where.key] ? { value: rows[args.where.key] } : null)) as ReachedAtDb["platformConfig"]["findUnique"],
      upsert: vi.fn(async (args: { where: { key: string }; create: { value: unknown } }) => { store.upserts += 1; rows[args.where.key] = args.create.value; return {}; }) as ReachedAtDb["platformConfig"]["upsert"],
    },
  };
  return store;
}

describe("hostnameFromHostHeader", () => {
  it("keeps the hostname, drops the port, lower-cases, and refuses junk", () => {
    expect(hostnameFromHostHeader("192.168.0.200:3000")).toBe("192.168.0.200");
    expect(hostnameFromHostHeader("Dev.Internal")).toBe("dev.internal");
    expect(hostnameFromHostHeader("[fe80::1]:3000")).toBe("[fe80::1]");
    expect(hostnameFromHostHeader("a.example, b.example")).toBe("a.example");
    expect(hostnameFromHostHeader("")).toBeNull();
    expect(hostnameFromHostHeader(null)).toBeNull();
  });
});

describe("recordReachedAtHost / readReachedAtHosts", () => {
  it("records the host a trusted peer used, most recent first, and ignores loopback", async () => {
    const store = db();
    await recordReachedAtHost(store, "192.168.0.200:3000", now);
    await recordReachedAtHost(store, "localhost:3000", now);
    await recordReachedAtHost(store, "127.0.0.1:3000", now);
    await recordReachedAtHost(store, "dev.internal", new Date(now.getTime() + 1_000));
    expect(await readReachedAtHosts(store)).toEqual(["dev.internal", "192.168.0.200"]);
  });

  it("does not rewrite a host seen again within the interval, and bounds the set", async () => {
    const store = db();
    await recordReachedAtHost(store, "192.168.0.200:3000", now);
    await recordReachedAtHost(store, "192.168.0.200:3000", new Date(now.getTime() + 60_000));
    expect(store.upserts).toBe(1);
    await recordReachedAtHost(store, "192.168.0.200:3000", new Date(now.getTime() + 11 * 60_000));
    expect(store.upserts).toBe(2);
    for (let index = 0; index < 20; index++) await recordReachedAtHost(store, `h${index}.example`, new Date(now.getTime() + 20 * 60_000 + index));
    expect((await readReachedAtHosts(store)).length).toBe(16);
  });

  it("never throws when the store fails", async () => {
    const broken: ReachedAtDb = { platformConfig: { findUnique: async () => { throw new Error("db down"); }, upsert: async () => { throw new Error("db down"); } } };
    await expect(recordReachedAtHost(broken, "192.168.0.200", now)).resolves.toBeUndefined();
    expect(await readReachedAtHosts(broken)).toEqual([]);
  });
});

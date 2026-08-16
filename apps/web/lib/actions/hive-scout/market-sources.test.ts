import { describe, expect, it } from "vitest";

import {
  DEFAULT_MARKET_SOURCES,
  MARKET_MATERIAL_EXCERPT_CHARS,
  MARKET_SOURCE_LIMIT,
  MARKET_SOURCES_CONFIG_KEY,
  MARKET_STORED_EXCERPT_CHARS,
  extractMarketText,
  loadMarketSourceSettings,
  marketContentHash,
  marketSourceKey,
  runMarketSourcePass,
  type MarketSource,
} from "./market-sources";

function makeConfigDb(rows: Record<string, unknown>) {
  return {
    platformConfig: {
      findUnique: async (args?: unknown) => {
        const key = (args as { where?: { key?: string } } | undefined)?.where?.key;
        return key && key in rows ? { key, value: rows[key] } : null;
      },
    },
  };
}

function makePassDb(rows: Record<string, unknown>, priorLocators: Record<string, unknown> = {}) {
  const upserts: Array<Record<string, unknown>> = [];
  return {
    upserts,
    db: {
      ...makeConfigDb(rows),
      rawSource: {
        findUnique: async (args?: unknown) => {
          const key = (args as { where?: { sourceKey?: string } } | undefined)?.where?.sourceKey;
          return key && key in priorLocators ? { locator: priorLocators[key] } : null;
        },
        upsert: async (args: Record<string, unknown>) => {
          upserts.push(args);
          return { id: `raw-${upserts.length}` };
        },
      },
    },
  };
}

describe("loadMarketSourceSettings", () => {
  it("defaults to enabled with the seeded source list", async () => {
    const settings = await loadMarketSourceSettings(makeConfigDb({}) as never);
    expect(settings.enabled).toBe(true);
    expect(settings.configFallback).toBe(false);
    expect(settings.sources).toEqual(DEFAULT_MARKET_SOURCES.slice(0, MARKET_SOURCE_LIMIT));
  });

  it("honours the enabled kill switch in boolean, string, and object shapes", async () => {
    for (const value of [false, "false", { enabled: false }]) {
      const settings = await loadMarketSourceSettings(
        makeConfigDb({ "hive-scout.market.enabled": value }) as never,
      );
      expect(settings.enabled).toBe(false);
    }
  });

  it("accepts a valid operator override and caps it at the source limit", async () => {
    const override: MarketSource[] = Array.from({ length: MARKET_SOURCE_LIMIT + 3 }, (_, i) => ({
      key: `src-${i}`,
      title: `Source ${i}`,
      url: `https://example.com/${i}`,
    }));
    const settings = await loadMarketSourceSettings(
      makeConfigDb({ [MARKET_SOURCES_CONFIG_KEY]: override }) as never,
    );
    expect(settings.configFallback).toBe(false);
    expect(settings.sources).toHaveLength(MARKET_SOURCE_LIMIT);
    expect(settings.sources[0]).toEqual({ key: "src-0", title: "Source 0", url: "https://example.com/0" });
  });

  it("falls back to defaults on malformed overrides and flags the fallback", async () => {
    const malformed: unknown[] = [
      "not json at all",
      [{ key: "a", title: "A" }], // missing url
      [{ key: "a", title: "A", url: "ftp://nope" }], // non-http url
      [{ key: "a", title: "A", url: "https://x.test" }, { key: "a", title: "B", url: "https://y.test" }], // dup key
      [],
    ];
    for (const value of malformed) {
      const settings = await loadMarketSourceSettings(
        makeConfigDb({ [MARKET_SOURCES_CONFIG_KEY]: value }) as never,
      );
      expect(settings.configFallback).toBe(true);
      expect(settings.sources).toEqual(DEFAULT_MARKET_SOURCES.slice(0, MARKET_SOURCE_LIMIT));
    }
  });

  it("parses a JSON-string override (PlatformConfig rows edited as text)", async () => {
    const settings = await loadMarketSourceSettings(
      makeConfigDb({
        [MARKET_SOURCES_CONFIG_KEY]: JSON.stringify([
          { key: "only", title: "Only source", url: "https://example.com/feed" },
        ]),
      }) as never,
    );
    expect(settings.configFallback).toBe(false);
    expect(settings.sources).toEqual([{ key: "only", title: "Only source", url: "https://example.com/feed" }]);
  });
});

describe("extractMarketText", () => {
  it("strips HTML including script/style bodies and entities", () => {
    const text = extractMarketText(
      `<html><head><style>.a{color:red}</style><script>alert("x")</script></head>` +
        `<body><h1>Big &amp; bold</h1><p>release notes</p></body></html>`,
    );
    expect(text).toBe("Big bold release notes");
  });

  it("strips RSS/Atom markup and CDATA wrappers", () => {
    const text = extractMarketText(
      `<?xml version="1.0"?><rss><channel><item><title><![CDATA[New agent launch]]></title>` +
        `<description>Ships an inbox</description></item></channel></rss>`,
    );
    expect(text).toContain("New agent launch");
    expect(text).toContain("Ships an inbox");
    expect(text).not.toContain("<");
  });
});

describe("marketContentHash / marketSourceKey", () => {
  it("is stable for identical text and differs when content changes", () => {
    expect(marketContentHash("same text")).toBe(marketContentHash("same text"));
    expect(marketContentHash("same text")).not.toBe(marketContentHash("different text"));
  });

  it("derives a stable namespaced sourceKey from the url", () => {
    const key = marketSourceKey("https://example.com/changelog");
    expect(key).toMatch(/^hive-scout:market:/);
    expect(marketSourceKey("https://example.com/changelog")).toBe(key);
  });
});

describe("runMarketSourcePass", () => {
  const twoSources: MarketSource[] = [
    { key: "alpha", title: "Alpha changelog", url: "https://alpha.test/changelog" },
    { key: "beta", title: "Beta blog", url: "https://beta.test/blog" },
  ];

  it("returns early when disabled without touching sources", async () => {
    const { db } = makePassDb({ "hive-scout.market.enabled": false });
    let fetches = 0;
    const result = await runMarketSourcePass({
      db: db as never,
      fetcher: async () => {
        fetches++;
        return "x";
      },
    });
    expect(result.enabled).toBe(false);
    expect(result.attempted).toBe(0);
    expect(fetches).toBe(0);
  });

  it("upserts a citable RawSource with a structured locator and bounded excerpts", async () => {
    const { db, upserts } = makePassDb({ [MARKET_SOURCES_CONFIG_KEY]: twoSources });
    const longBody = `<html><body>${"release detail ".repeat(2000)}</body></html>`;
    const result = await runMarketSourcePass({
      db: db as never,
      fetcher: async () => longBody,
      now: new Date("2026-08-16T12:00:00.000Z"),
    });

    expect(result.fetched).toBe(2);
    expect(result.changed).toBe(2);
    expect(upserts).toHaveLength(2);
    const create = (upserts[0] as { create: Record<string, unknown> }).create;
    expect(create.sourceType).toBe("external-url");
    expect(create.url).toBe("https://alpha.test/changelog");
    expect((create.excerpt as string).length).toBeLessThanOrEqual(MARKET_STORED_EXCERPT_CHARS);
    expect(create.locator).toMatchObject({
      kind: "hive-scout-market",
      url: "https://alpha.test/changelog",
      fetchedAt: "2026-08-16T12:00:00.000Z",
    });
    expect((create.locator as { contentHash: string }).contentHash).toMatch(/^[0-9a-f]{64}$/);
    for (const item of result.material) {
      expect(item.excerpt.length).toBeLessThanOrEqual(MARKET_MATERIAL_EXCERPT_CHARS);
    }
  });

  it("reports changed=false when the prior locator hash matches the fresh content", async () => {
    const body = "<html><body>unchanged</body></html>";
    const hash = marketContentHash(extractMarketText(body));
    const priorLocators = {
      [marketSourceKey(twoSources[0]!.url)]: {
        kind: "hive-scout-market",
        url: twoSources[0]!.url,
        contentHash: hash,
        fetchedAt: "2026-08-15T12:00:00.000Z",
      },
    };
    const { db } = makePassDb({ [MARKET_SOURCES_CONFIG_KEY]: twoSources }, priorLocators);
    const result = await runMarketSourcePass({ db: db as never, fetcher: async () => body });

    expect(result.fetched).toBe(2);
    // alpha has a matching prior hash; beta has no prior row.
    expect(result.changed).toBe(1);
    expect(result.material.find((m) => m.key === "alpha")?.changed).toBe(false);
    expect(result.material.find((m) => m.key === "beta")?.changed).toBe(true);
  });

  it("captures per-source failures and keeps going", async () => {
    const { db, upserts } = makePassDb({ [MARKET_SOURCES_CONFIG_KEY]: twoSources });
    const result = await runMarketSourcePass({
      db: db as never,
      fetcher: async (url: string) => {
        if (url.includes("alpha")) throw new Error("HTTP 500");
        return "<html><body>ok</body></html>";
      },
    });
    expect(result.attempted).toBe(2);
    expect(result.fetched).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures[0]).toMatchObject({ key: "alpha", error: "HTTP 500" });
    expect(upserts).toHaveLength(1);
  });
});

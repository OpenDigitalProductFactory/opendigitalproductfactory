import { CacheRepository } from "./CacheRepository";

/* ------------------------------------------------------------------ */
/*  Mock setup                                                         */
/* ------------------------------------------------------------------ */

// The expo-sqlite mock is loaded from __mocks__/expo-sqlite.ts via jest.
// We need per-test control, so we grab the mock db instance.
import * as SQLite from "expo-sqlite";

const mockDb = SQLite.openDatabaseSync("dpf-cache") as unknown as {
  execSync: jest.Mock;
  runSync: jest.Mock;
  getFirstSync: jest.Mock;
  getAllSync: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  // Default: schema version matches
  mockDb.getFirstSync.mockReturnValue({ version: 1 });
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("CacheRepository", () => {
  describe("init", () => {
    it("creates tables and checks schema version", () => {
      new CacheRepository();

      // Should create both tables
      expect(mockDb.execSync).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS cache"),
      );
      expect(mockDb.execSync).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS schema_version"),
      );
      // Should query schema version
      expect(mockDb.getFirstSync).toHaveBeenCalledWith(
        expect.stringContaining("SELECT version FROM schema_version"),
      );
    });

    it("resets cache on schema version mismatch", () => {
      mockDb.getFirstSync.mockReturnValue({ version: 0 });

      new CacheRepository();

      // Should delete old data
      expect(mockDb.execSync).toHaveBeenCalledWith("DELETE FROM cache");
      expect(mockDb.execSync).toHaveBeenCalledWith(
        "DELETE FROM schema_version",
      );
      // Should insert new version
      expect(mockDb.runSync).toHaveBeenCalledWith(
        "INSERT INTO schema_version (version) VALUES (?)",
        1,
      );
    });

    it("resets cache when no schema version row exists", () => {
      mockDb.getFirstSync.mockReturnValue(null);

      new CacheRepository();

      expect(mockDb.execSync).toHaveBeenCalledWith("DELETE FROM cache");
      expect(mockDb.runSync).toHaveBeenCalledWith(
        "INSERT INTO schema_version (version) VALUES (?)",
        1,
      );
    });
  });

  describe("get / set", () => {
    it("returns null for missing key", () => {
      mockDb.getFirstSync
        .mockReturnValueOnce({ version: 1 }) // init
        .mockReturnValueOnce(null); // get

      const repo = new CacheRepository();
      expect(repo.get("missing")).toBeNull();
    });

    it("calls runSync with correct params on set", () => {
      const repo = new CacheRepository();
      const now = Date.now();

      jest.spyOn(Date, "now").mockReturnValue(now);
      repo.set("k1", { hello: "world" }, 5000);

      expect(mockDb.runSync).toHaveBeenCalledWith(
        "INSERT OR REPLACE INTO cache (key, data, ttl, createdAt) VALUES (?, ?, ?, ?)",
        "k1",
        JSON.stringify({ hello: "world" }),
        5000,
        now,
      );

      jest.restoreAllMocks();
    });

    it("returns parsed data for valid cached entry", () => {
      const data = { items: [1, 2, 3] };
      mockDb.getFirstSync
        .mockReturnValueOnce({ version: 1 }) // init
        .mockReturnValueOnce({
          data: JSON.stringify(data),
          ttl: null,
          createdAt: Date.now(),
        });

      const repo = new CacheRepository();
      expect(repo.get("k1")).toEqual(data);
    });

    it("returns null and deletes entry when TTL expired", () => {
      const pastTime = Date.now() - 10000;
      mockDb.getFirstSync
        .mockReturnValueOnce({ version: 1 }) // init
        .mockReturnValueOnce({
          data: JSON.stringify({ old: true }),
          ttl: 5000,
          createdAt: pastTime,
        });

      const repo = new CacheRepository();
      expect(repo.get("k1")).toBeNull();
      expect(mockDb.runSync).toHaveBeenCalledWith(
        "DELETE FROM cache WHERE key = ?",
        "k1",
      );
    });
  });

  describe("clear", () => {
    it("deletes all cache entries", () => {
      const repo = new CacheRepository();
      repo.clear();

      // The last execSync call should be the clear
      expect(mockDb.execSync).toHaveBeenCalledWith("DELETE FROM cache");
    });
  });
});

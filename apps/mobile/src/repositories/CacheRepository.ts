import * as SQLite from "expo-sqlite";

const SCHEMA_VERSION = 1;

export class CacheRepository {
  private db: SQLite.SQLiteDatabase;

  constructor() {
    this.db = SQLite.openDatabaseSync("dpf-cache");
    this.init();
  }

  private init() {
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        ttl INTEGER,
        createdAt INTEGER NOT NULL
      )
    `);
    this.db.execSync(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      )
    `);

    const row = this.db.getFirstSync<{ version: number }>(
      "SELECT version FROM schema_version LIMIT 1",
    );
    if (!row || row.version !== SCHEMA_VERSION) {
      this.db.execSync("DELETE FROM cache");
      this.db.execSync("DELETE FROM schema_version");
      this.db.runSync(
        "INSERT INTO schema_version (version) VALUES (?)",
        SCHEMA_VERSION,
      );
    }
  }

  get<T>(key: string): T | null {
    const row = this.db.getFirstSync<{
      data: string;
      ttl: number | null;
      createdAt: number;
    }>("SELECT data, ttl, createdAt FROM cache WHERE key = ?", key);

    if (!row) return null;

    if (row.ttl && Date.now() - row.createdAt > row.ttl) {
      this.db.runSync("DELETE FROM cache WHERE key = ?", key);
      return null;
    }

    return JSON.parse(row.data) as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    this.db.runSync(
      "INSERT OR REPLACE INTO cache (key, data, ttl, createdAt) VALUES (?, ?, ?, ?)",
      key,
      JSON.stringify(data),
      ttlMs ?? null,
      Date.now(),
    );
  }

  delete(key: string): void {
    this.db.runSync("DELETE FROM cache WHERE key = ?", key);
  }

  clear(): void {
    this.db.execSync("DELETE FROM cache");
  }
}

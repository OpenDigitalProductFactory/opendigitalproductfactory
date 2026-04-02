// apps/web/lib/sandbox-promotion.test.ts
// Pure-function tests only — do NOT test Docker/DB operations (those are integration tests)

import { describe, it, expect } from "vitest";
import {
  DESTRUCTIVE_PATTERNS,
  scanForDestructiveOps,
  categorizeDiffFiles,
  getRestoreInstructions,
} from "./sandbox-promotion";

// ─── DESTRUCTIVE_PATTERNS ─────────────────────────────────────────────────────

describe("DESTRUCTIVE_PATTERNS", () => {
  it("has 6 patterns", () => {
    expect(DESTRUCTIVE_PATTERNS).toHaveLength(6);
  });
});

// ─── scanForDestructiveOps ────────────────────────────────────────────────────

describe("scanForDestructiveOps", () => {
  it("detects DROP TABLE", () => {
    const warnings = scanForDestructiveOps("DROP TABLE users;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DROP TABLE");
  });

  it("detects DROP COLUMN", () => {
    const warnings = scanForDestructiveOps("ALTER TABLE users DROP COLUMN email;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DROP COLUMN");
  });

  it("detects ALTER COLUMN TYPE change", () => {
    const warnings = scanForDestructiveOps(
      "ALTER TABLE users ALTER COLUMN age TYPE bigint;",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ALTER COLUMN");
  });

  it("detects RENAME TABLE", () => {
    const warnings = scanForDestructiveOps("RENAME TABLE old_name TO new_name;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RENAME TABLE");
  });

  it("detects RENAME COLUMN", () => {
    const warnings = scanForDestructiveOps(
      "ALTER TABLE users RENAME COLUMN old_col TO new_col;",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("RENAME COLUMN");
  });

  it("detects DELETE FROM", () => {
    const warnings = scanForDestructiveOps("DELETE FROM users WHERE id = 1;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("DELETE FROM");
  });

  it("detects TRUNCATE", () => {
    const warnings = scanForDestructiveOps("TRUNCATE TABLE sessions;");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("TRUNCATE");
  });

  it("returns empty for safe operations", () => {
    const safeSql = [
      "CREATE TABLE new_table (id SERIAL PRIMARY KEY);",
      "ALTER TABLE users ADD COLUMN phone TEXT;",
      "CREATE INDEX idx_users_email ON users (email);",
      "INSERT INTO config (key, value) VALUES ('setting', 'true');",
      "SELECT * FROM users;",
    ].join("\n");
    const warnings = scanForDestructiveOps(safeSql);
    expect(warnings).toHaveLength(0);
  });

  it("detects multiple destructive ops of different types", () => {
    const sql = [
      "DROP TABLE legacy_data;",
      "DELETE FROM sessions WHERE expired = true;",
      "TRUNCATE audit_log;",
    ].join("\n");
    const warnings = scanForDestructiveOps(sql);
    expect(warnings).toHaveLength(3);
  });

  it("detects duplicate same-pattern ops — each occurrence is its own warning", () => {
    const warnings = scanForDestructiveOps("DROP TABLE a;\nDROP TABLE b;");
    expect(warnings).toHaveLength(2);
  });

  it("is case-insensitive — lowercase matches too", () => {
    const warnings = scanForDestructiveOps("drop table users;");
    expect(warnings).toHaveLength(1);
  });

  it("is case-insensitive — mixed case matches too", () => {
    const warnings = scanForDestructiveOps("Drop Table Users;");
    expect(warnings).toHaveLength(1);
  });

  it("returns empty string array for empty SQL", () => {
    expect(scanForDestructiveOps("")).toEqual([]);
  });

  it("includes the matched text in the warning message", () => {
    const warnings = scanForDestructiveOps("DROP TABLE users;");
    expect(warnings[0]).toMatch(/DROP TABLE/i);
  });
});

// ─── categorizeDiffFiles ──────────────────────────────────────────────────────

describe("categorizeDiffFiles", () => {
  it("separates migration files from code files", () => {
    const files = [
      "prisma/migrations/20260319_add_users/migration.sql",
      "apps/web/lib/auth.ts",
      "prisma/migrations/20260319_add_sessions/migration.sql",
      "apps/web/app/api/route.ts",
    ];
    const result = categorizeDiffFiles(files);
    expect(result.migrationFiles).toHaveLength(2);
    expect(result.codeFiles).toHaveLength(2);
    expect(result.migrationFiles).toContain(
      "prisma/migrations/20260319_add_users/migration.sql",
    );
    expect(result.migrationFiles).toContain(
      "prisma/migrations/20260319_add_sessions/migration.sql",
    );
    expect(result.codeFiles).toContain("apps/web/lib/auth.ts");
    expect(result.codeFiles).toContain("apps/web/app/api/route.ts");
  });

  it("handles empty list", () => {
    const result = categorizeDiffFiles([]);
    expect(result.migrationFiles).toHaveLength(0);
    expect(result.codeFiles).toHaveLength(0);
  });

  it("handles all migration files", () => {
    const files = [
      "prisma/migrations/001/migration.sql",
      "prisma/migrations/002/migration.sql",
    ];
    const result = categorizeDiffFiles(files);
    expect(result.migrationFiles).toHaveLength(2);
    expect(result.codeFiles).toHaveLength(0);
  });

  it("handles all code files", () => {
    const files = ["apps/web/lib/auth.ts", "packages/db/prisma/schema.prisma"];
    const result = categorizeDiffFiles(files);
    expect(result.migrationFiles).toHaveLength(0);
    expect(result.codeFiles).toHaveLength(2);
  });

  it("only classifies paths starting with prisma/migrations/ as migration files", () => {
    // schema.prisma is NOT a migration file
    const files = [
      "packages/db/prisma/schema.prisma",
      "prisma/migrations/001/migration.sql",
    ];
    const result = categorizeDiffFiles(files);
    expect(result.migrationFiles).toHaveLength(1);
    expect(result.codeFiles).toHaveLength(1);
    expect(result.codeFiles).toContain("packages/db/prisma/schema.prisma");
  });
});

// ─── getRestoreInstructions ───────────────────────────────────────────────────

describe("getRestoreInstructions", () => {
  const backupPath = "/backups/backup-FB-ABC12345-2026-03-19.sql";
  let instructions: string;

  it("includes the backup file path", () => {
    instructions = getRestoreInstructions(backupPath);
    expect(instructions).toContain(backupPath);
  });

  it("includes psql restore command", () => {
    const result = getRestoreInstructions(backupPath);
    expect(result).toContain("psql");
    expect(result).toContain(backupPath);
  });

  it("includes git revert guidance", () => {
    const result = getRestoreInstructions(backupPath);
    expect(result).toMatch(/git revert|git apply -R/);
  });

  it("includes prisma migrate status for verification", () => {
    const result = getRestoreInstructions(backupPath);
    expect(result).toContain("pnpm prisma migrate status");
  });

  it("includes pnpm test for verification", () => {
    const result = getRestoreInstructions(backupPath);
    expect(result).toContain("pnpm test");
  });

  it("returns a non-empty string", () => {
    const result = getRestoreInstructions(backupPath);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("produces different output for different backup paths", () => {
    const result1 = getRestoreInstructions("/backups/backup-a.sql");
    const result2 = getRestoreInstructions("/backups/backup-b.sql");
    expect(result1).not.toBe(result2);
  });
});

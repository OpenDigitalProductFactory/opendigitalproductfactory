import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  adminActivityCreate: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    adminActivity: { create: (...a: unknown[]) => db.adminActivityCreate(...a) },
    $queryRawUnsafe: (...a: unknown[]) => db.queryRawUnsafe(...a),
  },
}));

import { adminPack } from "./admin-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const EXPECTED_TOOLS = [
  "admin_view_logs",
  "admin_query_db",
  "admin_read_file",
  "admin_restart_service",
  "admin_run_migration",
  "admin_run_seed",
  "admin_run_command",
];

// Gating metadata that MUST be preserved verbatim across the extraction — the
// admin cluster runs arbitrary command/SQL/migration execution, so a drift in
// requiredCapability or the sideEffect tier is a security regression, not a
// cosmetic change. Tier: Tier 1 read-only (sideEffect false), Tier 2 reversible
// (sideEffect false), Tier 3 destructive (sideEffect true).
const EXPECTED_SIDE_EFFECT: Record<string, boolean> = {
  admin_view_logs: false,
  admin_query_db: false,
  admin_read_file: false,
  admin_restart_service: false,
  admin_run_migration: false,
  admin_run_seed: false,
  admin_run_command: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.adminActivityCreate.mockResolvedValue({});
});

describe("admin pack — registration", () => {
  it("exposes exactly the seven admin tools with a handler each", () => {
    expect(adminPack.definitions.map((d) => d.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
    expect(Object.keys(adminPack.handlers).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("descriptions are provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of adminPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  // GATING REGRESSION GUARD — every admin tool must keep requiredCapability
  // "view_admin" and its exact sideEffect tier. The MCP route gates on this
  // metadata, so a faithful copy is what preserves the operator-only gate.
  it("every definition preserves requiredCapability 'view_admin'", () => {
    for (const d of adminPack.definitions) {
      expect(d.requiredCapability).toBe("view_admin");
    }
  });

  it("every definition preserves its exact sideEffect tier flag", () => {
    for (const d of adminPack.definitions) {
      expect(d.sideEffect).toBe(EXPECTED_SIDE_EFFECT[d.name]);
    }
  });

  it("every definition runs in immediate execution mode", () => {
    for (const d of adminPack.definitions) {
      expect(d.executionMode).toBe("immediate");
    }
  });

  it("grants mirror agent-grants: read tools need admin_read, mutating tools need admin_write", () => {
    expect(adminPack.grants.admin_view_logs).toEqual(["admin_read"]);
    expect(adminPack.grants.admin_query_db).toEqual(["admin_read"]);
    expect(adminPack.grants.admin_read_file).toEqual(["admin_read"]);
    expect(adminPack.grants.admin_restart_service).toEqual(["admin_write"]);
    expect(adminPack.grants.admin_run_migration).toEqual(["admin_write"]);
    expect(adminPack.grants.admin_run_seed).toEqual(["admin_write"]);
    expect(adminPack.grants.admin_run_command).toEqual(["admin_write"]);

    expect(isToolAllowedByGrants("admin_view_logs", ["admin_read"])).toBe(true);
    expect(isToolAllowedByGrants("admin_run_command", ["admin_write"])).toBe(true);
    // A read-only grant must NOT unlock a mutating admin tool.
    expect(isToolAllowedByGrants("admin_run_command", ["admin_read"])).toBe(false);
  });
});

describe("admin pack — handler behavior (delegation preserved)", () => {
  it("admin_view_logs rejects an unknown service without shelling out", async () => {
    const res = await adminPack.handlers.admin_view_logs({ service: "not-a-service" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Invalid service");
    expect(db.adminActivityCreate).not.toHaveBeenCalled();
  });

  it("admin_query_db blocks a non-SELECT query and audit-logs the block", async () => {
    const res = await adminPack.handlers.admin_query_db({ sql: "DELETE FROM users" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Only SELECT");
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
    // The block is recorded to the admin audit trail.
    expect(db.adminActivityCreate).toHaveBeenCalledOnce();
    const arg = db.adminActivityCreate.mock.calls[0][0] as { data: { result: string; toolName: string } };
    expect(arg.data.toolName).toBe("admin_query_db");
    expect(arg.data.result).toBe("blocked");
  });

  it("admin_query_db blocks DML/DDL keywords smuggled after a SELECT", async () => {
    const res = await adminPack.handlers.admin_query_db(
      { sql: "SELECT 1; DROP TABLE users" },
      "u1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain("forbidden keywords");
    expect(db.queryRawUnsafe).not.toHaveBeenCalled();
  });

  // REGRESSION: the row cap was applied as `sql + " LIMIT 1000"`, so any query
  // that supplied its own LIMIT produced `... LIMIT 30 LIMIT 1000` — a
  // Postgres syntax error rather than a capped result.
  it("admin_query_db respects a caller-supplied LIMIT instead of appending a second one", async () => {
    db.queryRawUnsafe.mockResolvedValue([]);
    await adminPack.handlers.admin_query_db({ sql: 'SELECT * FROM "Epic" LIMIT 30' }, "u1");
    expect(db.queryRawUnsafe).toHaveBeenCalledWith('SELECT * FROM "Epic" LIMIT 30');
  });

  it("admin_query_db strips a trailing semicolon before appending the row cap", async () => {
    db.queryRawUnsafe.mockResolvedValue([]);
    await adminPack.handlers.admin_query_db({ sql: 'SELECT * FROM "Epic";' }, "u1");
    expect(db.queryRawUnsafe).toHaveBeenCalledWith('SELECT * FROM "Epic" LIMIT 1000');
  });

  // REGRESSION: Postgres returns COUNT() as BigInt and JSON.stringify throws on
  // it, so every aggregate query failed with "Do not know how to serialize a
  // BigInt" before it could be returned or audit-logged.
  it("admin_query_db serializes BigInt aggregate results instead of throwing", async () => {
    db.queryRawUnsafe.mockResolvedValue([{ epics: BigInt(137), items: BigInt(1799) }]);
    const res = await adminPack.handlers.admin_query_db({ sql: 'SELECT COUNT(*) AS epics FROM "Epic"' }, "u1");
    expect(res.success).toBe(true);
    expect((res.data as { rows: unknown[] }).rows).toEqual([{ epics: 137, items: 1799 }]);
  });

  it("admin_query_db keeps BigInt values beyond Number.MAX_SAFE_INTEGER as strings", async () => {
    db.queryRawUnsafe.mockResolvedValue([{ big: BigInt("9007199254740993") }]);
    const res = await adminPack.handlers.admin_query_db({ sql: "SELECT 1" }, "u1");
    expect((res.data as { rows: unknown[] }).rows).toEqual([{ big: "9007199254740993" }]);
  });

  it("admin_run_command blocks a command outside the allowlist", async () => {
    const res = await adminPack.handlers.admin_run_command({ command: "rm -rf /" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Only docker compose, git, and pnpm");
  });

  it("admin_run_command blocks a destructive allowlisted command", async () => {
    const res = await adminPack.handlers.admin_run_command({ command: "git push origin main" }, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("Destructive command blocked");
  });

  it("admin_read_file rejects a missing path without touching the filesystem", async () => {
    const res = await adminPack.handlers.admin_read_file({}, "u1");
    expect(res.success).toBe(false);
    expect(res.error).toContain("path is required");
  });
});

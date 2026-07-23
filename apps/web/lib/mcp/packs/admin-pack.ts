// Admin operator tool pack — EP-8DC217EB BET-4.
//
// Drains the operator-only admin cluster out of the mcp-tools.ts executeTool
// switch: the seven tools the platform admin co-worker uses to inspect and
// operate the running install — view container logs, run read-only SQL, read a
// project file, restart a service, run migrations, run the seed, and run an
// allowlisted shell command. These are SENSITIVE: they execute arbitrary
// commands, SQL, and migrations, so every tool is gated by
// `requiredCapability: "view_admin"` and grant-gated through agent-grants.ts.
// The gating is enforced by the MCP route reading this definition metadata plus
// the acting agent's grants — NOT by the switch body — so a verbatim metadata
// copy preserves the gate. Each handler reproduces the former switch case
// byte-for-byte, and every call is audit-logged to AdminActivity via the local
// logAdminActivity helper moved here from mcp-tools.ts.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { prisma } from "@dpf/db";

import { lazyFsPromises, lazyPath, lazyChildProcess, lazyUtil, getCwd } from "@/lib/shared/lazy-node";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

// These tools are available on the /admin route for platform administration.
// Tier 1 = read-only, Tier 2 = reversible, Tier 3 = destructive (sideEffect: true).
const definitions: ToolDefinition[] = [
  {
    name: "admin_view_logs",
    description: "View recent logs from a Docker Compose service. Returns the last N lines (default 100).",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name: portal, sandbox, postgres, neo4j, qdrant, portal-init" },
        lines: { type: "number", description: "Number of lines to return (default 100, max 500)" },
      },
      required: ["service"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "admin_query_db",
    description: "Run a read-only SQL query against the portal database. Only SELECT statements are permitted. Capped at 1000 rows; a LIMIT you supply yourself is respected. Aggregates (COUNT/SUM) are supported — BigInt results are returned as numbers.",
    inputSchema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "SQL SELECT query to execute" },
      },
      required: ["sql"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "admin_read_file",
    description: "Read a file within the project directory. Path must be relative to PROJECT_ROOT. Sensitive files (.env, *.key, *.pem) are excluded.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root, e.g. docker-compose.yml or apps/web/lib/mcp-tools.ts" },
        offset: { type: "number", description: "Start reading from this line number (1-based)" },
        limit: { type: "number", description: "Maximum number of lines to read" },
      },
      required: ["path"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "admin_restart_service",
    description: "Restart a platform service's container. Use when a service is down or unhealthy and a restart is the indicated remediation.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name: portal, sandbox, postgres, neo4j, qdrant" },
      },
      required: ["service"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_migration",
    description: "Run 'prisma migrate deploy' inside the portal container to apply pending database migrations.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_seed",
    description: "Run the database seed script inside the portal container to populate reference data.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_command",
    description: "Run a shell command in the project directory. Only docker compose, git, and pnpm commands are permitted. Destructive commands require user confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run (docker compose, git, or pnpm only)" },
      },
      required: ["command"],
    },
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: true, // Tier 3: potentially destructive
  },
];

/** Fire-and-forget: log admin tool activity to AdminActivity for the audit trail. */
function logAdminActivity(
  userId: string, toolName: string, parameters: Record<string, unknown>,
  result: string, tier: number, summary?: string,
): Promise<void> {
  return prisma.adminActivity.create({
    data: { userId, toolName, parameters: parameters as any, result, tier, summary: summary?.slice(0, 500) },
  }).then(() => {}).catch(() => {});
}

async function adminViewLogs(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const service = String(params.service ?? "");
  const lines = Math.min(Number(params.lines) || 100, 500);
  const ALLOWED_SERVICES = ["portal", "sandbox", "postgres", "neo4j", "qdrant", "portal-init", "browser-use"];
  if (!ALLOWED_SERVICES.includes(service)) {
    return { success: false, error: `Invalid service. Allowed: ${ALLOWED_SERVICES.join(", ")}`, message: `Unknown service "${service}".` };
  }
  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);
    const { stdout } = await execAsync(`docker compose logs ${service} --tail ${lines} --no-color 2>&1`, {
      cwd: process.env.PROJECT_ROOT || "/app",
      timeout: 15_000,
    });
    await logAdminActivity(userId, "admin_view_logs", { service, lines }, "success", 1, stdout.slice(0, 500));
    return { success: true, message: `Last ${lines} lines from ${service}:`, data: { service, output: stdout.slice(0, 30000) } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? "Failed";
    await logAdminActivity(userId, "admin_view_logs", { service, lines }, "error", 1, msg);
    return { success: true, message: `Logs from ${service}:`, data: { service, output: msg } };
  }
}

const ADMIN_QUERY_ROW_CAP = 1000;

// The row cap used to be applied as `sql + " LIMIT 1000"`, which is a syntax
// error for any query that already ends in its own LIMIT or a trailing
// semicolon. Strip the terminator, and only append the cap when the caller
// has not already bounded the result themselves.
function applyRowCap(sql: string): string {
  const stripped = sql.replace(/;\s*$/, "").trim();
  return /\blimit\s+\d+\s*$/i.test(stripped) ? stripped : `${stripped} LIMIT ${ADMIN_QUERY_ROW_CAP}`;
}

// Postgres returns COUNT()/SUM() as BigInt and Prisma hands it straight
// through; JSON.stringify throws on BigInt, so an unsanitized aggregate query
// fails before it can be returned or audit-logged. Numbers beyond the safe
// integer range degrade to a string rather than losing precision silently.
function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

async function adminQueryDb(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const sql = String(params.sql ?? "").trim();
  if (!sql) return { success: false, error: "sql is required.", message: "Provide a SQL query." };
  // Only allow SELECT (and WITH ... SELECT)
  // CodeQL #23 (js/polynomial-redos): bound the unbounded `.*` and
  // `[\s\S]*?` runs so adversarial SQL with thousands of `-` or
  // `/*` chars can't trigger polynomial backtracking. SQL queries
  // in this tool are bounded by the admin tool surface; 100k chars
  // is well above any legitimate query.
  const normalized = sql
    .slice(0, 100_000)
    .replace(/--[^\n]{0,10000}/gm, "")
    .replace(/\/\*[\s\S]{0,10000}?\*\//g, "")
    .trim();
  if (!/^(SELECT|WITH)\b/i.test(normalized)) {
    await logAdminActivity(userId, "admin_query_db", { sql }, "blocked", 1, "Only SELECT queries permitted");
    return { success: false, error: "Only SELECT queries are permitted.", message: "This tool is read-only. Use SELECT statements only." };
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(normalized)) {
    await logAdminActivity(userId, "admin_query_db", { sql }, "blocked", 1, "DML/DDL detected in query");
    return { success: false, error: "Query contains forbidden keywords (INSERT, UPDATE, DELETE, DROP, etc).", message: "This tool is read-only." };
  }
  try {
    const result = await prisma.$queryRawUnsafe(applyRowCap(normalized)) as unknown[];
    // Postgres COUNT()/SUM() come back as BigInt, which JSON.stringify throws
    // on. Sanitize before both the preview and the returned payload, or every
    // aggregate query fails with "Do not know how to serialize a BigInt".
    const rows = toJsonSafe(result) as unknown[];
    const preview = JSON.stringify(rows).slice(0, 500);
    await logAdminActivity(userId, "admin_query_db", { sql }, "success", 1, `${rows.length} rows. ${preview}`);
    return { success: true, message: `Query returned ${rows.length} row(s).`, data: { sql, rows, rowCount: rows.length } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? "Query failed";
    await logAdminActivity(userId, "admin_query_db", { sql }, "error", 1, msg);
    return { success: false, error: msg, message: `Query failed: ${msg}` };
  }
}

async function adminReadFile(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const filePath = String(params.path ?? "");
  if (!filePath) return { success: false, error: "path is required.", message: "Provide a file path." };
  const { resolve, join } = lazyPath();
  const { readFile } = lazyFsPromises();
  const root = process.env.PROJECT_ROOT ? resolve(process.env.PROJECT_ROOT) : resolve(getCwd(), "..", "..");
  const resolved = resolve(join(root, filePath));
  if (!resolved.startsWith(root)) {
    await logAdminActivity(userId, "admin_read_file", { path: filePath }, "blocked", 1, "Path traversal");
    return { success: false, error: "Path traversal blocked.", message: "File path must be within the project directory." };
  }
  // Block sensitive files
  const lower = filePath.toLowerCase();
  if (/\.(env|key|pem)$/.test(lower) || /secret/i.test(lower) || lower.includes(".env")) {
    await logAdminActivity(userId, "admin_read_file", { path: filePath }, "blocked", 1, "Sensitive file");
    return { success: false, error: "Sensitive file blocked.", message: "Cannot read .env, .key, .pem, or *secret* files through this tool." };
  }
  try {
    const raw = await readFile(resolved, "utf-8");
    const allLines = raw.split("\n");
    const offset = params.offset ? Number(params.offset) : 1;
    const limit = params.limit ? Number(params.limit) : allLines.length;
    const startLine = offset - 1;
    const slice = allLines.slice(startLine, startLine + limit);
    const numbered = slice.map((line: string, i: number) => `${String(startLine + i + 1).padStart(6)}\t${line}`).join("\n");
    await logAdminActivity(userId, "admin_read_file", { path: filePath, offset, limit }, "success", 1, `${slice.length} lines`);
    return { success: true, message: `File: ${filePath} (${slice.length} lines)`, data: { path: filePath, content: numbered } };
  } catch {
    return { success: false, error: `File not found: ${filePath}`, message: `Could not read ${filePath}` };
  }
}

async function adminRestartService(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const service = String(params.service ?? "");
  // Label-resolved `docker restart` — the runtime image ships no compose
  // file, so `docker compose restart` always failed here (BI-01EA3EBE).
  const { restartPlatformService } = await import("@/lib/operate/service-restart");
  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);
    await logAdminActivity(userId, "admin_restart_service", { service }, "success", 2, `Restarting ${service}`);
    const result = await restartPlatformService(service, execAsync);
    if (!result.success) {
      return { success: false, error: result.error ?? result.message, message: result.message };
    }
    return { success: true, message: result.message, data: { service, container: result.container } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 500) ?? "Restart failed";
    return { success: false, error: msg, message: `Failed to restart ${service}: ${msg}` };
  }
}

async function adminRunMigration(_params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);
    await logAdminActivity(userId, "admin_run_migration", {}, "success", 2, "Running prisma migrate deploy");
    const { stdout, stderr } = await execAsync(
      `docker compose exec -T portal pnpm --filter @dpf/db exec prisma migrate deploy 2>&1`,
      { cwd: process.env.PROJECT_ROOT || "/app", timeout: 120_000 },
    );
    const output = (stdout + "\n" + stderr).trim();
    return { success: true, message: "Migration deploy complete.", data: { output: output.slice(0, 5000) } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 1000) ?? "Migration failed";
    return { success: false, error: msg, message: `Migration failed: ${msg}` };
  }
}

async function adminRunSeed(_params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);
    await logAdminActivity(userId, "admin_run_seed", {}, "success", 2, "Running seed");
    const { stdout, stderr } = await execAsync(
      `docker compose exec -T portal pnpm --filter @dpf/db run seed 2>&1`,
      { cwd: process.env.PROJECT_ROOT || "/app", timeout: 300_000 },
    );
    const output = (stdout + "\n" + stderr).trim();
    return { success: true, message: "Seed complete.", data: { output: output.slice(0, 5000) } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 1000) ?? "Seed failed";
    return { success: false, error: msg, message: `Seed failed: ${msg}` };
  }
}

async function adminRunCommand(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const command = String(params.command ?? "").trim();
  if (!command) return { success: false, error: "command is required.", message: "Provide a command." };

  // Allowlist: only docker compose, git, and pnpm commands
  if (!/^(docker compose|git|pnpm)\b/.test(command)) {
    await logAdminActivity(userId, "admin_run_command", { command }, "blocked", 3, "Command not in allowlist");
    return {
      success: false,
      error: "Only docker compose, git, and pnpm commands are permitted.",
      message: `Command blocked: "${command.slice(0, 80)}". Only docker compose, git, and pnpm commands are allowed.`,
    };
  }

  // Block destructive patterns
  const ADMIN_BLOCKED = [
    /rm\s+-rf/i,
    /docker compose\s+down/i,
    /git\s+push/i,
    /git\s+reset\s+--hard/i,
    /prisma\s+migrate\s+reset/i,
    /curl\s+.*\|\s*(ba)?sh/i,
    /wget\s+.*\|\s*(ba)?sh/i,
    /--privileged/i,
    /--force/i,
  ];
  const blocked = ADMIN_BLOCKED.find(p => p.test(command));
  if (blocked) {
    await logAdminActivity(userId, "admin_run_command", { command }, "blocked", 3, "Destructive command blocked");
    return {
      success: false,
      error: "Destructive command blocked by safety policy.",
      message: `This command is blocked: "${command.slice(0, 80)}". Destructive operations (rm -rf, docker compose down, git push, --force) require manual execution in the terminal.`,
    };
  }

  try {
    const { exec: execCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    const execAsync = promisify(execCb);
    await logAdminActivity(userId, "admin_run_command", { command }, "success", 2, `Running: ${command.slice(0, 200)}`);
    const { stdout, stderr } = await execAsync(command + " 2>&1", {
      cwd: process.env.PROJECT_ROOT || "/app",
      timeout: 60_000,
    });
    const output = (stdout + "\n" + stderr).trim();
    return { success: true, message: `Command completed.`, data: { command, output: output.slice(0, 15000) } };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string };
    const output = ((execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "")).trim();
    if (output) return { success: true, message: "Command exited with error.", data: { command, output: output.slice(0, 15000) } };
    return { success: false, error: (execErr.message ?? "Command failed").slice(0, 1000), message: `Failed: ${command.slice(0, 80)}` };
  }
}

const handlers: Record<string, ToolPackHandler> = {
  admin_view_logs: (params, userId) => adminViewLogs(params, userId),
  admin_query_db: (params, userId) => adminQueryDb(params, userId),
  admin_read_file: (params, userId) => adminReadFile(params, userId),
  admin_restart_service: (params, userId) => adminRestartService(params, userId),
  admin_run_migration: (params, userId) => adminRunMigration(params, userId),
  admin_run_seed: (params, userId) => adminRunSeed(params, userId),
  admin_run_command: (params, userId) => adminRunCommand(params, userId),
};

export const adminPack: ToolPack = {
  packId: "admin",
  definitions,
  handlers,
  grants: {
    admin_view_logs: ["admin_read"],
    admin_query_db: ["admin_read"],
    admin_read_file: ["admin_read"],
    admin_restart_service: ["admin_write"],
    admin_run_migration: ["admin_write"],
    admin_run_seed: ["admin_write"],
    admin_run_command: ["admin_write"],
  },
};

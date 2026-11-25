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
import { ACTUATOR_SERVICE_LOG_NAMES, hasPrivateActuatorMount, readActuatorProjectContainers, readActuatorServiceLogs } from "../../../../../scripts/lib/scope-writer-observation.mjs";

import { lazyFsPromises, lazyPath, lazyChildProcess, lazyUtil, getCwd } from "@/lib/shared/lazy-node";
import type { RegisteredToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { parseAdminDiagnostic } from "../admin-command-diagnostic";
import { stripSqlComments } from "../sql-comments";

// These tools are available on the /admin route for platform administration.
// Tier 1 = read-only, Tier 2 = reversible, Tier 3 = destructive (sideEffect: true).
const definitions: RegisteredToolDefinition[] = [
  {
    name: "admin_view_logs",
    description: "View recent logs from a Docker Compose service. Returns the last N lines (default 100).",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "Service name: portal, sandbox, postgres, portal-init, browser-use" },
        lines: { type: "number", description: "Number of lines to return (default 100, max 500)" },
      },
      required: ["service"],
    },
    workroomAccess: "outside-workroom",
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
    workroomAccess: "outside-workroom",
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
    workroomAccess: "outside-workroom",
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
        service: { type: "string", description: "Service name: portal, sandbox, postgres" },
      },
      required: ["service"],
    },
    workroomAccess: "outside-workroom",
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_migration",
    description: "Run 'prisma migrate deploy' inside the portal container to apply pending database migrations.",
    inputSchema: { type: "object", properties: {} },
    workroomAccess: "outside-workroom",
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_seed",
    description: "Run the database seed script inside the portal container to populate reference data.",
    inputSchema: { type: "object", properties: {} },
    workroomAccess: "outside-workroom",
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: false, // Tier 2: reversible
  },
  {
    name: "admin_run_command",
    description: "Run a bounded project diagnostic. Supports Docker Compose ps and logs, Git status and Git rev-parse. Use the dedicated tools for service, migration and recovery actions.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "A supported Docker Compose or Git diagnostic" },
      },
      required: ["command"],
    },
    workroomAccess: "outside-workroom",
    requiredCapability: "view_admin",
    executionMode: "immediate",
    sideEffect: true, // Preserve the public grant and consequence floor.
    consequence: "irreversible",
    consequenceForCall: async ({ params }) => parseAdminDiagnostic(params.command)
      ? { consequence: null, reason: "bounded-local-diagnostic" }
      : { consequence: "irreversible", reason: "command-effect-not-proven-routine" },
  },
];

// `docker compose` resolves its config file from cwd. PROJECT_ROOT (/workspace)
// is the Build Studio self-dev source volume — image-synced, no compose file
// ever lands there (docker-entrypoint.sh only copies TS source). DPF_REPO_ROOT
// (/host-dpf) is the live bind mount of the host's real install directory and
// does carry docker-compose.yml, so it's the correct cwd for any `docker
// compose` invocation (BI-7A87A155; mirrors the DPF_REPO_ROOT convention in
// lib/verify/git-ancestry.ts and lib/work-capsules/mcp-handlers.ts).
export function composeCwd(): string {
  return process.env.DPF_REPO_ROOT || process.env.PROJECT_ROOT || "/app";
}

/** Fire-and-forget: log admin tool activity to AdminActivity for the audit trail. */
function logAdminActivity(
  userId: string, toolName: string, parameters: Record<string, unknown>,
  result: string, tier: number, summary?: string,
): Promise<void> {
  return prisma.adminActivity.create({
    data: { userId, toolName, parameters: parameters as any, result, tier, summary: summary?.slice(0, 500) },
  }).then(() => {}).catch(() => {});
}

function hasPortalActuator(): Promise<boolean> {
  return lazyFsPromises().readFile("/proc/self/mountinfo").then(hasPrivateActuatorMount, () => false);
}

async function adminViewLogs(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const service = String(params.service ?? "");
  const lines = Math.max(1, Math.min(Math.trunc(Number(params.lines) || 100), 500));
  if (!ACTUATOR_SERVICE_LOG_NAMES.includes(service)) {
    return { success: false, error: `Invalid service. Allowed: ${ACTUATOR_SERVICE_LOG_NAMES.join(", ")}`, message: `Unknown service "${service}".` };
  }
  try {
    const usesActuator = await hasPortalActuator();
    let stdout: string;
    if (usesActuator) {
      const logs = await readActuatorServiceLogs(service, lines) as { output?: unknown };
      if (typeof logs.output !== "string") throw new Error("actuator_log_service_unavailable");
      stdout = logs.output;
    } else {
      const { exec: execCb } = lazyChildProcess();
      const { promisify } = lazyUtil();
      const result = await promisify(execCb)(`docker compose logs ${service} --tail ${lines} --no-color 2>&1`, {
        cwd: composeCwd(), timeout: 15_000,
      });
      stdout = result.stdout;
    }
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
  // Normalize actual comments without altering quoted SQL. The helper bounds
  // input and refuses incomplete text before the existing read-only checks.
  let normalized: string;
  try {
    normalized = stripSqlComments(sql);
  } catch (err) {
    const error = (err as Error).message;
    await logAdminActivity(userId, "admin_query_db", { sql }, "blocked", 1, error);
    return { success: false, error, message: "Provide complete SQL within the character limit." };
  }
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
    await logAdminActivity(userId, "admin_run_migration", {}, "success", 2, "Running prisma migrate deploy");
    const { stdout, stderr } = await runAdminDatabaseMaintenance("migrate");
    const output = (stdout + "\n" + stderr).trim();
    return { success: true, message: "Migration deploy complete.", data: { output: output.slice(0, 5000) } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 1000) ?? "Migration failed";
    return { success: false, error: msg, message: `Migration failed: ${msg}` };
  }
}

async function adminRunSeed(_params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  try {
    await logAdminActivity(userId, "admin_run_seed", {}, "success", 2, "Running seed");
    const { stdout, stderr } = await runAdminDatabaseMaintenance("seed");
    const output = (stdout + "\n" + stderr).trim();
    return { success: true, message: "Seed complete.", data: { output: output.slice(0, 5000) } };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 1000) ?? "Seed failed";
    return { success: false, error: msg, message: `Seed failed: ${msg}` };
  }
}

async function runAdminDatabaseMaintenance(action: "migrate" | "seed") {
  const { exec, execFile } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const migrate = action === "migrate";
  const args = ["--filter", "@dpf/db", ...(migrate ? ["exec", "prisma", "migrate", "deploy"] : ["run", "seed"])];
  const timeout = migrate ? 120_000 : 300_000;
  if (await hasPortalActuator()) return promisify(execFile)("/usr/local/bin/pnpm", args, { cwd: "/app", timeout });
  return promisify(exec)(`docker compose exec -T portal pnpm ${args.join(" ")} 2>&1`, { cwd: composeCwd(), timeout });
}

async function adminRunCommand(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const command = typeof params.command === "string" ? params.command.trim() : "";
  if (!command) return { success: false, error: "command is required.", message: "Provide a command." };
  const diagnostic = parseAdminDiagnostic(params.command);
  if (!diagnostic) {
    await logAdminActivity(userId, "admin_run_command", { command: command.slice(0, 1_000) }, "blocked", 3, "Unsupported diagnostic");
    return { success: false, error: "unsupported_diagnostic",
      message: "Use Docker Compose ps or logs, Git status or Git rev-parse, or call the dedicated operation." };
  }

  try {
    const { execFile: execFileCb } = lazyChildProcess();
    const { promisify } = lazyUtil();
    await logAdminActivity(userId, "admin_run_command", { command }, "success", 1, `Running: ${command.slice(0, 200)}`);
    const options = { cwd: composeCwd(), timeout: 60_000 };
    const usesActuator = diagnostic.file === "docker" && await hasPortalActuator();
    const { stdout, stderr } = usesActuator
      ? { stdout: await runActuatorDiagnostic(diagnostic.args), stderr: "" }
      : await promisify(execFileCb)(diagnostic.file, diagnostic.args, options);
    const output = (stdout + "\n" + stderr).trim();
    return { success: true, message: `Command completed.`, data: { command, output: output.slice(0, 15000), exitCode: 0 } };
  } catch (err) {
    const execErr = err as { stdout?: string; stderr?: string; message?: string; code?: unknown; signal?: unknown };
    const output = ((execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "")).trim();
    const data = {
      command, output: output.slice(0, 15000),
      exitCode: typeof execErr.code === "number" && Number.isFinite(execErr.code) ? execErr.code : null,
      ...(typeof execErr.signal === "string" ? { signal: execErr.signal } : {}),
    };
    if (output) return { success: false, error: "command_failed", message: "Command exited with error.", data };
    return { success: false, error: (execErr.message ?? "Command failed").slice(0, 1000), message: `Failed: ${command.slice(0, 80)}`, data };
  }
}

async function runActuatorDiagnostic([, action, ...flags]: string[]): Promise<string> {
  if (action === "logs") {
    const tail = flags.lastIndexOf("--tail");
    const lines = tail < 0 ? 100 : Math.min(Number(flags[tail + 1]), 500);
    const named = flags.filter(flag => ACTUATOR_SERVICE_LOG_NAMES.includes(flag));
    const services = named.length ? named : (await readActuatorProjectContainers()).containers
      .map(({ Service }: { Service: string }) => Service).filter((service: string) => ACTUATOR_SERVICE_LOG_NAMES.includes(service));
    const logs = await Promise.all([...new Set<string>(services)].map(async service => {
      const { output } = await readActuatorServiceLogs(service, lines, { timestamps: flags.includes("--timestamps") });
      if (typeof output !== "string") throw new Error("actuator_log_service_unavailable");
      return output;
    }));
    return logs.join("\n");
  }
  const { containers } = await readActuatorProjectContainers() as {
    containers: Array<{ ID: string; Name: string; Service: string; State: string; Status: string }>;
  };
  const shown = flags.includes("--all") ? containers : containers.filter(row => ["running", "paused", "restarting"].includes(row.State));
  if (flags.includes("--quiet")) return shown.map(row => row.ID).join("\n");
  if (flags.includes("--services")) return [...new Set(shown.map(row => row.Service))].join("\n");
  if (flags.includes("--format")) return JSON.stringify(shown);
  return ["NAME\tSERVICE\tSTATUS", ...shown.map(row => `${row.Name}\t${row.Service}\t${row.Status}`)].join("\n");
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

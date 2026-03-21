# MCP Catalog Activation & External Services Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable a complete lifecycle for external MCP services — from catalog discovery through activation, health checking, tool discovery, and coworker tool execution.

**Architecture:** Two parallel tracks share the `McpServer` table. Track 1 builds the data path (schema → types → health check → tool discovery → tool registry integration). Track 2 builds the admin surface (services page → detail page → activation form → catalog enhancement). Both tracks are independently testable and commit-ready at every task boundary.

**Tech Stack:** Prisma (PostgreSQL), Next.js 15 App Router (server components + server actions), Vitest, TypeScript strict mode.

**Spec:** `docs/superpowers/specs/2026-03-20-mcp-activation-and-services-surface-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `apps/web/lib/mcp-server-types.ts` | Connection config types, health check result type, redactConfig() utility |
| `apps/web/lib/mcp-server-health.ts` | MCP initialize handshake health check for all transports |
| `apps/web/lib/mcp-server-tools.ts` | Tool discovery (tools/list), namespaced tool resolution, MCP tools/call execution |
| `apps/web/lib/actions/mcp-services.ts` | Server actions: activate, deactivate, checkHealth, toggleTool, queryServices |
| `apps/web/app/(shell)/platform/services/page.tsx` | Services list page (server component) |
| `apps/web/app/(shell)/platform/services/[serverId]/page.tsx` | Service detail page |
| `apps/web/app/(shell)/platform/services/activate/page.tsx` | Activation form page |
| `apps/web/components/platform/ServiceCard.tsx` | Service card component for grid display |
| `apps/web/components/platform/ServiceActivationForm.tsx` | Client component: transport picker, config form, test connection |
| `apps/web/components/platform/HealthCheckButton.tsx` | Client component: check now button with inline result |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Extend McpServer, add McpServerTool, add relation on McpIntegration |
| `apps/web/lib/mcp-tools.ts` | Extend getAvailableTools() and executeTool() for namespaced MCP server tools |
| `apps/web/components/platform/IntegrationCard.tsx` | Add Active badge / Activate button |
| `apps/web/app/(shell)/platform/integrations/page.tsx` | Join McpServer to show activation status |
| `apps/web/app/(shell)/platform/page.tsx` | Add "Services" nav card |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/lib/mcp-server-types.test.ts` | redactConfig(), config validation |
| `apps/web/lib/mcp-server-health.test.ts` | Health check per transport (mocked), serverless detection |
| `apps/web/lib/mcp-server-tools.test.ts` | Tool discovery parsing, namespacing, resolution |
| `apps/web/lib/actions/mcp-services.test.ts` | Activation flow, deactivation, permission checks |
| `apps/web/lib/mcp-tools-mcp-server.test.ts` | getAvailableTools() with MCP server tools, executeTool() routing |

---

## Track 1: Catalog Activation Bridge

### Task 1: Schema Extension — McpServer + McpServerTool

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (lines 684-691 for McpServer, lines 2918-2948 for McpIntegration)
- Create: migration via `pnpm migrate` from `packages/db/`

- [ ] **Step 1: Update McpServer model in schema.prisma**

Replace the existing McpServer model (lines 684-691) with the extended version:

```prisma
model McpServer {
  id              String    @id @default(cuid())
  serverId        String    @unique
  name            String
  config          Json
  status          String    @default("unconfigured")
  transport       String?
  category        String?
  tags            String[]  @default([])
  healthStatus    String    @default("unknown")
  lastHealthCheck DateTime?
  lastHealthError String?
  integrationId   String?
  activatedBy     String?
  activatedAt     DateTime?
  deactivatedAt   DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  integration     McpIntegration? @relation(fields: [integrationId], references: [id])
  tools           McpServerTool[]

  @@index([status])
  @@index([category])
}
```

- [ ] **Step 2: Add McpServerTool model after McpServer**

```prisma
model McpServerTool {
  id           String   @id @default(cuid())
  serverId     String
  toolName     String
  description  String?
  inputSchema  Json
  isEnabled    Boolean  @default(true)
  discoveredAt DateTime @default(now())
  updatedAt    DateTime @updatedAt

  server       McpServer @relation(fields: [serverId], references: [id], onDelete: Cascade)

  @@unique([serverId, toolName])
  @@index([serverId])
}
```

- [ ] **Step 3: Add reverse relation on McpIntegration**

Inside the `McpIntegration` model (after the `@@index` lines), add:

```prisma
  mcpServers    McpServer[]
```

- [ ] **Step 4: Generate and apply migration**

Run from repo root:
```bash
cd packages/db && pnpm migrate
```

When prompted for migration name, use: `extend_mcp_server_add_mcp_server_tool`

- [ ] **Step 5: Verify migration applied**

```bash
cd packages/db && npx prisma studio
```

Confirm McpServer has new columns and McpServerTool table exists. Existing McpServer rows should have `status: "unconfigured"`, `healthStatus: "unknown"`, `tags: []`, all new nullable fields as null.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(mcp): extend McpServer schema, add McpServerTool table

EP-MCP-ACT-001 Task 1: Schema foundation for MCP service activation.
Adds lifecycle fields (transport, health, activation metadata) to McpServer.
New McpServerTool table for discovered tools with cascade delete.
Prisma relations: McpServer → McpIntegration, McpServer → McpServerTool."
```

---

### Task 2: Connection Config Types & Redaction Utility

**Files:**
- Create: `apps/web/lib/mcp-server-types.ts`
- Test: `apps/web/lib/mcp-server-types.test.ts`

- [ ] **Step 1: Write failing tests for types and redaction**

Create `apps/web/lib/mcp-server-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  type McpConnectionConfig,
  type HealthCheckResult,
  redactConfig,
  validateConnectionConfig,
} from "./mcp-server-types";

describe("validateConnectionConfig", () => {
  it("accepts valid stdio config", () => {
    const config: McpConnectionConfig = { transport: "stdio", command: "npx", args: ["-y", "stripe-mcp"] };
    expect(validateConnectionConfig(config)).toEqual({ valid: true });
  });

  it("accepts valid sse config", () => {
    const config: McpConnectionConfig = { transport: "sse", url: "https://mcp.stripe.com/sse" };
    expect(validateConnectionConfig(config)).toEqual({ valid: true });
  });

  it("accepts valid http config", () => {
    const config: McpConnectionConfig = { transport: "http", url: "https://mcp.stripe.com/v1" };
    expect(validateConnectionConfig(config)).toEqual({ valid: true });
  });

  it("rejects stdio config without command", () => {
    const config = { transport: "stdio" } as McpConnectionConfig;
    expect(validateConnectionConfig(config)).toEqual({ valid: false, error: expect.stringContaining("command") });
  });

  it("rejects sse/http config without url", () => {
    const config = { transport: "sse" } as McpConnectionConfig;
    expect(validateConnectionConfig(config)).toEqual({ valid: false, error: expect.stringContaining("url") });
  });

  it("rejects unknown transport", () => {
    const config = { transport: "grpc" } as unknown as McpConnectionConfig;
    expect(validateConnectionConfig(config)).toEqual({ valid: false, error: expect.stringContaining("transport") });
  });
});

describe("redactConfig", () => {
  it("redacts sensitive header values", () => {
    const config = {
      transport: "http" as const,
      url: "https://api.stripe.com",
      headers: { Authorization: "Bearer sk_live_xxx", "Content-Type": "application/json" },
    };
    const redacted = redactConfig(config);
    expect(redacted.url).toBe("https://api.stripe.com");
    expect(redacted.headers?.Authorization).toBe("***");
    expect(redacted.headers?.["Content-Type"]).toBe("application/json");
  });

  it("redacts sensitive env values", () => {
    const config = {
      transport: "stdio" as const,
      command: "npx",
      args: ["-y", "stripe-mcp"],
      env: { STRIPE_API_KEY: "sk_live_xxx", NODE_ENV: "production" },
    };
    const redacted = redactConfig(config);
    expect(redacted.command).toBe("npx");
    expect(redacted.env?.STRIPE_API_KEY).toBe("***");
    expect(redacted.env?.NODE_ENV).toBe("production");
  });

  it("returns config unchanged when no sensitive fields", () => {
    const config = { transport: "http" as const, url: "https://example.com" };
    expect(redactConfig(config)).toEqual(config);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/mcp-server-types.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement types and redaction**

Create `apps/web/lib/mcp-server-types.ts`:

```typescript
// apps/web/lib/mcp-server-types.ts
// Connection config types and redaction for MCP servers.

// ─── Connection Config ──────────────────────────────────────────────────────

export type StdioConfig = {
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type SseConfig = {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type HttpConfig = {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
};

export type McpConnectionConfig = StdioConfig | SseConfig | HttpConfig;

export type McpTransport = McpConnectionConfig["transport"];

// ─── Health Check ───────────────────────────────────────────────────────────

export type HealthCheckResult = {
  healthy: boolean;
  latencyMs: number;
  error?: string;
  toolCount?: number;
};

// ─── Validation ─────────────────────────────────────────────────────────────

export function validateConnectionConfig(
  config: McpConnectionConfig
): { valid: true } | { valid: false; error: string } {
  if (!config || typeof config !== "object") {
    return { valid: false, error: "Config must be an object" };
  }
  const transport = (config as { transport?: string }).transport;
  if (transport === "stdio") {
    const c = config as StdioConfig;
    if (!c.command || typeof c.command !== "string") {
      return { valid: false, error: "stdio config requires a command string" };
    }
    return { valid: true };
  }
  if (transport === "sse" || transport === "http") {
    const c = config as SseConfig | HttpConfig;
    if (!c.url || typeof c.url !== "string") {
      return { valid: false, error: `${transport} config requires a url string` };
    }
    return { valid: true };
  }
  return { valid: false, error: `Unknown transport: ${String(transport)}. Expected "stdio", "sse", or "http"` };
}

// ─── Redaction ──────────────────────────────────────────────────────────────

const SENSITIVE_PATTERN = /secret|token|key|password|authorization|api_key|apikey/i;

function redactRecord(record: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    result[k] = SENSITIVE_PATTERN.test(k) ? "***" : v;
  }
  return result;
}

export function redactConfig<T extends McpConnectionConfig>(config: T): T {
  const copy = { ...config };
  if ("headers" in copy && copy.headers) {
    (copy as SseConfig | HttpConfig).headers = redactRecord(copy.headers);
  }
  if ("env" in copy && copy.env) {
    (copy as StdioConfig).env = redactRecord(copy.env);
  }
  return copy;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/mcp-server-types.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-server-types.ts apps/web/lib/mcp-server-types.test.ts
git commit -m "feat(mcp): add connection config types and redactConfig utility

EP-MCP-ACT-001 Task 2: McpConnectionConfig union type (stdio/sse/http),
validateConnectionConfig(), redactConfig() for stripping secrets from
headers and env vars. 6 tests."
```

---

### Task 3: Health Check — MCP Initialize Handshake

**Files:**
- Create: `apps/web/lib/mcp-server-health.ts`
- Test: `apps/web/lib/mcp-server-health.test.ts`

- [ ] **Step 1: Write failing tests for health check**

Create `apps/web/lib/mcp-server-health.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConnectionConfig } from "./mcp-server-types";

// Mock child_process for stdio tests
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

import { checkMcpServerHealth } from "./mcp-server-health";

describe("checkMcpServerHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  describe("http transport", () => {
    it("returns healthy when server responds with initialized", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: "2.0", result: { protocolVersion: "2024-11-05" } }),
      } as Response);

      const result = await checkMcpServerHealth({ transport: "http", url: "https://mcp.example.com" });
      expect(result.healthy).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("returns unhealthy on fetch error", async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new Error("Connection refused"));

      const result = await checkMcpServerHealth({ transport: "http", url: "https://mcp.example.com" });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain("Connection refused");
    });

    it("returns unhealthy on non-ok HTTP response", async () => {
      vi.mocked(globalThis.fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

      const result = await checkMcpServerHealth({ transport: "http", url: "https://mcp.example.com" });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain("500");
    });
  });

  describe("serverless detection", () => {
    it("rejects stdio transport on serverless runtime", async () => {
      vi.stubEnv("VERCEL", "1");
      const result = await checkMcpServerHealth({ transport: "stdio", command: "npx" });
      expect(result.healthy).toBe(false);
      expect(result.error).toContain("serverless");
      vi.unstubAllEnvs();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/mcp-server-health.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement health check**

Create `apps/web/lib/mcp-server-health.ts`:

```typescript
// apps/web/lib/mcp-server-health.ts
// MCP initialize handshake for all transports.

import type { McpConnectionConfig, HealthCheckResult } from "./mcp-server-types";

const HTTP_TIMEOUT_MS = 5_000;
const STDIO_TIMEOUT_MS = 10_000;

const MCP_INITIALIZE_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "dpf-health-check", version: "1.0.0" },
  },
};

function isServerless(): boolean {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
}

async function checkHttp(url: string, headers?: Record<string, string>): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(MCP_INITIALIZE_REQUEST),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { healthy: false, latencyMs, error: `HTTP ${res.status}` };
    }

    const body = await res.json();
    if (body?.result?.protocolVersion || body?.result?.serverInfo) {
      return { healthy: true, latencyMs };
    }
    if (body?.error) {
      return { healthy: false, latencyMs, error: `MCP error: ${body.error.message ?? JSON.stringify(body.error)}` };
    }
    return { healthy: true, latencyMs };
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

async function checkStdio(command: string, args?: string[], env?: Record<string, string>): Promise<HealthCheckResult> {
  if (isServerless()) {
    return { healthy: false, latencyMs: 0, error: "stdio transport not supported on serverless runtime" };
  }

  const start = Date.now();
  try {
    const { spawn } = await import("child_process");
    return new Promise<HealthCheckResult>((resolve) => {
      const proc = spawn(command, args ?? [], {
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        proc.kill();
        resolve({ healthy: false, latencyMs: Date.now() - start, error: "Timeout" });
      }, STDIO_TIMEOUT_MS);

      let stdout = "";
      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        // Check if we got a JSON-RPC response
        try {
          const lines = stdout.split("\n").filter(Boolean);
          for (const line of lines) {
            const parsed = JSON.parse(line);
            if (parsed?.result?.protocolVersion || parsed?.result?.serverInfo) {
              clearTimeout(timeout);
              proc.kill();
              resolve({ healthy: true, latencyMs: Date.now() - start });
              return;
            }
          }
        } catch {
          // Not complete JSON yet — keep reading
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({ healthy: false, latencyMs: Date.now() - start, error: err.message });
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 && code !== null) {
          resolve({ healthy: false, latencyMs: Date.now() - start, error: `Process exited with code ${code}` });
        }
      });

      // Send initialize request
      proc.stdin.write(JSON.stringify(MCP_INITIALIZE_REQUEST) + "\n");
    });
  } catch (err) {
    return { healthy: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "Unknown error" };
  }
}

export async function checkMcpServerHealth(config: McpConnectionConfig): Promise<HealthCheckResult> {
  switch (config.transport) {
    case "http":
      return checkHttp(config.url, config.headers);
    case "sse":
      // SSE uses the same HTTP POST for initialize — the SSE stream is for ongoing communication
      return checkHttp(config.url, config.headers);
    case "stdio":
      return checkStdio(config.command, config.args, config.env);
    default:
      return { healthy: false, latencyMs: 0, error: `Unknown transport: ${(config as { transport: string }).transport}` };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/mcp-server-health.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-server-health.ts apps/web/lib/mcp-server-health.test.ts
git commit -m "feat(mcp): MCP initialize handshake health check

EP-MCP-ACT-001 Task 3: checkMcpServerHealth() sends MCP initialize
request for http/sse/stdio transports. Serverless runtime detection
blocks stdio. 4 tests."
```

---

### Task 4: Tool Discovery & Namespaced Resolution

**Files:**
- Create: `apps/web/lib/mcp-server-tools.ts`
- Test: `apps/web/lib/mcp-server-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/mcp-server-tools.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpServerTool: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
    mcpServer: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  discoverMcpServerTools,
  namespaceTool,
  parseNamespacedTool,
  getMcpServerTools,
} from "./mcp-server-tools";

describe("namespaceTool", () => {
  it("prefixes tool name with server slug", () => {
    expect(namespaceTool("stripe", "create_payment")).toBe("stripe__create_payment");
  });
});

describe("parseNamespacedTool", () => {
  it("splits namespaced tool into slug and name", () => {
    expect(parseNamespacedTool("stripe__create_payment")).toEqual({
      serverSlug: "stripe",
      toolName: "create_payment",
    });
  });

  it("returns null for non-namespaced tool", () => {
    expect(parseNamespacedTool("create_backlog_item")).toBeNull();
  });

  it("handles tool names with underscores after slug", () => {
    expect(parseNamespacedTool("my_server__my_tool_name")).toEqual({
      serverSlug: "my_server",
      toolName: "my_tool_name",
    });
  });
});

describe("getMcpServerTools", () => {
  it("returns namespaced tool definitions from active healthy servers", async () => {
    vi.mocked(prisma.mcpServerTool.findMany).mockResolvedValue([
      {
        id: "t1", serverId: "s1", toolName: "create_payment",
        description: "Create a payment", inputSchema: { type: "object", properties: {} },
        isEnabled: true, discoveredAt: new Date(), updatedAt: new Date(),
        server: { serverId: "stripe", status: "active", healthStatus: "healthy" },
      },
    ] as never);

    const tools = await getMcpServerTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("stripe__create_payment");
    expect(tools[0].requiresExternalAccess).toBe(true);
    expect(tools[0].sideEffect).toBe(true);
  });
});

describe("discoverMcpServerTools", () => {
  it("upserts discovered tools from MCP tools/list response", async () => {
    const mcpToolsList = [
      { name: "create_payment", description: "Create payment", inputSchema: { type: "object" } },
      { name: "get_balance", description: "Get balance", inputSchema: { type: "object" } },
    ];

    vi.mocked(prisma.mcpServer.findUnique).mockResolvedValue({
      id: "s1", serverId: "stripe", config: { transport: "http", url: "https://mcp.stripe.com" },
    } as never);
    vi.mocked(prisma.mcpServerTool.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.mcpServerTool.deleteMany).mockResolvedValue({ count: 0 });

    // Mock fetch for tools/list
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: { tools: mcpToolsList } }),
    } as Response));

    const result = await discoverMcpServerTools("s1");
    expect(result).toHaveLength(2);
    expect(prisma.mcpServerTool.upsert).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/mcp-server-tools.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement tool discovery and namespacing**

Create `apps/web/lib/mcp-server-tools.ts`:

```typescript
// apps/web/lib/mcp-server-tools.ts
// MCP tool discovery, namespacing, and execution bridge.

import { prisma } from "@dpf/db";
import type { ToolDefinition } from "./mcp-tools";
import type { McpConnectionConfig } from "./mcp-server-types";

// ─── Namespacing ────────────────────────────────────────────────────────────

const NAMESPACE_SEP = "__";

export function namespaceTool(serverSlug: string, toolName: string): string {
  return `${serverSlug}${NAMESPACE_SEP}${toolName}`;
}

export function parseNamespacedTool(name: string): { serverSlug: string; toolName: string } | null {
  const idx = name.indexOf(NAMESPACE_SEP);
  if (idx === -1) return null;
  return { serverSlug: name.slice(0, idx), toolName: name.slice(idx + NAMESPACE_SEP.length) };
}

// ─── Tool Discovery ─────────────────────────────────────────────────────────

type McpToolEntry = { name: string; description?: string; inputSchema?: Record<string, unknown> };

const MCP_TOOLS_LIST_REQUEST = {
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: {},
};

async function fetchToolsList(config: McpConnectionConfig): Promise<McpToolEntry[]> {
  if (config.transport === "stdio") {
    // For stdio, we'd need to spawn + communicate — reuse health check pattern
    // For v1, tool discovery only supports http/sse (stdio tools discovered at activation via spawn)
    throw new Error("Tool discovery for stdio requires process spawn — use activation flow");
  }

  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(config.headers ?? {}) },
    body: JSON.stringify(MCP_TOOLS_LIST_REQUEST),
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) throw new Error(`tools/list failed: HTTP ${res.status}`);
  const body = await res.json();
  return body?.result?.tools ?? [];
}

export async function discoverMcpServerTools(serverId: string): Promise<McpToolEntry[]> {
  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) throw new Error(`McpServer ${serverId} not found`);

  const config = server.config as McpConnectionConfig;
  const tools = await fetchToolsList(config);

  // Upsert each discovered tool
  for (const tool of tools) {
    await prisma.mcpServerTool.upsert({
      where: { serverId_toolName: { serverId, toolName: tool.name } },
      create: {
        serverId,
        toolName: tool.name,
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? {}) as object,
      },
      update: {
        description: tool.description ?? null,
        inputSchema: (tool.inputSchema ?? {}) as object,
      },
    });
  }

  // Remove tools no longer reported by the server (including when server reports zero tools)
  const discoveredNames = tools.map((t) => t.name);
  await prisma.mcpServerTool.deleteMany({
    where: {
      serverId,
      ...(discoveredNames.length > 0 ? { toolName: { notIn: discoveredNames } } : {}),
    },
  });

  return tools;
}

// ─── Get tools for agentic loop ─────────────────────────────────────────────

export async function getMcpServerTools(): Promise<ToolDefinition[]> {
  const tools = await prisma.mcpServerTool.findMany({
    where: {
      isEnabled: true,
      server: { status: "active", healthStatus: "healthy" },
    },
    include: { server: { select: { serverId: true, status: true, healthStatus: true } } },
  });

  return tools.map((t) => ({
    name: namespaceTool(t.server.serverId, t.toolName),
    description: t.description ?? `Tool from ${t.server.serverId}`,
    inputSchema: t.inputSchema as Record<string, unknown>,
    requiredCapability: null,
    requiresExternalAccess: true,
    sideEffect: true,
  }));
}

// ─── Execute a namespaced tool call ─────────────────────────────────────────

export async function executeMcpServerTool(
  serverSlug: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<{ success: boolean; message: string; data?: Record<string, unknown>; error?: string }> {
  const server = await prisma.mcpServer.findUnique({ where: { serverId: serverSlug } });
  if (!server || server.status !== "active") {
    return { success: false, error: "Server not found or inactive", message: `MCP server ${serverSlug} is not available` };
  }

  const tool = await prisma.mcpServerTool.findFirst({
    where: { serverId: server.id, toolName, isEnabled: true },
  });
  if (!tool) {
    return { success: false, error: "Tool not found or disabled", message: `Tool ${toolName} not available on ${serverSlug}` };
  }

  const config = server.config as McpConnectionConfig;

  // Lazy health check: if last check is stale (> 5 min), re-check
  const STALE_MS = 5 * 60 * 1000;
  if (!server.lastHealthCheck || Date.now() - server.lastHealthCheck.getTime() > STALE_MS) {
    const { checkMcpServerHealth } = await import("./mcp-server-health");
    const health = await checkMcpServerHealth(config);
    await prisma.mcpServer.update({
      where: { id: server.id },
      data: {
        healthStatus: health.healthy ? "healthy" : "unreachable",
        lastHealthCheck: new Date(),
        lastHealthError: health.error ?? null,
      },
    });
    if (!health.healthy) {
      return { success: false, error: health.error ?? "Server unreachable", message: `Health check failed for ${serverSlug}` };
    }
  }

  // Send tools/call to the MCP server
  try {
    if (config.transport === "stdio") {
      return { success: false, error: "stdio tool execution not yet supported", message: "stdio transport requires persistent process — follow-on" };
    }

    const res = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(config.headers ?? {}) },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: params },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}`, message: `MCP server returned ${res.status}` };
    }

    const body = await res.json();
    if (body?.error) {
      return { success: false, error: body.error.message ?? "MCP error", message: body.error.message ?? "Tool call failed" };
    }

    return { success: true, message: "Tool call succeeded", data: body?.result ?? {} };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Unknown error", message: "Tool call failed" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/mcp-server-tools.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/mcp-server-tools.ts apps/web/lib/mcp-server-tools.test.ts
git commit -m "feat(mcp): tool discovery, namespacing, and execution bridge

EP-MCP-ACT-001 Task 4: discoverMcpServerTools() calls MCP tools/list
and upserts McpServerTool rows. Namespace format: serverSlug__toolName.
executeMcpServerTool() with lazy health check. 6 tests."
```

---

### Task 5: Extend Tool Registry — getAvailableTools() & executeTool()

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (getAvailableTools at ~line 784, executeTool default case at ~line 1982)
- Test: `apps/web/lib/mcp-tools-mcp-server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/mcp-tools-mcp-server.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: { findMany: vi.fn() },
    mcpServerTool: { findMany: vi.fn() },
    mcpServer: { findUnique: vi.fn(), update: vi.fn() },
    backlogItem: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true), requireCap: vi.fn() }));
vi.mock("@/lib/semantic-memory", () => ({ storePlatformKnowledge: vi.fn() }));
vi.mock("./mcp-server-tools", () => ({
  getMcpServerTools: vi.fn(),
  parseNamespacedTool: vi.fn((name: string) => {
    const idx = name.indexOf("__");
    if (idx === -1) return null;
    return { serverSlug: name.slice(0, idx), toolName: name.slice(idx + 2) };
  }),
  executeMcpServerTool: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { getAvailableTools, executeTool } from "./mcp-tools";
import { getMcpServerTools, executeMcpServerTool } from "./mcp-server-tools";

describe("getAvailableTools with MCP server tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes MCP server tools alongside platform tools", async () => {
    vi.mocked(getMcpServerTools).mockResolvedValue([
      {
        name: "stripe__create_payment",
        description: "Create a payment",
        inputSchema: { type: "object" },
        requiredCapability: null,
        requiresExternalAccess: true,
        sideEffect: true,
      },
    ]);

    const tools = await getAvailableTools(
      { platformRole: "admin", isSuperuser: true },
      { externalAccessEnabled: true },
    );

    const mcpTool = tools.find((t) => t.name === "stripe__create_payment");
    expect(mcpTool).toBeDefined();
    expect(mcpTool?.requiresExternalAccess).toBe(true);
  });
});

describe("executeTool with namespaced MCP server tools", () => {
  it("routes namespaced tools to executeMcpServerTool", async () => {
    vi.mocked(executeMcpServerTool).mockResolvedValue({
      success: true,
      message: "Payment created",
      data: { id: "pay_123" },
    });

    const result = await executeTool("stripe__create_payment", { amount: 1000 }, "user-1");
    expect(executeMcpServerTool).toHaveBeenCalledWith("stripe", "create_payment", { amount: 1000 });
    expect(result.success).toBe(true);
  });

  it("falls through to unknown-tool error for non-namespaced unknown tools", async () => {
    const result = await executeTool("nonexistent_tool", {}, "user-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/mcp-tools-mcp-server.test.ts
```

Expected: FAIL — getAvailableTools doesn't return MCP server tools yet.

- [ ] **Step 3: Modify getAvailableTools() in mcp-tools.ts**

Change `getAvailableTools()` (around line 784) to be async and include MCP server tools:

```typescript
export async function getAvailableTools(
  userContext: UserContext,
  options?: { externalAccessEnabled?: boolean; mode?: "advise" | "act"; unifiedMode?: boolean },
): Promise<ToolDefinition[]> {
  const platformTools = PLATFORM_TOOLS.filter(
    (tool) =>
      (options?.unifiedMode || !tool.requiresExternalAccess || options?.externalAccessEnabled === true)
      && (tool.requiredCapability === null || can(userContext, tool.requiredCapability))
      && (options?.mode !== "advise" || !tool.sideEffect),
  );

  // Include MCP server tools if external access is enabled
  if (options?.externalAccessEnabled) {
    try {
      const { getMcpServerTools } = await import("./mcp-server-tools");
      const mcpTools = await getMcpServerTools();
      const filtered = options?.mode === "advise" ? [] : mcpTools; // MCP tools have side effects
      return [...platformTools, ...filtered];
    } catch {
      // MCP server tools unavailable — return platform tools only
    }
  }

  return platformTools;
}
```

**Important:** This changes the function from sync to async. Check all callers and update them. The main callers are:
- `apps/web/app/api/mcp/tools/route.ts` — already async context
- `apps/web/lib/agentic-loop.ts` — already async context

- [ ] **Step 4: Modify executeTool() default case in mcp-tools.ts**

Replace the default case (around line 1982) with:

```typescript
    default: {
      // Check if this is a namespaced MCP server tool (contains __)
      const { parseNamespacedTool, executeMcpServerTool } = await import("./mcp-server-tools");
      const parsed = parseNamespacedTool(toolName);
      if (parsed) {
        return executeMcpServerTool(parsed.serverSlug, parsed.toolName, params);
      }
      return { success: false, error: "Unknown tool", message: `Tool ${toolName} not found` };
    }
```

- [ ] **Step 5: Update all callers of getAvailableTools() to use await**

The function changed from sync to async. Every caller must be updated. Known callers:

1. **`apps/web/app/api/mcp/tools/route.ts`** (~line 10): Change `const tools = getAvailableTools(...)` to `const tools = await getAvailableTools(...)`
2. **`apps/web/lib/actions/agent-coworker.ts`** (~line 371): Change `const tools = getAvailableTools(...)` to `const tools = await getAvailableTools(...)`
3. **`apps/web/lib/mcp-tools.test.ts`**: Update all test cases — change `const tools = getAvailableTools(...)` to `const tools = await getAvailableTools(...)`. Also update the mock setup if `getAvailableTools` is being mocked in other test files.
4. **`apps/web/lib/actions/agent-coworker-external.test.ts`**: If this mocks `getAvailableTools`, update the mock to return a Promise.

**Verify completeness:** Run `grep -r "getAvailableTools" apps/web/ --include="*.ts" --include="*.tsx"` and update any callers not listed above.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/mcp-tools-mcp-server.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 7: Run existing tool tests to check for regressions**

```bash
cd apps/web && npx vitest run lib/mcp-tools.test.ts lib/mcp-tools-integrations.test.ts
```

Expected: All existing tests still PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-mcp-server.test.ts
git commit -m "feat(mcp): extend tool registry with namespaced MCP server tools

EP-MCP-ACT-001 Task 5: getAvailableTools() now async, includes
McpServerTool entries from active servers. executeTool() routes
serverSlug__toolName to executeMcpServerTool(). 3 new tests,
existing tests passing."
```

---

### Task 6: Server Actions — Activate, Deactivate, Query, CheckHealth

**Files:**
- Create: `apps/web/lib/actions/mcp-services.ts`
- Test: `apps/web/lib/actions/mcp-services.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/actions/mcp-services.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    mcpIntegration: { findUnique: vi.fn() },
    mcpServer: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    mcpServerTool: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(() => Promise.resolve({
    user: { id: "user-1", platformRole: "admin", isSuperuser: true },
  })),
}));
vi.mock("@/lib/permissions", () => ({ can: vi.fn(() => true) }));
vi.mock("@/lib/mcp-server-health", () => ({
  checkMcpServerHealth: vi.fn(),
}));
vi.mock("@/lib/mcp-server-tools", () => ({
  discoverMcpServerTools: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { checkMcpServerHealth } from "@/lib/mcp-server-health";
import { discoverMcpServerTools } from "@/lib/mcp-server-tools";
import {
  activateMcpIntegration,
  deactivateMcpServer,
  queryMcpServers,
} from "./mcp-services";

describe("activateMcpIntegration", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates McpServer when health check passes", async () => {
    vi.mocked(prisma.mcpIntegration.findUnique).mockResolvedValue({
      id: "int-1", slug: "stripe", name: "Stripe", status: "active",
      category: "finance", tags: ["payments"],
    } as never);
    vi.mocked(checkMcpServerHealth).mockResolvedValue({ healthy: true, latencyMs: 42 });
    vi.mocked(prisma.mcpServer.create).mockResolvedValue({ id: "srv-1" } as never);
    vi.mocked(discoverMcpServerTools).mockResolvedValue([]);

    const result = await activateMcpIntegration("int-1", { transport: "http", url: "https://mcp.stripe.com" });
    expect(result.ok).toBe(true);
    expect(prisma.mcpServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          serverId: "stripe",
          status: "active",
          healthStatus: "healthy",
        }),
      }),
    );
  });

  it("rejects when health check fails", async () => {
    vi.mocked(prisma.mcpIntegration.findUnique).mockResolvedValue({
      id: "int-1", slug: "stripe", name: "Stripe", status: "active",
      category: "finance", tags: ["payments"],
    } as never);
    vi.mocked(checkMcpServerHealth).mockResolvedValue({ healthy: false, latencyMs: 0, error: "Connection refused" });

    const result = await activateMcpIntegration("int-1", { transport: "http", url: "https://mcp.stripe.com" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Connection refused");
    expect(prisma.mcpServer.create).not.toHaveBeenCalled();
  });

  it("rejects when integration not found", async () => {
    vi.mocked(prisma.mcpIntegration.findUnique).mockResolvedValue(null);

    const result = await activateMcpIntegration("nonexistent", { transport: "http", url: "https://example.com" });
    expect(result.ok).toBe(false);
  });
});

describe("deactivateMcpServer", () => {
  it("sets status to deactivated", async () => {
    vi.mocked(prisma.mcpServer.findUnique).mockResolvedValue({ id: "srv-1", status: "active" } as never);
    vi.mocked(prisma.mcpServer.update).mockResolvedValue({} as never);

    const result = await deactivateMcpServer("srv-1");
    expect(result.ok).toBe(true);
    expect(prisma.mcpServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "deactivated" }),
      }),
    );
  });
});

describe("queryMcpServers", () => {
  it("returns active servers with tool counts", async () => {
    vi.mocked(prisma.mcpServer.findMany).mockResolvedValue([
      { id: "srv-1", serverId: "stripe", name: "Stripe", status: "active", healthStatus: "healthy", category: "finance", transport: "http" },
    ] as never);

    const servers = await queryMcpServers();
    expect(servers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/actions/mcp-services.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement server actions**

Create `apps/web/lib/actions/mcp-services.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { checkMcpServerHealth } from "@/lib/mcp-server-health";
import { discoverMcpServerTools } from "@/lib/mcp-server-tools";
import { validateConnectionConfig, redactConfig, type McpConnectionConfig } from "@/lib/mcp-server-types";

// ─── Auth ───────────────────────────────────────────────────────────────────

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

// ─── Activate ───────────────────────────────────────────────────────────────

export async function activateMcpIntegration(
  integrationId: string,
  connectionConfig: McpConnectionConfig,
): Promise<{ ok: boolean; message: string; serverId?: string }> {
  const userId = await requireManageProviders();

  const integration = await prisma.mcpIntegration.findUnique({ where: { id: integrationId } });
  if (!integration || integration.status !== "active") {
    return { ok: false, message: "Integration not found or not active" };
  }

  const validation = validateConnectionConfig(connectionConfig);
  if (!validation.valid) {
    return { ok: false, message: validation.error };
  }

  const health = await checkMcpServerHealth(connectionConfig);
  if (!health.healthy) {
    return { ok: false, message: `Health check failed: ${health.error ?? "unknown error"}` };
  }

  const server = await prisma.mcpServer.create({
    data: {
      serverId: integration.slug,
      name: integration.name,
      config: connectionConfig as object,
      status: "active",
      transport: connectionConfig.transport,
      category: integration.category,
      tags: integration.tags,
      healthStatus: "healthy",
      lastHealthCheck: new Date(),
      integrationId: integration.id,
      activatedBy: userId,
      activatedAt: new Date(),
    },
  });

  // Fire-and-forget: discover tools
  void discoverMcpServerTools(server.id).catch(() => {});

  return { ok: true, message: "Service activated", serverId: server.id };
}

// ─── Manual registration (no catalog link) ──────────────────────────────────

export async function registerMcpServer(
  name: string,
  serverId: string,
  connectionConfig: McpConnectionConfig,
  category?: string,
): Promise<{ ok: boolean; message: string; id?: string }> {
  const userId = await requireManageProviders();

  const validation = validateConnectionConfig(connectionConfig);
  if (!validation.valid) {
    return { ok: false, message: validation.error };
  }

  const health = await checkMcpServerHealth(connectionConfig);
  if (!health.healthy) {
    return { ok: false, message: `Health check failed: ${health.error ?? "unknown error"}` };
  }

  const server = await prisma.mcpServer.create({
    data: {
      serverId,
      name,
      config: connectionConfig as object,
      status: "active",
      transport: connectionConfig.transport,
      category: category ?? null,
      healthStatus: "healthy",
      lastHealthCheck: new Date(),
      activatedBy: userId,
      activatedAt: new Date(),
    },
  });

  void discoverMcpServerTools(server.id).catch(() => {});

  return { ok: true, message: "Service registered", id: server.id };
}

// ─── Deactivate ─────────────────────────────────────────────────────────────

export async function deactivateMcpServer(
  serverId: string,
): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();

  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) return { ok: false, message: "Server not found" };

  await prisma.mcpServer.update({
    where: { id: serverId },
    data: { status: "deactivated", deactivatedAt: new Date() },
  });

  return { ok: true, message: "Service deactivated" };
}

// ─── Check Health ───────────────────────────────────────────────────────────

export async function checkMcpServerHealthAction(
  serverId: string,
): Promise<{ ok: boolean; message: string; healthy?: boolean; latencyMs?: number }> {
  await requireManageProviders();

  const server = await prisma.mcpServer.findUnique({ where: { id: serverId } });
  if (!server) return { ok: false, message: "Server not found" };

  const config = server.config as McpConnectionConfig;
  const result = await checkMcpServerHealth(config);

  await prisma.mcpServer.update({
    where: { id: serverId },
    data: {
      healthStatus: result.healthy ? "healthy" : "unreachable",
      lastHealthCheck: new Date(),
      lastHealthError: result.error ?? null,
    },
  });

  // Re-discover tools on successful health check
  if (result.healthy) {
    void discoverMcpServerTools(serverId).catch(() => {});
  }

  return { ok: true, message: result.healthy ? "Healthy" : `Unhealthy: ${result.error}`, healthy: result.healthy, latencyMs: result.latencyMs };
}

// ─── Test Connection (no DB row) ────────────────────────────────────────────

export async function testMcpConnection(
  config: McpConnectionConfig,
): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
  await requireManageProviders();
  const validation = validateConnectionConfig(config);
  if (!validation.valid) return { healthy: false, latencyMs: 0, error: validation.error };
  return checkMcpServerHealth(config);
}

// ─── Toggle Tool ────────────────────────────────────────────────────────────

export async function toggleMcpServerTool(
  toolId: string,
  isEnabled: boolean,
): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();
  await prisma.mcpServerTool.update({ where: { id: toolId }, data: { isEnabled } });
  return { ok: true, message: isEnabled ? "Tool enabled" : "Tool disabled" };
}

// ─── Query ──────────────────────────────────────────────────────────────────

export async function queryMcpServers(options?: {
  status?: string;
  category?: string;
}) {
  return prisma.mcpServer.findMany({
    where: {
      ...(options?.status ? { status: options.status } : { status: { not: "deactivated" } }),
      ...(options?.category ? { category: options.category } : {}),
    },
    include: {
      _count: { select: { tools: true } },
      integration: { select: { id: true, name: true, logoUrl: true } },
    },
    orderBy: { name: "asc" },
  });
}

export async function getMcpServerDetail(serverId: string) {
  const server = await prisma.mcpServer.findUnique({
    where: { id: serverId },
    include: {
      tools: { orderBy: { toolName: "asc" } },
      integration: { select: { id: true, name: true, logoUrl: true, documentationUrl: true } },
    },
  });
  if (!server) return null;

  // Redact config before returning
  const config = server.config as McpConnectionConfig;
  return { ...server, config: redactConfig(config) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/actions/mcp-services.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/mcp-services.ts apps/web/lib/actions/mcp-services.test.ts
git commit -m "feat(mcp): server actions for MCP service lifecycle

EP-MCP-ACT-001 Task 6: activateMcpIntegration, registerMcpServer,
deactivateMcpServer, checkMcpServerHealthAction, toggleMcpServerTool,
queryMcpServers, getMcpServerDetail. All with auth checks. 5 tests."
```

---

## Track 2: External Services Admin Surface

### Task 7: ServiceCard Component

**Files:**
- Create: `apps/web/components/platform/ServiceCard.tsx`

- [ ] **Step 1: Create ServiceCard component**

Create `apps/web/components/platform/ServiceCard.tsx`:

```typescript
import Link from "next/link";

type McpServerSummary = {
  id: string;
  serverId: string;
  name: string;
  status: string;
  transport: string | null;
  healthStatus: string;
  category: string | null;
  lastHealthCheck: Date | null;
  _count: { tools: number };
  integration: { logoUrl: string | null } | null;
};

const HEALTH_COLORS: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  unreachable: "bg-red-500",
  unknown: "bg-gray-400",
};

const TRANSPORT_LABELS: Record<string, string> = {
  stdio: "STDIO",
  sse: "SSE",
  http: "HTTP",
};

export function ServiceCard({ server }: { server: McpServerSummary }) {
  const healthColor = HEALTH_COLORS[server.healthStatus] ?? HEALTH_COLORS.unknown;

  return (
    <Link
      href={`/platform/services/${server.id}`}
      className="border rounded-lg p-4 flex flex-col gap-2 hover:shadow-md transition-shadow bg-card"
    >
      <div className="flex items-start gap-3">
        {server.integration?.logoUrl ? (
          <img src={server.integration.logoUrl} alt="" className="w-10 h-10 rounded object-contain" />
        ) : (
          <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
            {server.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{server.name}</span>
            <span className={`w-2 h-2 rounded-full ${healthColor}`} title={server.healthStatus} />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {server.transport && (
              <span className="bg-muted px-1.5 py-0.5 rounded font-mono">
                {TRANSPORT_LABELS[server.transport] ?? server.transport}
              </span>
            )}
            {server.category && <span>{server.category}</span>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-auto pt-1 text-xs text-muted-foreground">
        <span>{server._count.tools} tool{server._count.tools !== 1 ? "s" : ""}</span>
        {server.lastHealthCheck && (
          <span>Checked {new Date(server.lastHealthCheck).toLocaleDateString()}</span>
        )}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/platform/ServiceCard.tsx
git commit -m "feat(mcp): ServiceCard component for admin services grid

EP-MCP-ACT-001 Task 7: Health indicator, transport badge, tool count,
logo from linked integration."
```

---

### Task 8: Services List Page

**Files:**
- Create: `apps/web/app/(shell)/platform/services/page.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx` (add nav card)

- [ ] **Step 1: Create services page**

Create `apps/web/app/(shell)/platform/services/page.tsx`:

```typescript
import { queryMcpServers } from "@/lib/actions/mcp-services";
import { ServiceCard } from "@/components/platform/ServiceCard";
import Link from "next/link";

export default async function ServicesPage() {
  const [activeServers, unconfigured] = await Promise.all([
    queryMcpServers({ status: undefined }),
    queryMcpServers({ status: "unconfigured" }),
  ]);

  const registered = activeServers.filter((s) => s.status !== "unconfigured");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">External Services</h1>
          <p className="text-muted-foreground text-sm">
            {registered.length} registered MCP service{registered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Link
          href="/platform/services/activate"
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm"
        >
          Register New
        </Link>
      </div>

      {unconfigured.length > 0 && (
        <div className="border border-dashed rounded-lg p-4 bg-muted/50">
          <h2 className="text-sm font-semibold mb-2">
            Detected ({unconfigured.length})
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            These MCP servers were detected but not yet configured.
          </p>
          <div className="flex flex-wrap gap-2">
            {unconfigured.map((s) => (
              <Link
                key={s.id}
                href={`/platform/services/activate?serverId=${s.id}`}
                className="px-3 py-1.5 rounded border text-sm hover:bg-muted"
              >
                {s.name} — Configure
              </Link>
            ))}
          </div>
        </div>
      )}

      {registered.length === 0 ? (
        <p className="text-muted-foreground text-sm py-12 text-center">
          No registered services yet. Browse the{" "}
          <Link href="/platform/integrations" className="text-primary hover:underline">
            Integrations Catalog
          </Link>{" "}
          to find services to activate.
        </p>
      ) : (
        <>
          {Object.entries(
            registered.reduce<Record<string, typeof registered>>((groups, server) => {
              const cat = server.category ?? "uncategorized";
              (groups[cat] ??= []).push(server);
              return groups;
            }, {})
          ).sort(([a], [b]) => a.localeCompare(b)).map(([category, servers]) => (
            <div key={category} className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground capitalize">{category}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {servers.map((server) => (
                  <ServiceCard key={server.id} server={server as never} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add Services nav card to platform page**

In `apps/web/app/(shell)/platform/page.tsx`, find the "Platform Services" grid section (around line 130, after the "Integrations" card) and add a new card:

```typescript
    <Link href="/platform/services" style={{ /* same card styles as neighbors */ }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: "#e0e0ff", margin: "0 0 4px" }}>
        Services
      </p>
      <p style={{ fontSize: 10, color: "#8888a0", margin: 0 }}>
        Registered MCP services, health, tools
      </p>
    </Link>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/platform/services/page.tsx apps/web/app/(shell)/platform/page.tsx
git commit -m "feat(mcp): services list page and platform nav card

EP-MCP-ACT-001 Task 8: /platform/services shows registered services
grid, detected (unconfigured) banner, Register New button.
Services card added to /platform overview."
```

---

### Task 9: Service Detail Page

**Files:**
- Create: `apps/web/app/(shell)/platform/services/[serverId]/page.tsx`
- Create: `apps/web/components/platform/HealthCheckButton.tsx`

- [ ] **Step 1: Create HealthCheckButton client component**

Create `apps/web/components/platform/HealthCheckButton.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkMcpServerHealthAction } from "@/lib/actions/mcp-services";

export function HealthCheckButton({ serverId }: { serverId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ healthy?: boolean; latencyMs?: number; message?: string } | null>(null);

  function handleCheck() {
    setResult(null);
    startTransition(async () => {
      const res = await checkMcpServerHealthAction(serverId);
      setResult({ healthy: res.healthy, latencyMs: res.latencyMs, message: res.message });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleCheck}
        disabled={isPending}
        className="px-3 py-1.5 rounded border text-sm hover:bg-muted disabled:opacity-50"
      >
        {isPending ? "Checking…" : "Check Now"}
      </button>
      {result && (
        <span className={`text-xs ${result.healthy ? "text-green-600" : "text-red-600"}`}>
          {result.message}{result.latencyMs != null ? ` (${result.latencyMs}ms)` : ""}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create service detail page**

Create `apps/web/app/(shell)/platform/services/[serverId]/page.tsx`:

```typescript
import { notFound } from "next/navigation";
import Link from "next/link";
import { getMcpServerDetail, deactivateMcpServer, toggleMcpServerTool } from "@/lib/actions/mcp-services";
import { HealthCheckButton } from "@/components/platform/HealthCheckButton";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const HEALTH_LABELS: Record<string, { text: string; className: string }> = {
  healthy: { text: "Healthy", className: "text-green-600" },
  degraded: { text: "Degraded", className: "text-yellow-600" },
  unreachable: { text: "Unreachable", className: "text-red-600" },
  unknown: { text: "Unknown", className: "text-gray-500" },
};

export default async function ServiceDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;
  const server = await getMcpServerDetail(serverId);
  if (!server) notFound();

  const session = await auth();
  const canWrite = !!session?.user && can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_provider_connections",
  );

  const health = HEALTH_LABELS[server.healthStatus] ?? HEALTH_LABELS.unknown;

  return (
    <div className="p-6 space-y-8 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/platform/services" className="text-xs text-muted-foreground hover:underline">
            ← Services
          </Link>
          <h1 className="text-2xl font-bold mt-1">{server.name}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
            <span className={`font-medium ${health.className}`}>{health.text}</span>
            {server.transport && <span className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{server.transport.toUpperCase()}</span>}
            {server.category && <span>{server.category}</span>}
          </div>
        </div>
      </div>

      {/* Health */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Health</h2>
        <div className="border rounded-lg p-4 space-y-2 text-sm">
          <p>
            Status: <span className={`font-medium ${health.className}`}>{health.text}</span>
          </p>
          {server.lastHealthCheck && (
            <p>Last checked: {new Date(server.lastHealthCheck).toLocaleString()}</p>
          )}
          {server.lastHealthError && (
            <p className="text-destructive text-xs">{server.lastHealthError}</p>
          )}
          {canWrite && <HealthCheckButton serverId={server.id} />}
        </div>
      </section>

      {/* Connection Config (redacted) */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Connection</h2>
        <pre className="border rounded-lg p-4 text-xs bg-muted overflow-auto">
          {JSON.stringify(server.config, null, 2)}
        </pre>
      </section>

      {/* Tools */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Tools ({server.tools.length})
        </h2>
        {server.tools.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tools discovered yet.</p>
        ) : (
          <table className="w-full text-sm border rounded-lg overflow-hidden">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Description</th>
                <th className="text-left p-2 w-20">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {server.tools.map((tool) => (
                <tr key={tool.id} className="border-t">
                  <td className="p-2 font-mono text-xs">{tool.toolName}</td>
                  <td className="p-2 text-muted-foreground">{tool.description ?? "—"}</td>
                  <td className="p-2">
                    <span className={tool.isEnabled ? "text-green-600" : "text-gray-400"}>
                      {tool.isEnabled ? "Yes" : "No"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Activation Metadata */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Metadata</h2>
        <div className="border rounded-lg p-4 text-sm space-y-1">
          {server.activatedBy && <p>Activated by: {server.activatedBy}</p>}
          {server.activatedAt && <p>Activated: {new Date(server.activatedAt).toLocaleString()}</p>}
          {server.integration && (
            <p>
              Catalog entry:{" "}
              <Link href="/platform/integrations" className="text-primary hover:underline">
                {server.integration.name}
              </Link>
            </p>
          )}
          {server.deactivatedAt && <p className="text-destructive">Deactivated: {new Date(server.deactivatedAt).toLocaleString()}</p>}
        </div>
      </section>

      {/* Deactivate */}
      {canWrite && server.status !== "deactivated" && (
        <section>
          <form action={async () => { "use server"; await deactivateMcpServer(server.id); }}>
            <button type="submit" className="px-4 py-2 rounded border border-destructive text-destructive text-sm hover:bg-destructive/10">
              Deactivate Service
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/platform/services/[serverId]/page.tsx apps/web/components/platform/HealthCheckButton.tsx
git commit -m "feat(mcp): service detail page with health check and tools list

EP-MCP-ACT-001 Task 9: /platform/services/[serverId] shows redacted
config, health status + Check Now button, discovered tools table,
activation metadata."
```

---

### Task 10: Activation Form

**Files:**
- Create: `apps/web/components/platform/ServiceActivationForm.tsx`
- Create: `apps/web/app/(shell)/platform/services/activate/page.tsx`

- [ ] **Step 1: Create ServiceActivationForm client component**

Create `apps/web/components/platform/ServiceActivationForm.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateMcpIntegration, registerMcpServer, testMcpConnection } from "@/lib/actions/mcp-services";
import type { McpConnectionConfig, McpTransport } from "@/lib/mcp-server-types";

type Props = {
  integrationId?: string;
  prefillName?: string;
  prefillCategory?: string;
  prefillServerId?: string;
};

export function ServiceActivationForm({ integrationId, prefillName, prefillCategory, prefillServerId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [transport, setTransport] = useState<McpTransport>("http");
  const [name, setName] = useState(prefillName ?? "");
  const [serverId, setServerId] = useState(prefillServerId ?? "");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [headers, setHeaders] = useState("");
  const [envVars, setEnvVars] = useState("");
  const [healthResult, setHealthResult] = useState<{ healthy?: boolean; error?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildConfig(): McpConnectionConfig {
    if (transport === "stdio") {
      const parsedEnv: Record<string, string> = {};
      envVars.split("\n").filter(Boolean).forEach((line) => {
        const [k, ...v] = line.split("=");
        if (k) parsedEnv[k.trim()] = v.join("=").trim();
      });
      return {
        transport: "stdio",
        command,
        args: args ? args.split(/\s+/) : undefined,
        env: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined,
      };
    }
    const parsedHeaders: Record<string, string> = {};
    headers.split("\n").filter(Boolean).forEach((line) => {
      const [k, ...v] = line.split(":");
      if (k) parsedHeaders[k.trim()] = v.join(":").trim();
    });
    return {
      transport,
      url,
      headers: Object.keys(parsedHeaders).length > 0 ? parsedHeaders : undefined,
    };
  }

  function handleTestConnection() {
    setHealthResult(null);
    setError(null);
    startTransition(async () => {
      const config = buildConfig();
      if (transport !== "stdio" && !url) {
        setHealthResult({ healthy: false, error: "URL is required" });
        return;
      }
      if (transport === "stdio" && !command) {
        setHealthResult({ healthy: false, error: "Command is required" });
        return;
      }
      // Call server action that runs MCP initialize handshake without creating a DB row
      const res = await testMcpConnection(config);
      setHealthResult({ healthy: res.healthy, error: res.error });
    });
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const config = buildConfig();
      let result: { ok: boolean; message: string; serverId?: string; id?: string };

      if (integrationId) {
        result = await activateMcpIntegration(integrationId, config);
      } else {
        result = await registerMcpServer(name, serverId || name.toLowerCase().replace(/\W+/g, "-"), config, prefillCategory);
      }

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/platform/services/${result.serverId ?? result.id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6 max-w-lg">
      {!integrationId && (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background"
              placeholder="e.g. Stripe MCP Server"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Server ID</label>
            <input
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono"
              placeholder="e.g. stripe-mcp"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Transport</label>
        <div className="flex gap-4">
          {(["http", "sse", "stdio"] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                name="transport"
                value={t}
                checked={transport === t}
                onChange={() => setTransport(t)}
              />
              {t.toUpperCase()}
            </label>
          ))}
        </div>
      </div>

      {transport === "stdio" ? (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">Command</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono"
              placeholder="npx"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Arguments (space-separated)</label>
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono"
              placeholder="-y stripe-mcp"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Environment Variables (one per line, KEY=VALUE)</label>
            <textarea
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono"
              rows={3}
              placeholder="STRIPE_API_KEY=sk_live_..."
            />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono"
              placeholder="https://mcp.example.com/v1"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Headers (one per line, Key: Value)</label>
            <textarea
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              className="w-full px-3 py-2 border rounded text-sm bg-background font-mono"
              rows={3}
              placeholder="Authorization: Bearer sk_live_..."
            />
          </div>
        </>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleTestConnection}
          disabled={isPending}
          className="px-4 py-2 rounded border text-sm hover:bg-muted disabled:opacity-50"
        >
          Test Connection
        </button>
        <button
          onClick={handleSave}
          disabled={isPending || !healthResult?.healthy}
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save & Activate"}
        </button>
      </div>

      {healthResult && (
        <p className={`text-xs ${healthResult.healthy ? "text-green-600" : "text-red-600"}`}>
          {healthResult.healthy ? "Connection OK" : healthResult.error ?? "Connection failed"}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Create activation page**

Create `apps/web/app/(shell)/platform/services/activate/page.tsx`:

```typescript
import { prisma } from "@dpf/db";
import { ServiceActivationForm } from "@/components/platform/ServiceActivationForm";
import Link from "next/link";

type SearchParams = Promise<{ integrationId?: string; serverId?: string }>;

export default async function ActivateServicePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { integrationId, serverId } = await searchParams;

  let prefillName: string | undefined;
  let prefillCategory: string | undefined;
  let prefillServerId: string | undefined;

  // Pre-fill from catalog integration
  if (integrationId) {
    const integration = await prisma.mcpIntegration.findUnique({
      where: { id: integrationId },
      select: { name: true, slug: true, category: true },
    });
    if (integration) {
      prefillName = integration.name;
      prefillCategory = integration.category;
      prefillServerId = integration.slug;
    }
  }

  // Pre-fill from detected (unconfigured) server
  if (serverId) {
    const server = await prisma.mcpServer.findUnique({
      where: { id: serverId },
      select: { name: true, serverId: true },
    });
    if (server) {
      prefillName = server.name;
      prefillServerId = server.serverId;
    }
  }

  return (
    <div className="p-6 max-w-2xl">
      <Link href="/platform/services" className="text-xs text-muted-foreground hover:underline">
        ← Services
      </Link>
      <h1 className="text-2xl font-bold mt-2">
        {integrationId ? "Activate Integration" : "Register MCP Service"}
      </h1>
      <p className="text-muted-foreground text-sm mt-1 mb-6">
        {integrationId
          ? "Provide connection details for this catalog integration."
          : "Manually register an MCP server with connection details."}
      </p>

      <ServiceActivationForm
        integrationId={integrationId}
        prefillName={prefillName}
        prefillCategory={prefillCategory}
        prefillServerId={prefillServerId}
      />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/ServiceActivationForm.tsx apps/web/app/(shell)/platform/services/activate/page.tsx
git commit -m "feat(mcp): activation form with transport picker and test connection

EP-MCP-ACT-001 Task 10: ServiceActivationForm (client component) with
transport radio, dynamic fields, Test Connection + Save & Activate.
Activation page pre-fills from catalog integration or detected server."
```

---

### Task 11: Catalog Page Enhancement — Active Badge & Activate Button

**Files:**
- Modify: `apps/web/components/platform/IntegrationCard.tsx`
- Modify: `apps/web/app/(shell)/platform/integrations/page.tsx`

- [ ] **Step 1: Update IntegrationCard to accept activation status**

In `apps/web/components/platform/IntegrationCard.tsx`, extend the `Integration` type to include an optional `activeServerId`:

```typescript
type Integration = {
  // ... existing fields ...
  activeServerId?: string | null; // Set when an McpServer is linked
};
```

Add after the verified badge inside the name row:

```typescript
{integration.activeServerId && (
  <a
    href={`/platform/services/${integration.activeServerId}`}
    className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded hover:underline"
  >
    Active
  </a>
)}
```

Add at the bottom of the card (after the docs link):

```typescript
{!integration.activeServerId && (
  <a
    href={`/platform/services/activate?integrationId=${integration.id}`}
    className="text-xs text-primary hover:underline"
  >
    Activate →
  </a>
)}
```

- [ ] **Step 2: Update integrations page to join McpServer**

In `apps/web/app/(shell)/platform/integrations/page.tsx`, after the `queryMcpIntegrations` call, fetch active server links:

```typescript
  // Fetch which integrations have active servers
  const activeLinks = await prisma.mcpServer.findMany({
    where: { integrationId: { not: null }, status: "active" },
    select: { id: true, integrationId: true },
  });
  const activeMap = new Map(activeLinks.map((s) => [s.integrationId, s.id]));
```

Pass `activeServerId` to each `IntegrationCard`:

```typescript
  <IntegrationCard
    key={integration.id}
    integration={{
      ...integration,
      activeServerId: activeMap.get(integration.id) ?? null,
    }}
  />
```

Also add `id` to the `select` in the `queryMcpIntegrations` params (it's already there from the existing code).

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/platform/IntegrationCard.tsx apps/web/app/(shell)/platform/integrations/page.tsx
git commit -m "feat(mcp): catalog cards show Active badge and Activate button

EP-MCP-ACT-001 Task 11: IntegrationCard shows green Active badge
linking to service detail when McpServer exists, or Activate button
linking to activation form when not."
```

---

### Task 12: Backlog Epic Entry

**Files:**
- Create: `scripts/seed-mcp-activation-epic.sql`

- [ ] **Step 1: Create seed SQL for the epic**

Create `scripts/seed-mcp-activation-epic.sql`:

```sql
-- EP-MCP-ACT-001: MCP Catalog Activation & External Services Surface
-- Seeds the backlog epic for tracking implementation progress.

INSERT INTO "BacklogItem" ("id", "itemId", "title", "body", "status", "priority", "type", "epicId", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'EP-MCP-ACT-001',
  'MCP Catalog Activation & External Services Surface',
  'Enable lifecycle for external MCP services: discover from catalog, activate with connection config, health check, tool discovery, admin surface. Spec: docs/superpowers/specs/2026-03-20-mcp-activation-and-services-surface-design.md',
  'in-progress',
  1,
  'epic',
  'EP-MCP-ACT-001',
  NOW(),
  NOW()
)
ON CONFLICT ("itemId") DO UPDATE SET
  "title" = EXCLUDED."title",
  "body" = EXCLUDED."body",
  "status" = EXCLUDED."status",
  "updatedAt" = NOW();
```

- [ ] **Step 2: Run the seed**

```bash
cd packages/db && npx prisma db execute --file ../../scripts/seed-mcp-activation-epic.sql
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-mcp-activation-epic.sql
git commit -m "feat(mcp): seed EP-MCP-ACT-001 backlog epic

EP-MCP-ACT-001 Task 12: Backlog entry for MCP Catalog Activation
& External Services Surface epic."
```

---

## Verification

### Task 13: End-to-End Smoke Test

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Verify catalog page shows Activate buttons**

Navigate to `/platform/integrations`. Confirm integration cards show "Activate →" links.

- [ ] **Step 3: Verify services page loads**

Navigate to `/platform/services`. Confirm it shows "No registered services yet" with link to catalog.

- [ ] **Step 4: Verify activation form renders**

Navigate to `/platform/services/activate`. Confirm transport picker and form fields render. Try switching between HTTP/SSE/STDIO.

- [ ] **Step 5: Verify platform nav card exists**

Navigate to `/platform`. Confirm "Services" card appears alongside "AI Providers" and "Integrations".

- [ ] **Step 6: Run full test suite**

```bash
cd apps/web && npx vitest run
```

Confirm no regressions.

- [ ] **Step 7: Commit any fixes**

If any fixes were needed during smoke test, commit them.

---

## Summary

| Task | Track | Description | Estimated Effort |
|------|-------|-------------|-----------------|
| 1 | T1 | Schema extension (McpServer + McpServerTool) | Small |
| 2 | T1 | Connection config types + redactConfig() | Small |
| 3 | T1 | Health check (MCP initialize handshake) | Medium |
| 4 | T1 | Tool discovery + namespacing + execution | Medium |
| 5 | T1 | Extend getAvailableTools() + executeTool() | Medium |
| 6 | T1 | Server actions (activate, deactivate, query) | Medium |
| 7 | T2 | ServiceCard component | Small |
| 8 | T2 | Services list page + nav card | Small |
| 9 | T2 | Service detail page + HealthCheckButton | Medium |
| 10 | T2 | Activation form (transport picker, config) | Medium |
| 11 | T2 | Catalog page enhancement (Active/Activate) | Small |
| 12 | — | Backlog epic entry | Small |
| 13 | — | End-to-end smoke test | Small |

**Parallelization:** Track 2 (Tasks 7-11) depends on **both** Task 1 (schema) **and** Task 6 (server actions), because the UI pages import server actions from `mcp-services.ts`. Track 2 can begin once Task 6 is committed. Within each track, tasks are sequential.

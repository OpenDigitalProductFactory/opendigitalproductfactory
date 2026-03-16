# EP-SELF-DEV-001B: COO Codebase Access — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the COO and Build Specialist agents the ability to read project files, search the codebase, and propose file changes with HITL approval.

**Architecture:** Three new MCP tools (`read_project_file`, `search_project_files`, `propose_file_change`) backed by a `codebase-tools.ts` module with path security. Enhanced diff rendering in the existing proposal card component.

**Tech Stack:** Next.js 16, TypeScript strict, existing MCP tool registry, existing HITL approval flow.

**Spec:** `docs/superpowers/specs/2026-03-16-self-dev-codebase-access-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/codebase-tools.ts` | Path security, file read, grep search, file write on approval |
| `apps/web/lib/codebase-tools.test.ts` | Tests for path validation and security |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/lib/mcp-tools.ts` | Add 3 tool definitions + execution handlers |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Diff rendering for propose_file_change proposals |

---

## Chunk 1: Codebase Tools Module

### Task 1: Path Security + File Read

**Files:**
- Create: `apps/web/lib/codebase-tools.ts`
- Create: `apps/web/lib/codebase-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/codebase-tools.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { isPathAllowed, resolveSafePath } from "./codebase-tools";

describe("isPathAllowed", () => {
  it("allows source files", () => {
    expect(isPathAllowed("apps/web/lib/mcp-tools.ts")).toBe(true);
    expect(isPathAllowed("packages/db/prisma/schema.prisma")).toBe(true);
    expect(isPathAllowed("scripts/fresh-install.ps1")).toBe(true);
  });

  it("allows config files", () => {
    expect(isPathAllowed("package.json")).toBe(true);
    expect(isPathAllowed("docker-compose.yml")).toBe(true);
    expect(isPathAllowed("AGENTS.md")).toBe(true);
  });

  it("blocks .env files", () => {
    expect(isPathAllowed(".env")).toBe(false);
    expect(isPathAllowed(".env.local")).toBe(false);
    expect(isPathAllowed("apps/web/.env.local")).toBe(false);
  });

  it("blocks credential files", () => {
    expect(isPathAllowed("secrets.json")).toBe(false);
    expect(isPathAllowed("credentials.json")).toBe(false);
    expect(isPathAllowed("server.key")).toBe(false);
    expect(isPathAllowed("cert.pem")).toBe(false);
  });

  it("blocks path traversal", () => {
    expect(isPathAllowed("../etc/passwd")).toBe(false);
    expect(isPathAllowed("apps/../../etc/passwd")).toBe(false);
  });

  it("blocks absolute paths", () => {
    expect(isPathAllowed("/etc/passwd")).toBe(false);
    expect(isPathAllowed("C:\\Windows\\System32")).toBe(false);
  });

  it("blocks node_modules", () => {
    expect(isPathAllowed("node_modules/foo/index.js")).toBe(false);
  });

  it("blocks .git internals", () => {
    expect(isPathAllowed(".git/config")).toBe(false);
    expect(isPathAllowed(".git/objects/abc")).toBe(false);
  });
});

describe("resolveSafePath", () => {
  it("returns resolved path for allowed files", () => {
    const result = resolveSafePath("apps/web/lib/mcp-tools.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toContain("apps");
      expect(result.path).toContain("mcp-tools.ts");
    }
  });

  it("returns error for blocked files", () => {
    const result = resolveSafePath(".env");
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter web exec vitest run lib/codebase-tools.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `apps/web/lib/codebase-tools.ts`:

```typescript
// apps/web/lib/codebase-tools.ts
// Codebase file access with path security for agent tools.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, relative, isAbsolute } from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = resolve(process.cwd(), "..", "..");

// ─── Path Security ──────────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /^\.env/i,
  /\.env\./i,
  /\.env$/i,
  /\.key$/i,
  /\.pem$/i,
  /\.p12$/i,
  /^credentials/i,
  /^secrets/i,
  /[\\/]\.git[\\/]/,
  /^\.git[\\/]/,
  /^\.git$/,
  /[\\/]node_modules[\\/]/,
  /^node_modules[\\/]/,
];

export function isPathAllowed(filePath: string): boolean {
  // Block absolute paths
  if (isAbsolute(filePath)) return false;
  if (/^[A-Za-z]:/.test(filePath)) return false;

  // Block path traversal
  if (filePath.includes("..")) return false;

  // Block sensitive patterns
  const normalized = filePath.replace(/\\/g, "/");
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) return false;
  }

  return true;
}

type SafePathResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export function resolveSafePath(filePath: string): SafePathResult {
  if (!isPathAllowed(filePath)) {
    return { ok: false, error: `Access denied: ${filePath}` };
  }

  const fullPath = resolve(PROJECT_ROOT, filePath);
  const rel = relative(PROJECT_ROOT, fullPath);

  // Double-check the resolved path is still within project root
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return { ok: false, error: "Path escapes project root" };
  }

  return { ok: true, path: fullPath };
}

// ─── File Operations ────────────────────────────────────────────────────────

export function readProjectFile(
  filePath: string,
  options?: { startLine?: number; endLine?: number },
): { content: string } | { error: string } {
  const resolved = resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  if (!existsSync(resolved.path)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const content = readFileSync(resolved.path, "utf-8");
    if (options?.startLine || options?.endLine) {
      const lines = content.split("\n");
      const start = (options.startLine ?? 1) - 1;
      const end = options.endLine ?? lines.length;
      return { content: lines.slice(start, end).join("\n") };
    }
    return { content };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Read error" };
  }
}

export function searchProjectFiles(
  query: string,
  options?: { glob?: string; maxResults?: number },
): { results: Array<{ path: string; line: number; text: string }> } | { error: string } {
  const max = options?.maxResults ?? 20;
  const globArg = options?.glob ? `--include="${options.glob}"` : "";

  try {
    // Use grep for search — available on Windows via git bash
    const cmd = `grep -rn ${globArg} --max-count=${max} "${query.replace(/"/g, '\\"')}" .`;
    const output = execSync(cmd, {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });

    const results: Array<{ path: string; line: number; text: string }> = [];
    for (const line of output.split("\n").slice(0, max)) {
      const match = line.match(/^\.\/(.+?):(\d+):(.*)$/);
      if (match) {
        const [, path, lineNum, text] = match;
        if (path && lineNum && isPathAllowed(path)) {
          results.push({ path, line: parseInt(lineNum, 10), text: text?.trim() ?? "" });
        }
      }
    }

    return { results };
  } catch {
    return { results: [] };
  }
}

export function writeProjectFile(
  filePath: string,
  content: string,
): { ok: true } | { error: string } {
  const resolved = resolveSafePath(filePath);
  if (!resolved.ok) return { error: resolved.error };

  try {
    writeFileSync(resolved.path, content, "utf-8");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Write error" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web exec vitest run lib/codebase-tools.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/codebase-tools.ts apps/web/lib/codebase-tools.test.ts
git commit -m "feat: add codebase-tools with path security for agent file access"
```

---

## Chunk 2: MCP Tool Definitions

### Task 2: Add codebase tools to MCP registry

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add tool definitions**

Add to the `PLATFORM_TOOLS` array in `apps/web/lib/mcp-tools.ts`:

```typescript
  // ─── Codebase Access Tools ──────────────────────────────────────────────────
  {
    name: "read_project_file",
    description: "Read a file from the project codebase. Use relative paths like 'apps/web/lib/mcp-tools.ts'. Cannot access .env, credentials, or node_modules.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path from project root" },
        startLine: { type: "number", description: "Start line (1-based, optional)" },
        endLine: { type: "number", description: "End line (optional)" },
      },
      required: ["path"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
  },
  {
    name: "search_project_files",
    description: "Search the project codebase for a text pattern. Returns matching file paths, line numbers, and context.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search for" },
        glob: { type: "string", description: "File glob filter, e.g. '*.ts' or '*.tsx'" },
        maxResults: { type: "number", description: "Maximum results (default 20)" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
  },
  {
    name: "propose_file_change",
    description: "Propose a change to a project file. Shows a diff for human review. Requires approval before the change is applied.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path to modify or create" },
        description: { type: "string", description: "Human-readable description of the change" },
        newContent: { type: "string", description: "The complete new file contents" },
      },
      required: ["path", "description", "newContent"],
    },
    requiredCapability: "manage_capabilities",
  },
```

- [ ] **Step 2: Add execution handlers**

Add to the `executeTool` switch statement:

```typescript
    case "read_project_file": {
      const { readProjectFile } = await import("@/lib/codebase-tools");
      const result = readProjectFile(
        String(params.path),
        {
          startLine: typeof params.startLine === "number" ? params.startLine : undefined,
          endLine: typeof params.endLine === "number" ? params.endLine : undefined,
        },
      );
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      return { success: true, message: result.content, data: { content: result.content } };
    }

    case "search_project_files": {
      const { searchProjectFiles } = await import("@/lib/codebase-tools");
      const result = searchProjectFiles(
        String(params.query),
        {
          glob: typeof params.glob === "string" ? params.glob : undefined,
          maxResults: typeof params.maxResults === "number" ? params.maxResults : undefined,
        },
      );
      if ("error" in result) return { success: false, error: result.error, message: result.error };
      const summary = result.results.map((r) => `${r.path}:${r.line}: ${r.text}`).join("\n");
      return { success: true, message: summary || "No matches found", data: { results: result.results } };
    }

    case "propose_file_change": {
      const { readProjectFile, writeProjectFile } = await import("@/lib/codebase-tools");
      const path = String(params.path);
      const newContent = String(params.newContent);

      // Read current content for diff generation (may not exist for new files)
      const current = readProjectFile(path);
      const currentContent = "content" in current ? current.content : "";

      // Generate a simple line-based diff for display
      const oldLines = currentContent.split("\n");
      const newLines = newContent.split("\n");
      const diffLines: string[] = [`--- a/${path}`, `+++ b/${path}`];
      // Simple diff: show removed and added lines
      for (const line of oldLines) {
        if (!newLines.includes(line)) diffLines.push(`-${line}`);
      }
      for (const line of newLines) {
        if (!oldLines.includes(line)) diffLines.push(`+${line}`);
      }
      const diff = diffLines.join("\n");

      // Write the file
      const writeResult = writeProjectFile(path, newContent);
      if ("error" in writeResult) return { success: false, error: writeResult.error, message: writeResult.error };

      return {
        success: true,
        entityId: path,
        message: `Applied change to ${path}`,
        data: { path, diff, description: String(params.description) },
      };
    }
```

- [ ] **Step 3: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/mcp-tools.ts
git commit -m "feat: add read_project_file, search_project_files, propose_file_change MCP tools"
```

---

## Chunk 3: Diff Card Rendering

### Task 3: Enhanced proposal card for file changes

**Files:**
- Modify: `apps/web/components/agent/AgentMessageBubble.tsx`

- [ ] **Step 1: Add diff rendering for propose_file_change proposals**

In `AgentMessageBubble.tsx`, inside the proposal card rendering section, add a special case when `p.actionType === "propose_file_change"`:

```typescript
// Inside the proposal card, before the generic parameter display:
if (p.actionType === "propose_file_change") {
  const filePath = p.parameters.path as string;
  const description = p.parameters.description as string;
  const diff = (p.parameters as Record<string, unknown>).diff as string | undefined;

  return (
    <div style={{ marginBottom: 12 }}>
      {message.content && (
        <div style={{ padding: "8px 12px", borderRadius: "12px 12px 12px 2px", fontSize: 13, lineHeight: 1.4, background: "rgba(22, 22, 37, 0.8)", color: "#e0e0ff", marginBottom: 6 }}>
          {message.content}
        </div>
      )}
      <div style={{
        background: "rgba(26, 26, 46, 0.9)",
        border: `1px solid ${isApproved ? "rgba(74,222,128,0.4)" : isRejected || isFailed ? "rgba(239,68,68,0.4)" : "rgba(124,140,248,0.4)"}`,
        borderRadius: 10, padding: "10px 14px", fontSize: 12,
      }}>
        <div style={{ fontWeight: 600, color: "#e0e0ff", marginBottom: 4 }}>
          Propose File Change
        </div>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#7c8cf8", marginBottom: 4 }}>
          {filePath}
        </div>
        <div style={{ color: "var(--dpf-muted)", fontSize: 11, marginBottom: 8 }}>
          {description}
        </div>
        {diff && (
          <pre style={{
            background: "#0d0d18", borderRadius: 6, padding: 8, fontSize: 10,
            fontFamily: "monospace", lineHeight: 1.5, overflow: "auto", maxHeight: 300,
            border: "1px solid #2a2a40",
          }}>
            {diff.split("\n").map((line, i) => {
              const colour = line.startsWith("+") ? "#4ade80"
                : line.startsWith("-") ? "#ef4444"
                : line.startsWith("@@") ? "#7c8cf8"
                : "#8888a0";
              return (
                <div key={i} style={{ color: colour }}>
                  {line}
                </div>
              );
            })}
          </pre>
        )}
        {isPending && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" onClick={() => onApprove?.(p.proposalId)} style={{ flex: 1, background: "rgba(74,222,128,0.2)", border: "1px solid rgba(74,222,128,0.4)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#4ade80", cursor: "pointer" }}>
              Approve & Apply
            </button>
            <button type="button" onClick={() => onReject?.(p.proposalId)} style={{ flex: 1, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "#ef4444", cursor: "pointer" }}>
              Reject
            </button>
          </div>
        )}
        {isApproved && <div style={{ color: "#4ade80", fontSize: 11, marginTop: 6 }}>✓ Applied to {filePath}</div>}
        {isRejected && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 6 }}>✕ Rejected</div>}
        {isFailed && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 6 }}>⚠ Failed: {p.resultError}</div>}
      </div>
    </div>
  );
}
```

This should be inserted as an early return before the generic proposal card rendering, inside the existing `if (!isUser && message.proposal)` block.

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/agent/AgentMessageBubble.tsx
git commit -m "feat: add diff card rendering for propose_file_change proposals"
```

---

## Chunk 4: Verification

### Task 4: Final verification

- [ ] **Step 1: Run all tests**

```bash
pnpm test
```

- [ ] **Step 2: Type check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Manual verification plan**

1. Open the co-worker panel on any page, switch to COO mode
2. Ask: "Show me the contents of AGENTS.md"
3. Agent should call `read_project_file` and return the file contents
4. Ask: "Search for all files that reference AgentActionProposal"
5. Agent should call `search_project_files` and return matching files/lines
6. Ask: "Update the AGENTS.md to add a section about COO authority"
7. Agent should call `propose_file_change` with a diff card
8. Click Approve → file should be updated on disk
9. Verify the change applied (read the file again or check via IDE)

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Chunk 5: Create Backlog Items

### Task 5: Register this work in the backlog

- [ ] **Step 1: Create epic and backlog items in the database**

```sql
-- Create the self-dev epic
INSERT INTO "Epic" (id, "epicId", title, description, status)
VALUES (
  'ep-self-dev-001b',
  'EP-SELF-DEV-001B',
  'COO Codebase Access (Self-Development MVP)',
  'Agents can read project files, search the codebase, and propose file changes with HITL approval.',
  'open'
);

-- Backlog items
INSERT INTO "BacklogItem" (id, "itemId", title, status, type, priority, "epicId")
VALUES
  (gen_random_uuid()::text, 'BI-SELFDEV-B01', 'Codebase tools module with path security', 'open', 'product', 1, 'ep-self-dev-001b'),
  (gen_random_uuid()::text, 'BI-SELFDEV-B02', 'read_project_file and search_project_files MCP tools', 'open', 'product', 2, 'ep-self-dev-001b'),
  (gen_random_uuid()::text, 'BI-SELFDEV-B03', 'propose_file_change MCP tool with HITL approval', 'open', 'product', 3, 'ep-self-dev-001b'),
  (gen_random_uuid()::text, 'BI-SELFDEV-B04', 'Diff card rendering in agent chat for file changes', 'open', 'product', 4, 'ep-self-dev-001b');
```

- [ ] **Step 2: Commit backlog update**

This is a database-only change — no code commit needed. The items will be visible in the ops backlog.

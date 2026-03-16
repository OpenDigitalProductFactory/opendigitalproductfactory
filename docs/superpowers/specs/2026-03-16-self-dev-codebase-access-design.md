# EP-SELF-DEV-001B: COO Codebase Access — Design Spec

**Date:** 2026-03-16
**Goal:** The COO and Build Specialist agents can read project files, propose code changes as diffs, and apply approved changes to the running platform. This is the minimum viable self-development capability — no sandbox container needed.
**Parent:** EP-SELF-DEV-001A (Product Development Studio + Sandbox)
**Prerequisite:** Agent tool-use with HITL approval (EP-AGENT-EXEC-001 — complete)

---

## 1. Why This Slice First

The full self-dev sandbox (EP-SELF-DEV-001A) requires Docker container orchestration, live preview proxying, and coding agent integration. That's a large body of work.

But the core value proposition is simpler: **an agent that can read the codebase, understand what exists, and propose specific changes**. With HITL approval already built, the agent proposes a diff → human reviews → approves → change is applied.

This is how Claude Code works today (from VS Code), but brought inside the platform where the COO can do it from any page.

### What the full sandbox adds later
- Isolated container (no risk of breaking the running platform)
- Live preview (user sees changes before applying)
- pnpm install / test / typecheck inside the sandbox
- Multi-file generation with full repo context

### What this slice provides now
- Agent reads any file in the project
- Agent proposes changes as unified diffs
- Human reviews the diff in the chat
- Human approves → platform applies the change
- Audit trail via AgentActionProposal + AuthorizationDecisionLog

---

## 2. New MCP Tools

Three new tools added to the platform tool registry. All follow the existing tool-use → proposal → approval pattern.

### `read_project_file`
- **Capability:** `view_platform`
- **Execution mode:** `immediate` (read-only, no approval needed)
- **Parameters:** `{ path: string, startLine?: number, endLine?: number }`
- **Returns:** File contents (or error if not found / outside project root)
- **Security:** Path must be within the project root. Rejects absolute paths, `..` traversal, and paths matching `.env*`, `*.key`, `*.pem`, `credentials*` patterns.

### `search_project_files`
- **Capability:** `view_platform`
- **Execution mode:** `immediate` (read-only)
- **Parameters:** `{ query: string, glob?: string, maxResults?: number }`
- **Returns:** Matching file paths with line numbers and context snippets
- **Implementation:** Uses `grep -rn` on the project directory with the query pattern, filtered by glob if provided.

### `propose_file_change`
- **Capability:** `manage_capabilities` (HR-000 / superuser only)
- **Execution mode:** `proposal` (requires human approval)
- **Parameters:** `{ path: string, description: string, diff: string }`
- **Description:** Agent proposes a unified diff. Rendered as a diff card in the chat. On approval, the platform applies the patch.
- **Diff format:** Standard unified diff (`--- a/path`, `+++ b/path`, `@@ -line,count +line,count @@`). Agent generates this from its knowledge of the current file contents (obtained via `read_project_file`).
- **Execution on approval:** Write the new file contents to disk. The agent constructs the full new file, not just the diff — the diff is for human review, the execution replaces the file.

### Why not `propose_new_file` separately?
`propose_file_change` handles both modifications and new file creation. For new files, the diff shows all lines as additions. The execution writes the file regardless.

---

## 3. Security Model

### Path Restrictions
All file operations are restricted to the project root (`process.cwd()` or the configured install directory).

**Blocked patterns:**
- Paths containing `..`
- Absolute paths (must be relative to project root)
- `.env`, `.env.*` files
- `*.key`, `*.pem`, `*.p12` files
- `credentials*`, `secrets*` files
- `node_modules/` (too large, not useful)
- `.git/` internal files

**Allowed:**
- All source files (`apps/`, `packages/`, `scripts/`)
- Configuration files (`package.json`, `tsconfig.json`, `docker-compose*.yml`)
- Documentation (`docs/`, `README.md`, `AGENTS.md`)
- Schema files (`prisma/schema.prisma`)

### Approval Gating
- `read_project_file` and `search_project_files` execute immediately (read-only)
- `propose_file_change` creates an AgentActionProposal that the user must approve
- The proposal card shows the diff with syntax highlighting (or at minimum, additions in green / deletions in red)
- On approval, the file is written to disk
- On rejection, nothing happens

### Audit Trail
All proposed changes are logged via the existing AgentActionProposal → AuthorizationDecisionLog chain. Every change to the codebase from an agent is traceable to: who asked → which agent proposed → who approved → what changed.

---

## 4. Diff Card Rendering

When `propose_file_change` creates a proposal, the existing proposal card in `AgentMessageBubble.tsx` needs to render the diff meaningfully.

**Current proposal card shows:**
- Action type label
- Parameters as key-value pairs
- Approve / Reject buttons

**Enhanced for diffs:**
- File path as header
- Description of the change
- Diff rendered with additions (green background) and deletions (red background)
- Line numbers
- Approve / Reject buttons

This is a targeted extension of the existing `AgentMessageBubble` proposal card — not a new component. When `actionType === "propose_file_change"`, render the diff-specific layout.

---

## 5. Files Affected

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/codebase-tools.ts` | File read, search, and change proposal logic + path security |

### Modified Files
| File | Change |
|------|--------|
| `apps/web/lib/mcp-tools.ts` | Add 3 new tool definitions + execution handlers |
| `apps/web/components/agent/AgentMessageBubble.tsx` | Enhanced diff rendering for `propose_file_change` proposals |

---

## 6. Design Decisions

### Why not use the sandbox for this?
The sandbox is designed for multi-file code generation with a live preview. Reading files and proposing targeted changes is simpler and doesn't need container isolation — the HITL approval gate is the safety mechanism.

### Why unified diff format?
It's the most widely understood diff format. Developers read it naturally. It maps directly to `git diff` output. It can be applied with `patch` or parsed to reconstruct the file.

### Why does the agent send the full new file content, not just the patch?
Applying patches programmatically is fragile (context lines must match exactly). Sending the full file is more reliable — the diff is for human review, the full file is for execution. The tradeoff is more tokens, but reliability matters more.

### Why `manage_capabilities` for `propose_file_change`?
This is the highest-privilege capability in the system. Writing to the codebase is a platform-level action that should only be available to HR-000 / superuser roles. Read access is broader (`view_platform`).

---

## 7. Interaction Example

**User (on any page, COO mode):**
> "The provider detail page back-link says 'AI Providers' but should say 'AI Workforce' since we moved the default."

**COO:**
> Let me check the current code.
> *(calls read_project_file: apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx)*
>
> I see the issue on line 46. Here's the fix:
> *(calls propose_file_change with diff showing the text change)*

**Chat shows:** Diff card with the one-line change, green/red highlighting, Approve/Reject buttons.

**User clicks Approve** → file is updated on disk → hot-reload picks it up → change is live.

---

## 8. Not in Scope

- Sandbox container (EP-SELF-DEV-001A Chunk 5+)
- Multi-file changes in one proposal (v1 is one file per proposal)
- Running tests or typechecks (the agent can suggest running them, but can't execute)
- Git commit from the agent (human commits via their own workflow)
- Creating new directories (files only — directory creation happens implicitly)

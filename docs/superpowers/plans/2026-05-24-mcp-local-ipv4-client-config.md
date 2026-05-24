# MCP Local IPv4 Client Config Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent DPF MCP client setup from regenerating `localhost` URLs that can hang on Windows IPv6 loopback.

**Architecture:** Normalize only local HTTP client-facing URLs from `localhost` to `127.0.0.1` in the shared MCP setup snippet helper, so Admin token issuance and the CLI share one behavior. Update the worktree sync script and docs command to use the same IPv4 loopback endpoint while preserving non-localhost LAN and HTTPS URLs unchanged.

**Tech Stack:** Next.js/TypeScript helper tests with Vitest, Windows PowerShell sync script, AGENTS.md operational docs.

---

### Task 1: Shared MCP Setup Snippet Normalization

**Files:**
- Modify: `apps/web/lib/auth/mcp-setup-snippets.test.ts`
- Modify: `apps/web/lib/auth/mcp-setup-snippets.ts`

- [x] **Step 1: Write failing tests** for `http://localhost:3000` producing `http://127.0.0.1:3000` in Claude Code, VS Code, Codex, and runtime refresh snippets, while preserving `https://dpf.example.com`.
- [x] **Step 2: Run focused Vitest** and confirm the new test fails because URLs still contain `localhost`.
- [x] **Step 3: Implement minimal URL normalization** in the shared helper.
- [x] **Step 4: Re-run focused Vitest** and confirm it passes.

### Task 2: Sync Script and Docs Alignment

**Files:**
- Modify: `scripts/sync-mcp-worktrees.ps1`
- Modify: `AGENTS.md`

- [x] **Step 1: Update the sync script MCP URL** to `http://127.0.0.1:3000/api/mcp/v1`.
- [x] **Step 2: Update AGENTS.md token refresh command** to use `127.0.0.1`.
- [x] **Step 3: Inspect generated snippets/tests** so no source setup path still emits local `localhost`.

### Task 3: Verification

**Files:**
- No additional source files.

- [x] **Step 1: Run focused MCP setup tests.**
- [x] **Step 2: Run the related MCP token action tests.**
- [x] **Step 3: Verify live MCP still answers through Codex.**
- [x] **Step 4: Report whether local untracked `.mcp.json` files also need regeneration or repair.**

### Evidence

- Focused Vitest: `apps/web/lib/auth/mcp-setup-snippets.test.ts`, `apps/web/lib/auth/mcp-host-writer.test.ts`, `apps/web/lib/actions/mcp-tokens.test.ts`, and `apps/web/components/admin/McpTokenManager.test.tsx`.
- Typecheck: `pnpm --filter web typecheck`.
- Production build: `cd apps/web && pnpm exec next build`.
- Live MCP smoke: `http://127.0.0.1:3000/api/mcp/v1` `tools/list` succeeded.
- Local repair: root `.mcp.json` and `.vscode/mcp.json` were updated to `127.0.0.1`.

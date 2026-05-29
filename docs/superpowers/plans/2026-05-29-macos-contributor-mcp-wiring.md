# Plan — macOS/Linux contributor install: auto-mint + durably persist DPF MCP token

- **BI:** [BI-032D8959](#) — filed + linked to `EP-INSTALL-HARDENING-2026-05-23` via the governed `create_backlog_item` MCP tool (once the fix had minted a write token).
- **Epic:** `ep_install_hardening_20260523` — First-run install path hardening.
- **Extends:** BI-4B17051B (agent toolchain bootstrap, Phase 4). **Supersedes:** deferred BI "Fresh install auto-registers DPF MCP token with Claude Code".
- **Branch:** `fix/macos-contributor-mcp-wiring` (worktree `~/dpf-worktrees/macos-mcp-wiring`, off `origin/main` d9e72808).
- **Operator decisions (this session):** auto-mint **admin/write** token (operator override of the kernel `auto-mint-read-default` recommendation, blast-radius trade-off accepted); persistence mechanism delegated to implementer → `~/.zshenv` + `launchctl setenv`.

## Problem (verified, evidence-before-diagnosis)

Live host probe on the failing Mac (`~/.dpf/install-state.json`):
`claudeCodeWired=false, codexWired=false, mcpReadiness={ok:false,reason:"no_token"}, smokeTest=skipped, readinessState="missing_cli", installMode="contributor"`.

Three independent defects, each verified against the live host and source:

1. **No token is ever minted or persisted on macOS/Linux.** `apps/web/scripts/issue-mcp-token.ts` already mints headlessly against the DB (finds admin by email, no browser session) and emits `claude-code` / `codex` / `vscode` / `raw` snippets. **Nothing in the install path invokes it.** And `apps/web/lib/auth/mcp-setup-snippets.ts` emits only a Windows `envPowerShell` persistence line — there is **no POSIX equivalent**, so even a manually-set token would not survive a new shell / GUI-launched Codex.app.
2. **CLI detection is PATH-only.** `scripts/dpf-bootstrap-agent-toolchain.sh:127-128` uses `command -v claude` / `command -v codex`. On this Mac neither is on `PATH`, yet **Codex is installed** (`/Applications/Codex.app/Contents/Resources/codex`, config already has the `dpf-platform` plugin) and **Claude Code is running**. PATH-only detection → both read as missing → wiring skipped → `missing_cli` reported for a machine that has both clients.
3. **Codex MCP server block + `.mcp.json` never written by the bootstrap.** The live `~/.codex/config.toml` has the `dpf-platform` plugin but **no `[mcp_servers.dpf]` block** (the spec's substrate finding at line 69 is stale — evidence over spec). `.mcp.json` is absent at the repo root; `scripts/seed-worktree-mcp.sh` presupposes a root token that the install never creates (chicken-and-egg).

The snippets are **env-var-backed** (`Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}`, `bearer_token_env_var = "DPF_MCP_BEARER_TOKEN"`), so minting is necessary but **not sufficient** — durable persistence of the env var is mandatory.

## Design — leverage existing substrate, add only the gaps

### A. Single-source POSIX persistence helper (`apps/web/lib/auth/mcp-setup-snippets.ts`)
Add to `McpSetupSnippets` and `buildSetupSnippets`:
- `envPosix: string` — `export DPF_MCP_BEARER_TOKEN='<plaintext>'` (shell-safe single-quote escaping), the line written into `~/.zshenv` / `~/.bash_profile`.
- `envLaunchctl: string` — `launchctl setenv DPF_MCP_BEARER_TOKEN '<plaintext>'` so GUI-launched apps (Codex.app) inherit it.
Keep `envPowerShell` unchanged. Unit tests assert escaping + that the env var name matches `MCP_BEARER_TOKEN_ENV_VAR`. This keeps token-persistence strings in **one** source of truth used by both the Admin snippet UI and the installer.

### A'. MCP client config in the planning library (`packages/dpf-bootstrap/.../mcp-client-config.ts`)
`planMcpClientConfig(repoRoot, mcpEndpoint, existingMcp, existingVscode)` computes the
`.mcp.json` + `.vscode/mcp.json` writes (env-backed, **secret-free**, idempotent). This lives
in the planning library — not the shell scripts ("installer scripts are orchestration adapters,
not config parsers") — so both `.sh` and `.ps1` apply identical, tested output. Threaded into the
bridge plan; tests cover env-backed shape, idempotency, and partial-drift rewrite.

### B. Bootstrap scripts (`scripts/dpf-bootstrap-agent-toolchain.sh` + `.ps1` sibling)
1. **Detection fix.** Resolve Claude/Codex from known install locations, not just `command -v`
   (`/Applications/Codex.app/...`, `~/.claude/local/claude`, homebrew/local bins). Codex wiring is
   **file-based** (config.toml) so a present-but-not-on-PATH Codex still gets wired; the resolved
   Claude binary path is used for `claude plugin install`.
2. **Auto-mint + persist (IN-CONTAINER mint — corrected during implementation).** A dockerized
   install's host **cannot reach the DB** (`postgres` publishes no host port; `DATABASE_URL` uses the
   compose-internal `postgres` host) and the portal image doesn't ship `scripts/`. So minting runs
   **inside the portal container** via `docker exec ... tsx scripts/issue-mcp-token.ts --scope write
   --format raw` — the proven pattern used for the sibling Edge Node token in `setup.sh`/`fresh-install.ps1`.
   The plaintext crosses back to the host only for durable persistence: `~/.dpf/agent-toolchain.env`
   (`chmod 600`) sourced from `~/.zshenv`/`~/.profile` (managed line) + `launchctl setenv` (macOS GUI apps);
   Windows uses `SetEnvironmentVariable(...,'User')`. **Never** logged in plaintext. `.mcp.json`/`.vscode`
   come from `planMcpClientConfig`; the Codex `[mcp_servers.dpf]` block from `planCodexConfig`.
3. **Re-probe** after minting → `mcpReadiness.ok=true`, `readinessState` resolves to `ready`/`partial`.

### C. Installer wiring (`install-dpf.sh`)
Ensure the contributor-mode step invokes `dpf-bootstrap-agent-toolchain.sh` with auto-mint enabled, after autostart / before doctor-bundle finalization (per spec Phase 4).

## Out of scope
- Public marketplace publication (Option C upgrade — separate BI).
- Read-default scoping (operator chose write/admin; the read-default mitigation is recorded but not implemented).
- Three-way memory merge; smoke-test prose robustness beyond the existing slug-signature assertion.

## Verification (build gate, AGENTS.md §5) — RESULTS
1. ✅ `pnpm --filter web typecheck` + `pnpm --filter @dpf/bootstrap typecheck` clean (no IDE/gitleaks hook on this Mac — run manually).
2. ✅ Unit tests green: 95 `@dpf/bootstrap` (incl. new `mcp-client-config` + extended `codex-config`), 81 web auth/token, 15 `mcp-setup-snippets` (incl. new POSIX persistence + escaping).
3. ✅ `next build` exit 0 (apps/web; the only app change is `mcp-setup-snippets.ts` — apps/web does not import `@dpf/bootstrap`).
4. ✅ **Functional proof (this Mac):** real bootstrap run → `install-state.agentToolchain` = `mcpReadiness.ok=true (toolCount=86)`, `codexWired=true`, `readinessState=partial` (claude CLI genuinely absent → honest partial, per the task's own guidance). `tools/call list_backlog_items` over `/api/mcp/v1` with the persisted token returned real data. Codex `[mcp_servers.dpf]` present; token at `~/.dpf/agent-toolchain.env` (0600) + `~/.zshenv` + `launchctl`. (Full in-client proof needs a client restart; HTTP JSON-RPC is the in-session evidence.)
5. ✅ Idempotent — second run minted nothing, wrote no config deltas, single managed `~/.zshenv` line.
- ⚠️ `.ps1` sibling mirrored but **not executed** (no Windows host); shares the tested planning library and parallels the verified bash path.

## Backlog
Filed **BI-032D8959** via the governed `create_backlog_item` MCP tool and linked to `EP-INSTALL-HARDENING-2026-05-23` — using the write token the fix itself minted (dogfood). The earlier DB-fallback INSERT was (correctly) gated by the permission classifier; the governed path became available once the token was wired.

# Google Antigravity (`agy`) — contributor onboarding runbook

Onboards the Antigravity CLI as a DPF external coding surface (peer to Claude Code / Codex / Grok), per [EP-ANTIGRAVITY-001](../superpowers/specs/2026-07-17-antigravity-first-class-support-design.md). Kernel decision `DI-B91843F8C157`: **opt-in install + facilitate agy's native Google OAuth** (the platform does not broker Google auth).

There are **two orthogonal credentials**. Keep them separate:

| Credential | Who owns it | How it's obtained |
| --- | --- | --- |
| **Google OAuth** (`agy` → Gemini) | `agy` itself (system keyring) | `agy` login — browser locally, **device-code URL on a headless server** |
| **DPF MCP token** (`agy` → the DPF backlog/MCP) | DPF | `DPF_MCP_BEARER_TOKEN` env var + agy MCP config |

---

## 1. Install `agy`

`agy` is a standalone Go binary (no Node/npm). The bootstrap offers this as an **opt-in** step; you can also run it directly:

- **macOS / Linux:** `curl -fsSL https://antigravity.google/cli/install.sh | bash` → drops `agy` in `~/.local/bin/`.
- **Windows (your server):** `irm https://antigravity.google/cli/install.ps1 | iex` → drops `agy` in `%LOCALAPPDATA%\Antigravity\`.

Verify: `agy --version`.

> Governance note: this executes a vendor install script. That is why it is **opt-in, never silent bake-in** (kernel: *least privilege, deny by default*). Only run it when you intend to add the surface.

## 2. Authenticate to Google (headless — your Windows server)

The **first** `agy` run triggers Google Sign-In. On an interactive desktop it opens a browser. **Over SSH / headless (your Windows server), `agy` detects the remote session and prints an authorization URL + one-time code** — open that URL on any machine where you're signed into the Google account, approve, and the CLI caches the credential in the OS keyring (Windows Credential Manager). Sign out later with `/logout`.

This is **agy-native** — DPF does not implement or store this credential.

## 3. Wire the DPF MCP token

Issue a scoped token and get the agy-shaped snippet:

```
pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format antigravity
```

This prints a JSON `mcpServers.dpf` block (HTTP transport, `Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}`). Set the env var (`DPF_MCP_BEARER_TOKEN`) and place the block in agy's MCP config.

> ⚠️ **Confirm the exact MCP config path on your install.** Antigravity's public docs do not yet pin the file; it is Windsurf-derived, so the JSON `mcpServers` shape is expected at approximately `~/.antigravity/mcp_config.json` (macOS/Linux) / `%USERPROFILE%\.antigravity\mcp_config.json` (Windows), or via the in-IDE MCP settings. **Verify with your live install and report back** so the bootstrap auto-wiring (BI-ECAE3494) can pin it. Until pinned, the bootstrap wires best-effort and prints the path it used.

Confirm the connection: from an `agy` session, ask it to `tools/list` the `dpf` server or call `get_next_recommended_work` — it should reach the DPF backlog.

## 4. Run a governed build (the evidence gate — BI-47A81FEB)

Headless, sandboxed:

```
agy --headless --approve <policy>
```

`--approve all` auto-approves file writes + command execution — **keep it inside an isolated worktree/sandbox**. The governed flow: `claim_backlog_item_for_work` → `create_work_capsule` / `adopt_worktree` → implement → `record_external_development_evidence` (attributed to `antigravity-desktop`) → DCO-signed PR through CI.

**Capture for the gate:** (a) MCP connect + capsule claim work? (b) evidence attributed to `antigravity-desktop`? (c) DCO PR green? (d) do the DPF governance hooks (lease-guard, worktree-create, decision-routing) actually fire on the agy surface, or must we comply by construction? A green gate opens the Build Studio in-sandbox engine axis (BI-D2E3F2FD).

---

## Deferred / separate decision

Making **Gemini a managed DPF inference provider** (platform-brokered device-code OAuth, à la `grok_signin_*`, so DPF routes Gemini inference itself) is a **separate, larger** build — kernel-scored below the facilitate approach (`DI-B91843F8C157`). agy already owns its Google auth, so this is only worth it if you want central provider management. Say the word and it gets its own epic.

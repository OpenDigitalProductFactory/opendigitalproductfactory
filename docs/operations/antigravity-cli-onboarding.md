# Google Antigravity (`agy`) — contributor onboarding runbook

Onboards the Antigravity CLI as a DPF external coding surface (peer to Claude Code / Codex / Grok), per [EP-ANTIGRAVITY-001](../superpowers/specs/2026-07-17-antigravity-first-class-support-design.md). Kernel decision `DI-B91843F8C157`: **opt-in install + facilitate agy's native Google OAuth** (the platform does not broker Google auth).

> **Scope:** Antigravity is supported as a **host contributor CLI** (this runbook). It is **not** a Build Studio in-sandbox dispatch engine — see [why](../user-guide/build-studio/sandbox.md#why-google-antigravity-is-not-a-dispatch-engine-yet).

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

## 3. Connect the DPF MCP token

First get a scoped token — you need it for every method below:

```
pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format antigravity
```

Set `DPF_MCP_BEARER_TOKEN` to the token, and keep the printed JSON `mcpServers.dpf` block (HTTP transport, `Authorization: Bearer ${DPF_MCP_BEARER_TOKEN}`) handy.

**Preferred — let `agy` add the server itself.** In an `agy` session, ask it to add an MCP server named `dpf` at `http://127.0.0.1:3000/api/mcp/v1` with an `Authorization: Bearer` header from `DPF_MCP_BEARER_TOKEN`. This is the **sure-fire path**: `agy` writes the entry to whatever config file it actually reads, so you never have to know or guess that path (operator-confirmed working, 2026-07-17).

**Fallback — write the config yourself.** Place the `mcpServers.dpf` block in agy's MCP config. The path is Windsurf-derived and not pinned in public docs — approximately `~/.antigravity/mcp_config.json` (macOS/Linux) / `%USERPROFILE%\.antigravity\mcp_config.json` (Windows), or the in-IDE MCP settings. The bootstrap wires this best-effort and **prints the path it used**; if agy doesn't pick it up, use the preferred method above instead. (Pinning the exact path is `BI-ECAE3494` — no longer load-bearing now that self-add works.)

## 3b. Confirm the DPF MCP is live — at the start of **every** thread

**The MCP connection is per-session and does not always carry into a fresh `agy` thread.** This is the same failure mode DPF's *self-provision-before-working* contract guards against ([AGENTS.md](../../AGENTS.md) §"Self-provision before working"): a session missing its DPF tools must converge **before** doing any work — otherwise the agent silently has no backlog, no evidence recording, and no governed tools, and will improvise around the gap.

**Check (do this first, each thread):** ask `agy` to list its connected MCP servers, or to call a benign read-only DPF tool such as `get_next_recommended_work`. If the `dpf` tools aren't there, the MCP is **not** connected in this session — do not proceed.

**Self-heal:** confirm `DPF_MCP_BEARER_TOKEN` is set in the environment agy launched from, then re-run the **preferred** method in §3 (ask agy to add the `dpf` server) and start a fresh agy session so it reloads. Treat "no `dpf` tools" as a hard stop, not a warning.

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

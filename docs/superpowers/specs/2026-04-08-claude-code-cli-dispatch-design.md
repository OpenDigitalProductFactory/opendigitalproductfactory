# Claude Code CLI Dispatch for Build Studio

**Date:** 2026-04-08
**Status:** Draft
**Author:** Mark Bodman + Claude

## Problem

Build Studio currently dispatches build tasks to OpenAI Codex CLI inside the sandbox container. We want to add Claude Code CLI as an alternative dispatcher using the same proven pattern, so builds can use Anthropic models via a Claude Max subscription (flat-rate, no per-token API cost).

## Design

### Architecture — Mirror the Codex Pattern

The implementation mirrors `codex-dispatch.ts` exactly:

```
Portal (build-orchestrator.ts)
  → claude-dispatch.ts
    → getDecryptedCredential("claude-code")
    → inject CLAUDE_CODE_OAUTH_TOKEN into sandbox via docker exec
    → run: claude --bare -p "task" --dangerously-skip-permissions --output-format json
    → parse JSON result → return ClaudeResult (same shape as CodexResult)
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/lib/integrate/claude-dispatch.ts` | **Create** | New dispatcher, mirrors codex-dispatch.ts |
| `apps/web/lib/integrate/build-orchestrator.ts` | **Modify** | Add CLI_PROVIDER toggle: "codex" \| "claude" \| "agentic" |
| `Dockerfile.sandbox` | **Modify** | Add `npm install -g @anthropic-ai/claude-code` |

### Authentication

Two auth modes are supported, controlled by `CLAUDE_CODE_AUTH_MODE` env var:

#### OAuth Mode (default) — Claude Max Plan

**Strongly recommended.** Flat-rate subscription billing. ~20x more economical than API keys for sustained build workloads ($100 lasts 5+ days vs. a few hours with API keys).

```bash
CLAUDE_CODE_AUTH_MODE=oauth   # default, can be omitted
```

Uses `CLAUDE_CODE_OAUTH_TOKEN` environment variable:

```json
{
  "accessToken": "sk-ant-oat01-...",
  "refreshToken": "...",
  "expiresAt": "2027-02-18T07:00:00.000Z"
}
```

**Credential flow:**
1. Admin logs in to Claude Code locally, runs `claude setup-token` to get a long-lived token
2. Token is stored in DPF's credential store under providerId `"claude-code"` with:
   - `cachedToken` = the `accessToken` value (sk-ant-oat01-...)
   - `refreshToken` = the refresh token
   - `tokenExpiresAt` = expiry timestamp
3. At dispatch time, `getDecryptedCredential("claude-code")` decrypts the token
4. Token is injected into sandbox as `CLAUDE_CODE_OAUTH_TOKEN` env var on the `docker exec` command

#### API Key Mode — Per-Token Billing

For quick testing or when Max Plan is unavailable. **Expensive at scale** — $100 can burn in a few hours of build activity.

```bash
CLAUDE_CODE_AUTH_MODE=apikey
```

Uses `ANTHROPIC_API_KEY` environment variable (standard Anthropic API key).

**Credential flow:**

1. Get API key from console.anthropic.com
2. Store in DPF credential store under providerId `"claude-code"` with:
   - `secretRef` = the API key (sk-ant-api03-...) — OR use `cachedToken` field
3. At dispatch time, key is injected as `ANTHROPIC_API_KEY` env var on the `docker exec` command

#### Auth precedence in Claude Code CLI (from docs)

1. Cloud provider creds (Bedrock/Vertex/Foundry) — not used
2. `ANTHROPIC_AUTH_TOKEN` — not used
3. `ANTHROPIC_API_KEY` — used in apikey mode
4. `apiKeyHelper` script — not used
5. **Subscription OAuth from `CLAUDE_CODE_OAUTH_TOKEN`** — used in oauth mode (default)

### CLI Invocation

```bash
CLAUDE_CODE_OAUTH_TOKEN='{"accessToken":"...","refreshToken":"...","expiresAt":"..."}' \
  claude --bare -p "task prompt" \
  --dangerously-skip-permissions \
  --output-format json \
  --model sonnet
```

**Flags explained:**
- `--bare` — skips local hooks, MCP configs, CLAUDE.md; clean for containers
- `-p "prompt"` — non-interactive print mode (like `codex exec`)
- `--dangerously-skip-permissions` — skip all file/command approvals (Docker IS the sandbox)
- `--output-format json` — structured JSON output with `{ result, session_id, usage }`
- `--model sonnet` — model selection (sonnet/opus/haiku); configurable via `CLAUDE_CODE_MODEL` env var

### CLI Dispatch Selection

Env var `CLI_DISPATCH_PROVIDER` controls which CLI runs build tasks:

| Value | Behavior |
|-------|----------|
| `"codex"` | Use Codex CLI (current default) |
| `"claude"` | Use Claude Code CLI |
| `"agentic"` | Use custom agentic loop (legacy fallback) |
| `"false"` | Same as `"agentic"` for backward compat |

Default: `"codex"` (preserves current behavior).

### Result Type

`ClaudeResult` matches `CodexResult` shape for orchestrator compatibility:

```typescript
export type ClaudeResult = {
  content: string;       // Claude's response text
  success: boolean;
  executedTools: Array<{ name: string; args: unknown; result: { success: boolean } }>;
  durationMs: number;
};
```

### Differences from Codex Dispatch

| Aspect | Codex | Claude Code |
|--------|-------|-------------|
| Auth injection | Write `~/.codex/auth.json` file in container | Pass `CLAUDE_CODE_OAUTH_TOKEN` env var on docker exec |
| Auth format | `{ auth_mode: "chatgptAuthTokens", tokens: {...} }` | `{ accessToken, refreshToken, expiresAt }` |
| CLI command | `codex exec --yolo --skip-git-repo-check` | `claude --bare -p --dangerously-skip-permissions` |
| Output | Raw text to stdout | JSON to stdout (`--output-format json`) |
| Stderr | Redirect to /dev/null (noisy banners) | TBD — test if `--bare` suppresses noise |
| Model | Omitted (ChatGPT assigns server-side) | `--model sonnet` (explicit, configurable) |
| Prompt input | Stdin from file (`< /tmp/prompt.txt`) | CLI argument (`-p "prompt"`) or piped |

### Dockerfile Changes

Add to `Dockerfile.sandbox`:

```dockerfile
# Claude Code CLI: Anthropic's coding agent.
# Used alongside Codex CLI for Build Studio task dispatch.
RUN npm install -g @anthropic-ai/claude-code
```

No config.toml needed — `--bare` and `--dangerously-skip-permissions` on the command line handle everything.

### Known Issues / Risks

1. **OAuth token expiry** — Tokens from `claude setup-token` last ~1 year. Tokens from interactive login expire in ~10-15 min and [refresh is buggy in non-interactive mode](https://github.com/anthropics/claude-code/issues/28827). Mitigation: use `setup-token` only.
2. **Prompt size** — CLI argument has shell limits. For large prompts, pipe via stdin: `echo "prompt" | claude --bare -p -`. Test which method works.
3. **JSON output parsing** — `--output-format json` includes metadata. Extract `.result` field for the content.
4. **Stderr noise** — Test if `--bare` mode suppresses progress output. If not, redirect `2>/dev/null` like Codex.

### Credential Store Setup

The Admin > AI Workforce page needs a "Claude Code" provider entry. The existing `anthropic` provider (for API calls) is separate — this is specifically for the CLI subscription token.

Provider config:
- `providerId`: `"claude-code"`
- `authMethod`: `"oauth2_authorization_code"` (or `"bearer"` — TBD based on existing patterns)
- `cachedToken`: the `sk-ant-oat01-...` access token
- `refreshToken`: the refresh token from `setup-token`
- `tokenExpiresAt`: expiry from the token JSON

## Testing

1. Install Claude Code in sandbox: `docker exec dpf-sandbox-1 npm install -g @anthropic-ai/claude-code`
2. Test auth: `docker exec -e CLAUDE_CODE_OAUTH_TOKEN='...' dpf-sandbox-1 claude --bare -p "say hello" --dangerously-skip-permissions --output-format json`
3. Test file access: `docker exec -e CLAUDE_CODE_OAUTH_TOKEN='...' dpf-sandbox-1 claude --bare -p "list files in /workspace" --dangerously-skip-permissions`
4. Test full dispatch through build orchestrator with `CLI_DISPATCH_PROVIDER=claude`

## Reference Files

- `apps/web/lib/integrate/codex-dispatch.ts` — **the template to mirror**
- `apps/web/lib/integrate/build-orchestrator.ts` — orchestrator (add provider toggle)
- `apps/web/lib/inference/ai-provider-internals.ts` — `getDecryptedCredential()`
- `apps/web/lib/govern/credential-crypto.ts` — encryption/decryption
- `Dockerfile.sandbox` — add Claude Code installation
- `apps/web/lib/integrate/task-dependency-graph.ts` — `AssignedTask`, `SpecialistRole` types

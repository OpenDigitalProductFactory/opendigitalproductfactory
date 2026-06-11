---
status: approved-pending-operator-review
backlogItem: BI-01D6A51B
epic: EP-BUILD-STUDIO
date: 2026-06-10
---

# Local-LLM Build Studio Dispatch — Design

## Problem

Build Studio dispatches coding tasks to vendor CLI agents (Claude Code, Codex, Grok) running inside the sandbox container. Every dispatch path requires a frontier API/OAuth credential. An early attempt at local-LLM building predates the current agent-runner substrate and failed on plumbing that now exists (OpenAI-compatible inference layer, `LLM_BASE_URL` override, agent-runner capability tiers, eval-gated promotion).

Goal: a fourth dispatch option powered entirely by a local model (Docker Model Runner / Ollama / vLLM — anything OpenAI-compatible), so an install can run builds:

- **air-gapped / credential-free** — no vendor account at all,
- **at zero marginal token cost**,
- **with data sovereignty** — code never leaves the host.

This is the Build Studio analog of the platform's existing local-AI inference story (EP-LOCAL-AI), not a replacement for frontier dispatch. Frontier CLIs remain the quality ceiling; local dispatch is the floor that makes the platform self-sufficient.

## Research & Benchmarking (2026-06-10)

### Why editors don't fit

The operator's candidate list included editor-shaped tools. Build Studio's dispatch contract is headless: prompt in via `docker exec`, commits/diffs out of `/workspace`, no human at a screen. That rules out:

- **Void** — AI-first VS Code fork; GUI-only, and the repo was archived 2026-06-02. Skip.
- **Zed** — GUI editor. Its **Agent Client Protocol (ACP)** (Apache-2.0, JSON-RPC over stdio, backed by Zed + JetBrains, registry live) is however exactly the shape of our dispatch pipe and is the standard to track for a future adapter abstraction. Cline and others already speak it.
- **Cursor** — closed-source, GUI; it is a comparison benchmark, not a candidate.

The correct comparison axis is **Claude Code CLI / Codex CLI vs open-source headless agents**.

### Headless open-source agents compared

| Agent | License | Headless mechanism | Local-model support | Fit for our sandbox |
|---|---|---|---|---|
| **OpenCode** (sst) | MIT | `opencode run "<prompt>"`; also headless HTTP server mode | Any OpenAI-compatible endpoint; 75+ providers | **Best** — npm-installable into `Dockerfile.sandbox` (node:24-alpine), same one-shot shape as `claude -p` / `codex exec`. ~170k stars; pin the version (fast release cadence). |
| **Aider** | Apache-2.0 | `aider --message "..."`; Python API; git auto-commit; `--test-cmd` self-fix loop | Any model via LiteLLM; first-class Ollama | **Strong second** — most deterministic diff/commit contract; structured-edit approach degrades most gracefully on small local models. Needs Python in the sandbox image. |
| **OpenHands** (ex-OpenDevin) | MIT | `openhands --headless -t` + `--json` event stream | LiteLLM; publishes local-model guidance (context ≥ 22k) | **Not a fit inside our sandbox** — it brings its own Docker runtime sandbox, which conflicts with our `BuildExecutionProvider` model. Would be a separate *execution provider*, not an agent runner. Strongest harness if we ever want that. |
| **Cline CLI 2.0** | Apache-2.0 | `cline -y "task"` (Feb 2026; purpose-built for CI) | BYOK incl. Ollama / OpenAI-compatible | Viable alternate; speaks ACP. |
| **Continue (`cn`)** | Apache-2.0 | `cn -p "prompt"` | First-class Ollama | Viable; output is final-response-oriented, less structured. |
| **Goose** (Block / Linux Foundation) | Apache-2.0 | `goose run -t` + YAML recipes | 15+ providers incl. Ollama | Viable; Rust single binary; strong MCP story. |
| **Qwen Code CLI** | Apache-2.0 | `qwen -p` | Any OpenAI-compatible baseUrl | Viable; tuned for Qwen3-Coder — pairs with our default local model family. |
| **Crush** (charmbracelet) | FSL-1.1-MIT | `crush run` | OpenAI-compatible | **Rejected** — FSL is not OSI open source. |
| **Gemini CLI** | Apache-2.0 | `gemini -p` | Limited | **Rejected** — Google stops serving it 2026-06-18. |
| **mini-SWE-agent** | MIT | batch runner, ~100 lines | LiteLLM / vLLM | Not a dispatch agent, but the right **eval harness** for benchmarking local models before tier promotion. |

### How local stacks stack up vs Claude / Codex / Cursor

- **SWE-bench Verified, June 2026:** best open-weight giants (DeepSeek-V4-Pro, MiniMax M3, Qwen3.7-Max) ≈ 80%; Claude Opus 4.8 ≈ 88.6%, current frontier ≈ 95%. The **consumer-hardware local tier (30B-class)** is ~35–55% — usable for contained tasks, not hard multi-file refactors.
- **Recommended local model floor:** Qwen3-Coder-30B-A3B-class MoE (3.3B active params, ~17–22 GB at Q4 — one RTX 4090/5090 or 32 GB Mac). Devstral Small 2 and Qwen3.6-35B-A3B are peers. Installer already defaults to the qwen3 family (PR #1047).
- **Context is the hidden constraint:** real agent runs consume 39k–156k tokens; anything under ~22k context fails outright. The runner must assert/configure context length, not assume it.
- **Industry pattern (2026):** route the easy 60–80% of agent traffic to local/open models, escalate the hard remainder to frontier APIs. Maps directly onto our capability-tier doctrine: local runner enters at `preview`, earns `single-file-edit` → `multi-file-refactor` via eval evidence — never by assertion.

Patterns adopted: one-shot CLI dispatch shape (Claude/Codex parity), OpenAI-compatible endpoint as the only model contract, version-pinned binary in the sandbox image, eval-gated tier promotion. Patterns rejected: embedding an editor, agent-owned sandboxes (OpenHands), license-encumbered tools (Crush), static model catalogs (discovery comes from the provider's `/v1/models`).

## Design

### Decision: OpenCode runner first, `dpf-native` as the governed end-state

**Naming:** the agent id is **`opencode`**, not `local`. Every existing `BuildAgentId` names the agent (`claude`, `codex`, `grok`, `dpf-native`), and locality is already carried by `honorsLlmBaseUrl` + the resolved provider row. Naming the id by locality would leave no id-space for the contemplated second local engine (Aider, Phase 4 of the plan). "Local model" remains the user-facing label in the admin UI; `opencode` is the substrate id everywhere (`BuildAgentId`, `cliEngine`, dispatch `provider` union, env overrides).

Two complementary paths, not competitors:

1. **`opencode` agent runner (this spec):** install **OpenCode (pinned)** into `Dockerfile.sandbox` beside the Claude/Codex/Grok CLIs. It is a thin adapter behind the existing `BuildAgentRunner` contract (AGENTS.md §17: thin adapters behind a stable contract). The agent loop runs *inside the sandbox*, like the other vendor CLIs, but inference goes to the install's own endpoint — no credential, no egress.
2. **`dpf-native` runner (already landed, Phase-1):** the portal-side governed loop with `honorsLlmBaseUrl: true` already unlocks local inference with full `ToolExecution` audit. It stays the strategic path for untrusted-substrate and fully-audited builds; this spec does not change it. When `dpf-native` reaches multi-turn parity, the two options coexist in the dispatch config like Claude and Codex do today.

### Integration points (all substrate exists)

| Surface | File | Change |
|---|---|---|
| Agent id | `apps/web/lib/integrate/sandbox/agent-runner-types.ts` | `BuildAgentId` += `"opencode"` |
| Runner | `apps/web/lib/integrate/sandbox/agents/opencode-agent-runner.ts` (new) | `prepare()` takes no credential; it writes the OpenCode provider config (resolved endpoint + model) into the sandbox and curl-preflights the endpoint *from inside the container*; `run()` execs `opencode run` in `/workspace` with `OPENAI_BASE_URL`/`OPENAI_API_KEY=dpf-local` env; `capabilities()` → `tier: "preview"`, `requiresCredential: false`, `requiresPersistentSession: false`, `honorsLlmBaseUrl: true` |
| Registry | `apps/web/lib/integrate/sandbox/agents/index.ts` | register runner |
| Dispatch config | `apps/web/lib/integrate/build-studio-config.ts` | `provider` union += `"opencode"`; `opencodeProviderId` / `opencodeModel` fields; auto-detect via `findConfiguredProvider("opencode")`; env overrides `OPENCODE_PROVIDER_ID` / `OPENCODE_MODEL`; `CLI_DISPATCH_PROVIDER=opencode`. **Auto-detect order: claude → codex → grok → opencode → agentic** — a credential-free install with a healthy local provider auto-selects the multi-turn local runner over single-turn `dpf-native` (zero-click-provider-setup); frontier CLIs still win when configured. |
| Endpoint resolution | reuse `getOllamaBaseUrl()` (`apps/web/lib/inference/ollama-url.ts`) | honors `LLM_BASE_URL` → `OLLAMA_INTERNAL_URL` → provider row → Docker Model Runner default. Sandbox-reachable URL must be rewritten host-relative (e.g. `host.docker.internal`) — the sandbox container is not on the model-runner network by default — and must carry the `/v1` path the OpenAI-compatible surface is served under. |
| Orchestrator | `apps/web/lib/integrate/build-orchestrator.ts` | include `"opencode"` in the CLI-dispatch branch |
| Sandbox image | `Dockerfile.sandbox` | `npm install -g opencode-ai@<pinned>`; no auth file needed. The image is **Alpine/musl** and the npm package fetches a platform binary — apply the grok lesson already encoded in this Dockerfile: two loud build-time gates, `opencode --version` as root **and** as the `node` user, so a musl-incompatible or root-homed binary fails the image build instead of failing silently at dispatch. |
| Provider seed | `packages/db/src/seed.ts` | local provider row gains `cliEngine: "opencode"` (fix the seed, not the runtime). Same PR updates the stale `cliEngine` comment in `schema.prisma` (currently lists only `"claude" \| "codex"` — `"grok"` is already missing) so the implied enum registry stays single-source. |
| Admin UI | Build Studio dispatch config surface | add "Local model (OpenCode)" option; show resolved endpoint + model **with an inline endpoint health/context preflight result** (operator sees "unreachable" or "context < floor" at config time, not first at dispatch); surface the preview-tier banner and a "no credential required" note |

### Capability tier & promotion (governance)

The runner is admitted at `tier: "preview"` per the existing onboarding doctrine in `agent-runner-types.ts`. Promotion to `single-file-edit` and beyond requires eval evidence on the install's actual local model — produced by running the same task-level verification (typecheck + tests + outcome classification) that gates every dispatch, optionally benchmarked offline with mini-SWE-agent. Governance approves evidence, not provenance: a local-model build that passes the gates ships like any other.

### Outcome classification & guardrails

- `classifyOutcome()` already maps CLI output to `DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT`; weak local models will land in `NEEDS_CONTEXT`/`BLOCKED` more often — that is the desired honest signal, not a failure of the integration.
- Context-length preflight: before dispatch, the runner queries the provider's `/v1/models` (or provider row metadata) and refuses dispatch with a clear `BLOCKED` message if the serving context is below the floor. The floor is a named, env-overridable constant (`OPENCODE_MIN_CONTEXT_TOKENS`, default `22_000` — source: OpenHands local-model guidance + observed 39k–156k real-run consumption above), not a magic number in the runner.
- Timeout: local inference is slower; default task timeout rises to 30 min for the `opencode` runner (configurable), with `onProgress` heartbeats from the CLI's streamed output so the orchestrator's stall detection doesn't false-positive.
- Trust posture (explicit, not accidental): `honorsLlmBaseUrl: true` means `assertAgentProviderCompatibility` admits this runner on `untrusted-ok` execution providers — intentional, because there is no vendor credential to leak and inference goes to the install-controlled endpoint. The caveat is reachability, not secrecy: the host-relative endpoint rewrite assumes host-local substrate, so the in-container preflight curl in `prepare()` is the guard that fails fast on remote/untrusted providers where the endpoint can't resolve.
- Tool-evaluation pipeline (AGENTS.md §9): OpenCode enters `packages/db/data/approved_tools_registry.json` version-pinned via `/project:tool-evaluation` before the Dockerfile change merges.

## Out of scope

- Replacing or modifying the `dpf-native` runner (parallel effort, EP-ROUTING-11 / Build-Engine work).
- OpenHands as an alternative *execution provider* (would be a new `BuildExecutionProviderId`, file under EP-2D477458 if ever wanted).
- Automatic frontier-escalation routing (local first, escalate on failure) — natural Phase 3 once the local runner has eval history; noted for EP-COST-001.
- ACP adapter abstraction — track the standard; adopt when a second ACP-speaking agent is wanted.

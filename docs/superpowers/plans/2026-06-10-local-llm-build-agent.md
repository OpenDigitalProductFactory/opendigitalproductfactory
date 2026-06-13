---
status: ready
backlogItem: BI-01D6A51B
epic: EP-BUILD-STUDIO
spec: docs/superpowers/specs/2026-06-10-local-llm-build-agent-design.md
date: 2026-06-10
---

# Local-LLM Build Studio Dispatch — Implementation Plan

Phased so each phase lands as one PR with its own gates. Spec holds the rationale; this file holds the order of operations.

## Phase 0 — Tool admission (no code)

1. Run `/project:tool-evaluation` on **OpenCode** (`opencode-ai` npm package): security, license (MIT), architecture fit, integration. Record the pinned version in `packages/db/data/approved_tools_registry.json`.
2. Verify the chosen pin's `opencode run` non-interactive behavior and env contract (`OPENAI_BASE_URL`-style provider config) against its docs for that tag — release cadence is fast; do not trust latest-docs for a pinned binary. Also confirm the pin runs on Alpine/musl as a non-root user (the grok failure mode).

Exit: tool registry row merged; exact CLI invocation + env contract documented in the registry entry.

**Status: done** (conditional admission). OpenCode pinned to **1.17.4**; registry row added (status `conditional`, MIT, sandbox-only/local-endpoint-only/version-pinned conditions; formal EP-GOVERN-002 multi-agent run noted to upgrade to `approved`). CLI contract verified live on node:24-alpine: `opencode run` flags `--dir` / `-m provider/model` / `--format json` / `--dangerously-skip-permissions` all present; install + version gate pass as root and the node user.

## Phase 1 — Runner + config (the core slice)

1. `agent-runner-types.ts`: add `"opencode"` to `BuildAgentId` (id names the agent, not the locality — see spec Decision section).
2. New `apps/web/lib/integrate/sandbox/agents/opencode-agent-runner.ts`:
   - `prepare()`: no credential; write OpenCode provider config into the sandbox (`docker exec` a JSON/TOML config naming the local endpoint + model) so the run command is bare; preflight `curl` of the endpoint from inside the container.
   - `run()`: resolve endpoint via `getOllamaBaseUrl()` + sandbox-reachable rewrite (`host.docker.internal` mapping, `/v1` path); context-length preflight against `/v1/models` (refuse below `OPENCODE_MIN_CONTEXT_TOKENS`, default 22k, with a BLOCKED-classifiable message); exec `cd /workspace && opencode run ... < prompt` with 30-min default timeout and streamed `onProgress` heartbeats; return `AgentRunResult`.
   - `capabilities()`: `tier: "preview"`, `requiresCredential: false`, `requiresPersistentSession: false`, `honorsLlmBaseUrl: true`.
3. Register in `agents/index.ts`.
4. `build-studio-config.ts`: `provider` union += `"opencode"`; `opencodeProviderId`/`opencodeModel` fields + DEFAULTS; auto-detect via `findConfiguredProvider("opencode")` — order claude → codex → grok → opencode → agentic, so a credential-free install with a healthy local provider lands on the multi-turn local runner before single-turn `dpf-native`; env overrides `OPENCODE_PROVIDER_ID`, `OPENCODE_MODEL`, `CLI_DISPATCH_PROVIDER=opencode`.
5. `build-orchestrator.ts`: include `"opencode"` in the CLI-dispatch branch with providerId/model plumbed from config.
6. Seed: local provider row (`ollama` / Docker Model Runner) gains `cliEngine: "opencode"` in `packages/db/src/seed.ts` — seed-on-upgrade safe, no migration (column exists). Same PR refreshes the stale `cliEngine` comment in `schema.prisma` (lists only claude/codex today).
7. Unit tests: config auto-detect/env-override matrix; runner outcome classification on canned CLI outputs; context-preflight refusal.

Exit: `pnpm --filter web exec vitest run` green on new tests; `pnpm --filter web typecheck` green. (Source-local gates in worktree; runtime gates Phase 3.)

**Status: Phase 1 landed** (feat/opencode-build-agent). `opencode` BuildAgentId + `opencode-agent-runner` + `opencode-dispatch` (portal-side endpoint preflight, sandbox URL rewrite, `opencode.json` provider config, `opencode run --format json` exec, event/result parsing), dispatch-config `provider:"opencode"` with none-auth-aware auto-detect (claude→codex→grok→opencode→agentic) + env overrides, orchestrator wiring, `cliEngine:"opencode"` seed on the `local`+`ollama` providers, schema comment refresh. 28 new unit tests; full integrate/sandbox suite green (250 tests); typecheck clean. Runtime unverified (Phase 3).

**Research finding folded into Phase 1:** `/v1/models` returns reachability + model presence but **not** context length for most OpenAI-compatible servers, so the hard preflight is endpoint-reachable + requested-model-present; the ≥`OPENCODE_MIN_CONTEXT_TOKENS` (22k) floor is enforced only when the endpoint reports a context field, otherwise it's a documented model requirement (see spec).

## Phase 2 — Sandbox image + admin UI

1. `Dockerfile.sandbox`: install the **pinned** OpenCode binary. **Research finding (opencode issue #9571):** `npm install -g opencode-ai` does NOT detect musl — on the `node:24-alpine` base it fails or links the wrong binary (the grok failure mode, worse). Do **not** change the base image (blast-radius for codex/claude/grok). **Done (Phase 2a, verified live):** fetch the pinned `opencode-linux-x64-baseline-musl.tar.gz` release tarball directly into `/usr/local/bin` (baseline = no AVX2 assumption, for arbitrary operator hardware), gate with `opencode --version` as root **and** the `node` user, and pre-seed `@ai-sdk/openai-compatible` into `/home/node/.cache/opencode/packages/...` (OpenCode's per-package cache short-circuits when that path exists → air-gapped first run). The npm platform package (`opencode-linux-x64-musl`) ships no `bin`, so the tarball is the clean path. A throwaway `docker build` confirmed all three previously-unconfirmed items (asset runs on musl with only libstdc++/libgcc; `--version` exits 0; provider seed lands). The full Build-Studio sandbox image rebuild is part of the governed image pipeline, not this worktree.
2. Admin Build Studio dispatch config UI: add "Local model (OpenCode)" option with resolved endpoint + model display, an inline endpoint health/context preflight result (config-time, not first at dispatch), preview-tier banner, and a "no credential required" note. Theme tokens per AGENTS.md §12.
3. Docs: update the Build Studio operator docs' dispatch-provider section (document at ship).

Exit: sandbox image builds; UI renders all four options; typecheck/build green.

## Phase 3 — Functional verification (the gate that counts)

Structural verification is not functional. On the canonical install (or local-CI convergence sandbox lease):

1. Configure dispatch `provider=opencode` with the install's default qwen3-family model; confirm the endpoint preflight passes (or honestly blocks if the pulled model's context is too small — then pull a ≥22k-context model and document the requirement).
2. Drive one real small Build Studio task end-to-end: promote a contained BI → Ideate → build dispatch → observe the local agent edit `/workspace`, run verification, classify outcome → review gate.
3. Record evidence via the Build Studio evidence tools (drove X, observed Y), naming the substrate.
4. Capture observed quality honestly: if the 30B-class model can't clear `single-file-edit`-grade tasks, that is the expected preview-tier result — file the eval summary, leave tier at `preview`.

Exit: one end-to-end local-model dispatch with recorded evidence; BI-01D6A51B status updated.

## Phase 4 (follow-on, separate BIs)

- **Aider as a second local engine** if OpenCode's free-form agency proves too weak on small models (aider's structured edits degrade more gracefully).
- **Frontier-escalation routing** (local first, escalate on BLOCKED/NEEDS_CONTEXT) — file under EP-COST-001.
- **Eval-driven tier promotion** runs: mini-SWE-agent harness against the install's model to justify `single-file-edit`.
- **ACP adapter abstraction** when a second ACP-speaking agent is adopted.

## Risks

- **Endpoint reachability from the sandbox container** is the most likely first failure (model-runner network vs sandbox network). Mitigation: explicit sandbox-reachable URL rewrite + a preflight `curl` from inside the container during `prepare()`.
- **Small-model quality**: managed by preview tier + honest outcome classification; never inflate.
- **OpenCode churn**: version pin + tool-registry re-evaluation cadence.

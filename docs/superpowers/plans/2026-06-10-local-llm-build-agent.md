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

## Phase 2 — Sandbox image + admin UI

1. `Dockerfile.sandbox`: `npm install -g opencode-ai@<pin>` (from Phase 0 registry row). No auth material added to the image. Apply the grok lesson already in this Dockerfile — the image is Alpine/musl and the npm package fetches a platform binary, so gate the image build loudly with `opencode --version` as root **and** as the `node` user.
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

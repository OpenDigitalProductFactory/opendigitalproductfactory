# EP-ANTIGRAVITY-001: First-Class Google Antigravity Support (External Coding Surface)

| Field | Value |
| ----- | ----- |
| Status | Draft — author draft for review |
| Date | 2026-07-17 |
| Epic | `EP-ANTIGRAVITY-001` (filed via governed MCP; in-progress) |
| Kernel decision | `DI-F8A78E41B01D` — `principle_decide` recommended **evidence-gated thin-slice** (composite 11.24, margin 4.72, high confidence, no commandment conflict) over full-parity-now (6.51) and defer/keep-ad-hoc (2.85). |
| Precedent | [EP-GROK-001 first-class Grok support](2026-05-31-grok-first-class-support-design.md) — the established playbook for onboarding a new external coding surface. Antigravity mirrors it. |
| Dry-run evidence | Operator manually ran Antigravity against **BI-F4156099**; it delivered **PR #3155** (`36f40c903`, `feat(decision-perspective): unify gate execution logic under evaluatePerspectiveGate`) — a 506/499-line gate-unification refactor **with test coverage**, merged clean to main. Code quality: properly typed, fail-closed error handling, reused existing helpers (`getErrorMessage`), matched house JSDoc conventions. This is a genuine "good enough" signal, not a toy. |
| Scope (Phase 0) | Antigravity as a **fifth external host-worktree coding surface**, peer to Claude Code / Codex / Grok: a governed `antigravity-desktop` WorkCapsule executor kind, `antigravity` MCP token-snippet + skill-pack packaging, and one **proven** governed `agy --headless` build recording capsule evidence. |
| Out of scope (behind the evidence gate) | Antigravity as a **Build Studio in-sandbox dispatch engine** (the `claude\|codex\|grok\|opencode\|agentic` axis) — the larger ~19-seam bet, deferred to `BI-D2E3F2FD`. Antigravity-specific inference-provider entry, custom Gemini fine-tunes as platform models, in-portal Antigravity coworker personality. |

---

## Architect Verdict

The platform has **two parallel axes** for coding agents, and conflating them is the primary scoping risk:

1. **External host-worktree executor axis** — Claude Code / Codex / Grok run in a host git worktree and record evidence back through MCP as `*-desktop` executor kinds. This is where `agy --headless` naturally belongs.
2. **Build Studio in-sandbox dispatch engine axis** — the CLI engine that runs a build inside the shared BS sandbox (`claude | codex | grok | opencode | agentic`). This is where **opencode** lives (the operator's roster "codex, claude, grok, and opencode" mixes the two axes: opencode is an *engine*, not a host CLI).

Antigravity is fundamentally axis-1: Google's agentic IDE ships a headless CLI (`agy --headless --approve <policy>`, the successor to the retired Gemini CLI) with **native MCP-server support** and is **model-agnostic** (Gemini 3.x Pro/Flash, Claude Sonnet/Opus, GPT-OSS 120B). It connects to the DPF MCP the same way the incumbents do. The BS-engine role (axis-2) is a second, larger bet — deliberately deferred.

The trust decision is **already precedented**: Claude/Codex/Grok already route code + backlog context to Anthropic/OpenAI/xAI. Antigravity → Google is the same *class* of trust boundary the platform has already accepted three times. What is new is Antigravity's **hook/packaging plane**: Grok reads Claude-format hooks natively and Codex aliases `CLAUDE_PLUGIN_ROOT`, but Antigravity is VS Code / Windsurf-derived with its own AI-Rules / MCP-config model, so governance-hook enforcement (`lease-guard`, `worktree-create`, `decision-routing`) may **not** transfer for free. That single unknown is what the evidence gate exists to resolve.

**Recommendation:** parity-first on the external-executor axis (cheap, precedented), gated by one proven end-to-end `agy` build, then reassess axis-2.

---

## Tool-Evaluation Verdict (CoSAI lens)

**Verdict:** CONDITIONAL · **Risk:** low-medium · **Confidence:** 0.8

Antigravity is not a bundled dependency imported into our tree — it is an external coding-agent *product* that operates *on* our tree and connects *to* our MCP. The risk surface is therefore the same shape as the already-approved Claude/Codex/Grok external surfaces, evaluated here per the 12-category checklist:

| # | Category | Finding | Severity |
|---|----------|---------|----------|
| 1 | Authentication | MCP connects via `DPF_MCP_BEARER_TOKEN` env var (same governed token flow as incumbents); Antigravity's own auth is Google account. No hardcoded creds. | none |
| 2 | Access Control | Scoped MCP token; least-privilege via existing tool grants. Host-worktree isolation. | none |
| 3 | Input Validation | Reuses the existing MCP JSON-RPC transport + arg coercion; no new input surface. | none |
| 4 | Data/Control Boundary | Agent has worktree write + MCP tool access — identical to incumbents. Prompt-injection posture unchanged. | low |
| 5 | Data Protection | Code + backlog context flows to Google models. Google states code is **used to provide the service, not to train models**; enterprise runs in-cloud-boundary. Same *class* as Anthropic/OpenAI/xAI already accepted. Verify against org data-handling stance (WWWD) before enabling on customer-identifying repos — see [[oss-repo-identity-leak-guard]]. | medium |
| 6 | Integrity Controls | All output lands via DCO-signed PR through CI gates (§4 all-changes-land-via-pr). Provenance-agnostic gates apply. | none |
| 7 | Session/Transport | HTTP MCP transport, `127.0.0.1` local; TLS for remote installs. | none |
| 8 | Network Isolation | Host worktree + isolated `COMPOSE_PROJECT_NAME`; sandbox `--approve` policy recommended for `agy`. | low |
| 9 | Trust Boundary | LLM judgment gated by the same evidence lifecycle + HITL phase boundaries as every surface. | low |
| 10 | Resource Management | `agy --headless` runs under the operator's account/quota; no shared-runtime contention on axis-1 (own worktree, not BS sandbox). | none |
| 11 | Operational Security | Capsule attribution (`antigravity-desktop`) + evidence records make its work auditable in the unified tracking view. | none |
| 12 | Supply Chain | We do **not** import Antigravity code; it's an external tool. Maintainer = Google (active, well-resourced). No dependency-tree exposure. | none |

**Early-termination check:** no hardcoded creds, no unpatched critical CVE, license compatible (we bundle nothing), tool actively maintained. **Proceed.**

**Conditions (why CONDITIONAL, not APPROVE):** (a) resolve the hook/packaging-plane unknown via the evidence gate before automating bootstrap; (b) confirm the data-handling posture against the org WWWD stance before enabling on customer-identifying repos; (c) sandbox the `agy --approve` policy.

---

## Current-State Seam Map (verified against `origin/main`)

> The MCP layer was refactored on main (`mcp-tools.ts` split into `mcp/packs/*` + `mcp-handlers/*`); the seam map below reflects **actual main**, not the pre-refactor layout.

### Axis 1 — External executor (Phase 0, this epic)
- `apps/web/lib/work-capsules.ts:70` — `WORK_CAPSULE_EXECUTOR_KINDS` (source of truth). The `create_work_capsule` / `adopt_worktree` MCP `executorKind` enum derives from it via `executors: [...WORK_CAPSULE_EXECUTOR_KINDS]` in `apps/web/lib/work-capsules/mcp-handlers.ts:62`, and `work-capsules-enum-parity.test.ts` enforces the mirror — so **one const edit propagates to the MCP enum and the parity test for free**.
- `apps/web/lib/work-capsules/work-capsule-store.ts:118` — `isExternalLeaseExecutor` (add the new kind so host-worktree Antigravity gets an external lease).
- `apps/web/lib/work-capsules/external-session-capture.ts:22` — `providerToExecutorKind` (add an `antigravity` branch).
- `record_external_development_evidence.provider` is **free-text** — Antigravity evidence "just works"; only the executor kind is a closed enum.
- **Finding:** the nonprod `NonprodOwnerProvider` enum (`environment-lease.ts:5`, `local-integration.ts:6`) is `build-studio | claude | codex | coworker` — **grok is not in it either**. External host-worktree CLIs do not flow through that enum (they run in their own worktree, not the shared nonprod env), so Antigravity does **not** need adding there. This corrected an early over-scoping assumption.

### Axis 2 — Build Studio in-sandbox engine (DEFERRED, `BI-D2E3F2FD`)
Only after a green evidence gate. ~19 seams incl. a **new runner file** `apps/web/lib/integrate/sandbox/agents/antigravity-agent-runner.ts` + `BuildAgentId` union (`agent-runner-types.ts:9`) + runner map (`agents/index.ts`); `packages/db/data/build-engines.json` install recipe + `providers-registry.json` `cliEngine` entry; the field-per-engine dispatch config (`build-studio-config.ts:13`, widens ~8 files); `phase-model-resolution.ts` `buildEngineLabel`; `build-orchestrator.ts` dispatch + preflight (note: preflight already omits `opencode` — avoid replicating that gap); UI radios (`BuildStudioConfigForm.tsx`, `build-studio/page.tsx`). This is the larger, riskier bet — kept gated.

---

## Phase 0 — Delivered in this PR (external-executor scaffolding)

1. `antigravity-desktop` executor kind + all consumers (`isExternalLeaseExecutor`, `providerToExecutorKind`, enum-parity test, `work-capsules.test.ts` assertion).
2. `antigravity` MCP token-snippet format (`mcp-setup-snippets.ts` + `issue-mcp-token.ts --format antigravity`) — emits a JSON `mcpServers.dpf` block (http, env-backed auth), with the exact config path flagged for evidence-gate confirmation.
3. Skill-pack packaging: `.antigravity-plugin/plugin.json` + `antigravity.mcp.json`, mirroring `.grok-plugin/`. Hook consumption flagged pending.
4. Snippet unit test for the antigravity shape (no embedded secret).

**Not yet automated (gated):** `update_agent_toolchain.py` / `dpf-bootstrap` detection + wiring for a host Antigravity CLI. Deferred until the evidence gate confirms the exact MCP-config path and whether Claude-format hooks fire on the Antigravity surface (`BI-ECAE3494`, `BI-47A81FEB`).

---

## The Evidence Gate (`BI-47A81FEB`) — kernel-mandated (Human-in-the-Loop at Phase Boundaries)

After this PR lands, the operator runs Antigravity (`agy --headless --approve <policy>`, inside a sandboxed worktree) on **one** real backlog item, wired to the DPF MCP via `--format antigravity`. **Green** requires:
- (a) Antigravity connects to the DPF MCP and calls `claim_backlog_item_for_work` + `create_work_capsule` / `adopt_worktree`;
- (b) it records external evidence attributed to `antigravity-desktop`;
- (c) it ships a DCO-signed PR that passes CI;
- (d) we capture the hook/packaging-plane reality — does governance-hook enforcement fire? which config path/format? which `--approve` policy is safe?

**Only a green gate opens Axis 2** (`BI-D2E3F2FD`). A red/partial gate → file findings and stop; do not force the BS-engine axis.

---

## Backlog (filed under EP-ANTIGRAVITY-001)

| BI | Title | Axis / Phase |
|----|-------|--------------|
| `BI-D49C4746` | `antigravity-desktop` executor kind + consumers | Axis 1 · Phase 0 |
| `BI-FA5F49C6` | MCP provider enums — **done** (delivered by Antigravity, PR #3223): unified `NONPROD_OWNER_PROVIDERS` as a single source of truth + added antigravity. The earlier "no change needed" seam read was wrong — it missed that `local-integration.ts` was inconsistent with the lease pack. | Axis 1 · Phase 0 |
| `BI-EF0489B8` | `antigravity` token-snippet + confirm config shape | Axis 1 · Phase 0 |
| `BI-ECAE3494` | `.antigravity-plugin` packaging + bootstrap wiring + onboarding doc | Axis 1 · Phase 0/1 |
| `BI-47A81FEB` | **EVIDENCE GATE** — prove one governed `agy --headless` build | Gate |
| `BI-D2E3F2FD` | Antigravity as BS in-sandbox dispatch engine | Axis 2 · **deferred** |

---

## Current status (updated 2026-07-17)

**Axis 1 — external host-worktree CLI: SHIPPED and PROVEN.** Phase-0 scaffolding merged (PR #3187); opt-in `agy` install + toolchain recognition merged (PR #3193); onboarding runbook `docs/operations/antigravity-cli-onboarding.md` (PR #3216). Capability is proven, not hypothetical: Antigravity autonomously selected real backlog items and delivered **merged** PRs — #3155 and #3223. The reliable MCP wiring is to **ask agy to add the `dpf` server itself** (it writes to whatever config it reads), with a per-thread presence check as the guard.

**Evidence gate (`BI-47A81FEB`): closed GREEN on capability, with one operational caveat.** agy connects to the DPF MCP and ships DCO PRs through CI. It does **not** auto-run the governed claim/evidence flow (no `antigravity-desktop` capsule was recorded) because the DPF skills/hooks don't auto-load on the agy surface — so until that hook/skill plane is wired, agy must be **prompted explicitly** to `claim_backlog_item_for_work` + record evidence.

**Axis 2 — Build Studio in-sandbox engine: DEFERRED, blocked by two independent walls (`BI-D2E3F2FD`).** A live sandbox spike (kernel `DI-A6A8DC5A48C3`) plus web research established:
1. **libc:** `agy` is glibc-only (requires glibc ≥ 2.28); the sandbox is Alpine/musl (`Dockerfile.sandbox: FROM node:24-alpine`). The glibc binary won't run on musl (`Error relocating: __read/__open/__lseek`), gcompat doesn't bridge it, and Google publishes **no** musl builds (`linux_*_musl` → 404). Not host-specific — it's the Alpine base, identical on every host; Mac only changes arch (arm64 vs amd64), and both lack musl builds.
2. **headless-container auth (decisive, Google-side, open):** [`antigravity-cli` #479](https://github.com/google-antigravity/antigravity-cli/issues/479) — in headless containers agy writes its OAuth token but a re-invoked process can't read it back, re-triggering login every time; `GEMINI_API_KEY`/Vertex/ADC are also ignored. **Reproduced on Debian 12 (glibc)** — so switching our sandbox base to glibc would only reach this second wall. Build Studio re-invokes the engine per phase, which is exactly what #479 breaks.

Consequence: a sandbox base-image change is **not** worth doing for Antigravity — it spends real blast radius (image size, full rebuild + revalidate all engines) and still stalls at blocker 2, which is outside our control. **Revisit trigger (both, Google-side + observable):** Google fixes #479, **and** ships musl builds (or a glibc base is separately justified). Until then Axis 2 is a **watch-item**, not a build-item. Antigravity's home is the host-CLI surface.

---

**Author note:** Parity-first on the cheap precedented axis, one proof before the expensive axis. Kernel principles invoked: `never-adopt-an-unvetted-external-tool`, `least-privilege-deny-by-default`, `never-assume-verify`, `human-in-the-loop-at-phase-boundaries`, `architecture-over-shortcuts`, `all-changes-land-via-pr`.

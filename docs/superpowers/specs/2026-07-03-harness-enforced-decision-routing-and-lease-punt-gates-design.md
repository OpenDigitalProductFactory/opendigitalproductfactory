# Harness-Enforced Decision-Routing & Lease-Punt Gates

**Date:** 2026-07-03
**Status:** Design input (advisory — not yet a plan)
**Author:** Investigation prompted by an operator-observed session anti-pattern (a Claude Code dev thread that asked the human to choose, and separately punted its runtime gates)
**Related:** BI-383668B9 (decision-routing enforcement), BI-2D167283 (lease-punt guard), EP-5560770F (Development Process Spine — distribute & enforce discipline across surfaces), BI-1208AE5D (Spec/Plan/Doc Gate, the precedent), BI-3E71E016 (coworker-prompt decision-routing contract, sibling surface), BI-38578194 (uncommitted-work guard, sibling hook), [consult-scopes-before-asking principle](../../founder-kernel/wiki/principles/consult-scopes-before-asking.md), [worktree-is-source-control-not-runtime principle](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)

---

## 1. Executive summary

Two commandment-tier disciplines are enforced only in prose and skill guidance, so a working session can silently skip them. Both surfaced in one Claude Code dev thread:

1. **Decision-routing.** The thread presented the operator a numbered menu (spec-only vs spec+implementation, "Option 3 it is") for a platform/build decision **without first consulting the governed scope** (WWMD / `principle_decide`). The `consult-scopes-before-asking` principle is `principleTier: commandment`, but nothing in the Claude Code / external-coding-agent hook plane stops a human-choice prompt that lacks a kernel-consultation ledger.

2. **Lease-punt.** The same thread correctly discovered it had no `DATABASE_URL` in its source-only worktree and correctly hand-authored the migration — then **punted** the runtime-bound gates (migration-apply, `next build`, UX) as "unrun, must run on sandbox/CI" **without claiming `local-integration-ci`** and running them. The lease substrate is fully wired and operational; the workflow that uses it is unenforced.

**The root cause is identical to the one BI-1208AE5D (Spec/Plan/Doc Gate) already fixed for a different discipline: the rule lived at memory/skill altitude, not harness altitude.** This spec proposes two sibling guards on the same hook plane, plus one small rulebook classification edit.

**Finding: no new subsystem is needed.** Both the decision surface (`principle_decide`) and the runtime surface (`claim_nonprod_environment_lease`) exist and work. The gap is a pair of pre-action interceptors that make bypass loud instead of silent — exactly the shape of the existing `lease-guard` / `root-clone-guard` / `compose-guard` hooks in `packages/dpf-skill-pack/hooks/hooks.json`.

---

## 2. Evidence (both substrates are operational, not aspirational)

### 2.1 Decision-routing
| Fact | Source |
|---|---|
| `consult-scopes-before-asking` is commandment-tier: consult all governed scopes before asking a human; act on a high-confidence resolution, "Do not ask." | [docs/founder-kernel/wiki/principles/consult-scopes-before-asking.md](../../founder-kernel/wiki/principles/consult-scopes-before-asking.md) |
| WWMD is the platform-development decision surface; trigger pattern + operator-only carve-out | [packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md](../../../packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md); AGENTS.md §16 |
| The scorer is live and returns a ledger (this spec's own scoping decision was routed through it: recommended `file_bis_plus_spec`, composite 8.23, margin 0.74, high confidence, no commandment conflict) | `apps/web/lib/wiki/principle-decide.ts`; `mcp__dpf__principle_decide` |
| Hook plane has guards for leases/root-clone/compose but **none** for decision-routing | [packages/dpf-skill-pack/hooks/hooks.json](../../../packages/dpf-skill-pack/hooks/hooks.json) |

### 2.2 Lease-punt
| Fact | Source |
|---|---|
| Worktree = source control, not runtime; runtime-bound gates route through the shared lease | AGENTS.md §4/§5/§7; [worktree-is-source-control-not-runtime](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md) |
| Lease is atomic (`NonProductionEnvironmentLease.activeKey` unique), TTL-bounded, reaped; four MCP tools | `apps/web/lib/nonprod/environment-lease.ts`; `apps/web/lib/mcp-tools.ts` (~902-940) |
| Dev DBs exist behind the `dev` compose profile: `dev-postgres:5433`, `dev-init` runs `prisma migrate deploy` | `docker-compose.yml`; `scripts/local-integration-ci.mjs` |

---

## 3. Design

### 3.1 Gate A — decision-routing (BI-383668B9)

**Trigger.** An agent is about to present the human a choice among 2+ options on a platform/build decision. On the Claude Code surface the clearest chokepoint is an **`AskUserQuestion` / numbered-menu pre-check**; on the coworker surface the sibling is the prompt-path contract (BI-3E71E016).

**Rule.** Block (or warn-and-require-acknowledgement) unless one of:
- a `principle_decide` ledger for this decision exists in the session, and it returned **low confidence** (margin < tieMargin) or a **commandment-conflict** flag → escalation to the human is legitimate; or
- the decision is classified **operator-owned** (see §3.3) **and** a consultation was still run and deferred (consult-then-defer, per the commandment); or
- the human explicitly pre-authorized a direct question for this specific decision.

**Non-goal.** Not every clarifying question is a governed decision. The gate targets *option-selection on platform/build decisions*, not factual lookups ("which file did you mean?") or missing-input prompts.

### 3.2 Gate B — lease-punt (BI-2D167283)

**Trigger.** An agent is about to *report* a runtime-bound gate (migration-apply, `next build`, UX verification) as unrun/blocked from a source-only worktree.

**Rule.** Require one of:
- evidence of a `local-integration-ci` lease claim + gate output (the gate actually ran on the sandbox); or
- an **explicit recorded deferral** — a structured note (in the PR body / capsule) naming the gate, the reason it is deferred, and where it will run — never a silent "unrun."

Detection can key on the same signals the thread emitted ("no DATABASE_URL", "can't run prisma migrate dev", "runtime-bound", "unrun") combined with worktree context.

### 3.3 Rulebook classification edit (secondary, from Finding 1)

Work-scope decisions (spec-only vs spec+implementation, how much to implement in one pass) are currently **unclassified** — neither explicitly WWMD-owned nor operator-owned — which is the wiggle room the thread used. Add an explicit line to AGENTS.md §16 and a kernel principle note: **work-scope/altitude decisions are platform-owned (WWMD) and must be consulted**, and even where the kernel defers the final call to the operator, the consultation is mandatory first (consult-then-defer).

---

## 4. Why harness altitude (kernel-scored)

This scoping decision — how far to take the findings — was itself routed through `principle_decide` rather than handed to the operator (the operator explicitly flagged that asking *was* the anti-pattern). The kernel recommended filing both BIs **and** drafting this spec (composite 8.23 vs 7.49 for file-only, 3.89 rulebook-only, 0.97 understand-only; margin 0.74, high confidence, no commandment conflict). Top positive contributors: *every-defect-needs-reproduction-steps*, *never-fabricate*, *build-gate-mandatory*. The two (tiny) negative contributors were, fittingly, *"do the work; don't task the operator"* and *"consult the governed scopes before asking"* — the very principles this spec exists to enforce.

---

## 5. Open questions (candidates for `principle_decide` at plan time)

1. **Block vs warn** for Gate A — hard block risks false positives on legitimate operator-only questions; warn-and-acknowledge is softer but skippable. (Interface-surface / failure-opportunity trade-off — score, don't guess.)
2. **Where Gate A lives** — an `AskUserQuestion` interceptor is Claude-Code-specific; the durable home may be the unified client-hook plane (EP-CLIENT-HOOK-PLANE). Sequencing question, not a blocker.
3. **Ledger persistence** — does the decision ledger need to persist to a session artifact the guard can read, or is in-context evidence sufficient? Ties into BI-EF42607A (process-spine conformance).

---

## 6. Relationship to existing work

- **Precedent:** BI-1208AE5D (Spec/Plan/Doc Gate) proved the memory-level → harness-level enforcement pattern; this reuses it.
- **Sibling surface:** BI-3E71E016 fixes decision-routing on the *coworker prompt* path; Gate A is the *Claude Code / external-agent hook* path.
- **Sibling hook:** BI-38578194 (uncommitted-work guard) is the same class of pre-action guard.
- **Not a duplicate of** EP-056D2A5E (resource contention) — that epic governs concurrent *execution* races; this governs *discipline enforcement*.

---

## 7. Surface coverage map (which surfaces this enforces, and where the rest live)

"Harness-enforced" is only as wide as the plane the guard runs on. There are **two** hook planes, and this PR (BI-383668B9 / BI-2D167283) implements plane 1:

| Surface | "Decide / ask a human" mechanism | Runtime gate mechanism | Enforced by |
|---|---|---|---|
| **Claude Code** | `AskUserQuestion` tool | `Bash` (`prisma migrate`, `next build`) | **Gate A + Gate B (this PR)** — plane 1, `dpf-skill-pack/hooks/hooks.json`, auto-loaded |
| **Codex CLI** | interactive ask-tool (name ≠ AskUserQuestion) | `Bash` | **Gate B — CODE-COMPATIBLE, FAIL-OPEN BY DEFAULT (live-probed §11, BI-883FC2FC).** Deny fires verbatim (`tool_name:"Bash"` maps to Codex's shell tool; `permissionDecision:"deny"` honored) ONLY once Codex hook-trust is granted; ungranted by default → guard silently inert. Gate A matcher does **not** fire on its ask-tool → BI-B22DE548 |
| **Grok** | `AskQuestion` | `Shell` | **Gate A + B — LIVE (live-probed §11.1, BI-883FC2FC).** Grok DOES execute PreToolUse blocking command-hooks + honors deny; it just ignores plugin-bundled hooks, so the guards ship via `~/.grok/hooks/dpf-guards.json` (always-trusted) with envelope-portable scripts (`toolName`/`Shell`/`AskQuestion`, dual deny) + DPF-workspace scoping. §11's "contract gap" was disproven. |
| **In-portal coworker** | `needs-human` / HITL escalation queue | runs against a live DB (no worktree-punt case) | **plane 2** — server-side `onPreToolUse` in `apps/web/lib/mcp-governed-execute.ts`; prompt contract = BI-3E71E016 (open), hard gate = **BI-B22DE548** |
| **Build Studio (embedded)** | `needs-human` queue | live DB | plane 2 — **BI-B22DE548** |

**Plane 1** (this PR) = the CLI PreToolUse hook plane shared by Claude / Codex / Grok. Gate B (matcher `Bash`) covers every surface that can hit a source-only worktree with no `DATABASE_URL`; the embedded surfaces run against a real DB and structurally cannot punt, so they need no Gate B. Gate A (matcher `AskUserQuestion`) covers Claude Code — the primary interactive decision surface — fully.

**Plane 2** = the server-side governance hook (`onPreToolUse` → `{decision:"deny"}`) that fronts in-portal coworker and Build Studio tool calls, whose escalation is the `needs-human`/HITL queue rather than an `AskUserQuestion` tool. Per [2026-06-20-issue-report-surface-attendance-design.md §5.3](2026-06-20-issue-report-surface-attendance-design.md) ("the identical gate belongs in front of every AskUserQuestion / HITL surface"), the same consult-scopes check belongs there as a runtime pre-escalation guard. That work — plus resolving Codex/Grok's interactive ask-tool name — is **BI-B22DE548**, the plane-2 companion to this PR (hard gate) and to BI-3E71E016 (prompt contract). Together the three close the matrix.

## 8. Plane 2 — delivered (BI-B22DE548)

Implemented as `apps/web/lib/tak/decision-routing-governance-hook.ts`, registered at server startup (`instrumentation.ts` `register()`) via `registerToolLifecycleHook`. It rides the existing `onPreToolUse` / `onPostToolUse` governed-execution seam (the same one `work-case-governance-hook` uses), so it fronts every in-portal coworker / Build Studio tool call (`source: "agentic-loop"`).

- **What it gates.** A *consequential decision-action* — currently the narrow, unambiguous set `{triage_backlog_item, retire_backlog_item}` (deciding among defer / discard / duplicate / reorder outcomes) — taken with **no `principle_decide` consultation** earlier in the same session window. `onPostToolUse` records a successful `principle_decide` per `userId`; `onPreToolUse` clears the gate for `CONSULT_WINDOW_MS` (30 min). The natural bypass is "consult first".
- **Scope guards keep it off the wrong surfaces.** Only `source: "agentic-loop"` (external CLI = plane 1; direct REST/JSON-RPC = operator). Non-decision tools pass. Fails **open** on any error (the runner does not catch a throwing `onPreToolUse`).
- **Mode is operator-reversible without a redeploy.** `DPF_DECISION_GATE_MODE = enforce` (default) `| shadow` (audit-only, never denies) `| off`. An unconsulted consequential decision always emits a structured `[decision-routing-gate]` audit signal (except `off`), in both enforce and shadow.
- **Why enforce-by-default with a shadow escape.** The block-vs-shadow choice was routed through `principle_decide` (2026-07-04): `enforce_narrow` (6.171) ≈ `shadow_audit` (6.157), margin 0.015 / **low confidence** — a genuine judgment call — with `enforce_broad` clearly rejected (5.816). Shipping enforce-narrow *with* a shadow kill-switch delivers both tied options: real enforcement matching plane 1, instantly reversible if too aggressive.
- **Known limits / follow-ups.** The consultation ledger is per-process in-memory (fine for the single-portal deployment; a durable cross-process ledger + a DB-backed audit sink are follow-ups if multi-instance portals land). The narrow tool set is intentionally minimal for the first enforcing ship; widening is a tuning follow-up. Resolving Codex/Grok's interactive ask-tool name (so plane 1's Gate A matches there) remains open under BI-B22DE548's umbrella.

## 9. Post-incident addendum (2026-07-06): plane-1 delivery race — guards absent in fresh-worktree first sessions

Gate A was bypassed in the wild three days after it merged, and the failure was **delivery, not logic**. In session `e07d5d79` (auto-worktree `stoic-fermat-b18696`, BI-BFDCE0A9 work) the agent put a 4-option platform decision straight to the operator via `AskUserQuestion`; `decision-routing-guard.decide()` on the exact recorded payload returns `block:true`, and two `lease-punt`-deniable Bash commands in the same session also ran undenied. The plugin's **skills** were loaded (the session later invoked `dpf-decision-via-kernel`), but its **hooks** never registered: plugin hooks are registered once at session init, and in the *first* session of a freshly created auto-worktree the `dpf-platform` plugin install for the new projectPath completes during session bootstrap *after* hook registration (`installed_plugins.json` install stamp 10:19:07.7 vs first transcript record 10:19:09.5). Skills resolve dynamically per turn, so the plugin looks present while every plane-1 guard silently fails open — in exactly the session type the desktop client creates by default. A control probe the same day in a root-clone session confirmed both matchers fire when the plugin plane is registered.

**Fix (kernel-ratified: `settings_json_redundant_wiring`, composite 8.52, margin 1.59, high confidence, no commandment conflict).** The plane-1 PreToolUse guards are now wired on **both** planes: the plugin `hooks/hooks.json` (travels with the plugin to Codex/Grok and standalone installs) **and** the checked-in `.claude/settings.json` via `${CLAUDE_PROJECT_DIR}/packages/dpf-skill-pack/hooks/*.mjs` (loads from the checkout at session start; empirically immune to the race — the settings-plane transcript-snapshot hook fired in the failing session). Double-fire when both planes are live is benign for these guards (deny is idempotent; warn repeats context); `WorktreeCreate` is **not** idempotent and stays plugin-only. The former anti-duplication conformance test in `plugin-hooks-wired.test.mjs` is inverted into a both-planes-wired assertion. Residual: the registration race itself belongs upstream (register just-installed plugin hooks before the first turn).

## 10. Post-incident addendum (2026-07-06): the settings-plane fix is itself branch-versioned — SessionStart freshness self-check

§9's `.claude/settings.json` redundancy is race-immune but **branch-versioned**: it only protects branches that *contain* the commit that added it. A branch cut before it landed — observed on `feat/decision-gov-adjust-surfaces` (HEAD `bebeb339c`, 88 commits behind `main`, does not contain `1bda3d3fc`/#2660) — has a `.claude/settings.json` with no `PreToolUse` block at all, so on that branch the decision-routing gate is silently absent with **no signal** the operator or agent can see. Both governance mechanisms (§9's settings plane, and the plugin plane it backstops) depend on a freshness the operator cannot see: any branch cut before a governance hook shipped runs without it, silently.

**Fix (kernel-ratified: `warn_plus_activate_fallback`, `principle_decide` 2026-07-06 `DI-C805C5C50A47`, composite 7.92, margin 0.38, high confidence, no commandment conflict; vs `hard_gate_all` 7.54, `warn_only` 6.28).** A `SessionStart` hook — `packages/dpf-skill-pack/hooks/governance-freshness-check.mjs`, wired in `hooks/hooks.json` via `${CLAUDE_PLUGIN_ROOT}` so it lives in the **branch-independent plugin cache plane**, present regardless of how stale the checkout is — compares the working tree's `.claude/settings.json` PreToolUse guard wiring against `origin/main` (`git show origin/main:.claude/settings.json`, local refs, no network). When `origin/main` wires a governance guard (`decision-routing-guard`, `lease-punt-guard`) that the checkout lacks, it (1) **warns** loudly into session context naming the absent guard(s) and the rebase remediation, and (2) **activates a fallback** by merging that guard's PreToolUse wiring into the gitignored, worktree-local `.claude/settings.local.json` (idempotent). Because Claude Code registers hooks statically at session init *before* `SessionStart` runs (and `SessionStart` itself cannot block), the fallback restores settings-plane enforcement from the **next** session in that worktree — closing the durable hole for stale branches without ever blocking a tool. It stays silent on a fresh branch (guard already wired) and on any checkout it cannot compare (no `origin/main` — offline/detached), preserving the fail-open philosophy. In-portal coworker / Build Studio surfaces run server-side against `origin/main` and are structurally always-fresh, so they carry no client-session check. Residual (same as §9): the plugin-install/hook-registration race itself belongs upstream.

## 11. Post-verification addendum (2026-07-07): Codex/Grok guard liveness — LIVE-PROBED, not assumed (BI-883FC2FC)

§7 recorded Codex and Grok as "Gate B ✓" and BI-3260D977 recorded them "unaffected" by the Claude registration race — both **design-level only, never live-probed**. BI-883FC2FC ran real probes on this machine (Codex `codex-cli 0.142.5`, Grok `grok 0.2.87`). The verdict corrects the record on three axes.

**Load model — cache-versioned, NOT branch-versioned.** The §10 fear was that because the Codex/Grok plugin source is the in-tree checkout path, "their entire hook plane is branch-versioned" (the §10 failure mode). It is not. Both surfaces load the plugin from a **version-keyed cache copy**, not the working tree: Codex at `~/.codex/plugins/cache/dpf-platform-local/dpf-platform/<version>/` (a snapshot copy — verified holding the guard `.mjs` files), Grok via `~/.claude/plugins/cache/.../<version>/` discovery (grok debug: `plugin directory already discovered … skipping`). So they are **structurally immune to the §10 branch-staleness hole** the `governance-freshness-check.mjs` closes for Claude's settings plane — that Claude-shaped self-check (it compares `.claude/settings.json` and self-heals `.claude/settings.local.json`, files neither surface reads) does **not** transfer and is **not** needed. Their staleness axis is instead the cache copy lagging the repo, bounded by the version key — which is why this PR bumps `.codex-plugin`/`.grok-plugin` to `0.2.1` (matching `.claude-plugin`, ending a live version skew) to force the corrected content to re-sync.

**Codex — Gate B is code-compatible but FAIL-OPEN BY DEFAULT.** Probe 1 (`codex exec`, default): a lease-punt `prisma migrate` echo probe (thread `019f399e-06a0-7230-b0e1-9c0e52ae8a42`) **RAN** — no deny. Probe 2 (`--dangerously-bypass-hook-trust`, thread `019f399e-7a65-74f2-83ff-2eb51fdfb372`): the identical probe was **DENIED**, the guard's `permissionDecisionReason` emitted verbatim. So Codex maps its shell tool to the `Bash` matcher, passes `tool_input.command`, and honors `permissionDecision:"deny"` — the guard is fully compatible. It is inert only because **Codex gates every plugin hook behind content-hash "hook trust"** (`HookStateToml{trusted_hash}`; TUI prompt "…Continue without trusting (hooks won't run)"), and **no trust store exists on this machine** (`hooks.state` absent) — so by default the guards silently fail open, and any guard-content change re-locks trust until re-review. There is **no non-interactive trust API** (`codex plugin` has no trust subcommand; `--dangerously-bypass-hook-trust` is per-invocation). Remediation is the one-time TUI "Trust all and continue"; the installer now prints this caveat rather than implying enforcement. Classification: **guards-code-live / fail-open-until-trusted.** Follow-up: **BI-66EBEA06**.

**Grok — Gate B NOT live; two layered causes.** Probe (`grok -p`, session `019f39a1-ffb9-7310-bc02-58a6376d0226`): the same probe **RAN**. Root causes, both isolated with throwaway plugins: (1) **manifest path bug** — `.grok-plugin/plugin.json` shipped `../skills/ · ../hooks/hooks.json · ../grok.mcp.json`; Grok resolves component paths from the *package root* (the dir containing `.grok-plugin/`), so `../` escaped the package and Grok loaded **zero** components (`grok inspect`: `dpf-platform (user, enabled)  -`). A `./`-path throwaway loaded its hooks correctly. **Fixed in this PR** (`../`→`./`, plus a conformance test `surface-manifest-paths.test.mjs` asserting all three surface manifests are plugin-root-relative). (2) **harness contract gap** — even with hooks loaded, a captured-payload throwaway confirmed Grok does **not** invoke the Claude `${CLAUDE_PLUGIN_ROOT}` PreToolUse *blocking* command-hook (`x.ai/hooks` advertises `blockingEvents:["pre_tool_use"]` but not via this contract). So fix (1) restores **skill** loading and is necessary-but-not-sufficient for the runtime gate; full Grok Gate-B enforcement needs Grok-native blocking-hook support. Classification: **guards-dead (path bug fixed; blocking-hook contract residual).** Follow-up: **BI-3157516C**. Until then the DPF MCP connector (plane 2) is the enforcing path on Grok.

**Scope decision (kernel-ratified: `implement_toolchain_fixes_now`, `principle_decide` 2026-07-07 `DI-5846C7848762`, composite 8.280, margin 0.723, high confidence, no commandment conflict; vs `document_and_file_followups` 6.706, `build_liveness_verifier` 7.557).** Implement the restorative fixes now (Grok manifest correction + version-skew close + installer Grok-install and per-surface liveness advisory) rather than document-only, with the two harness-limited residuals filed as follow-ups above. In-portal coworker / Build Studio remain server-side always-fresh (plane 2, unaffected).
## 11.1 Correction (2026-07-07, later session): Grok Gate B/A is LIVE — §11 cause #2 was wrong (BI-883FC2FC)

§11 above classified Grok **guards-dead** with a residual "harness contract gap — Grok does not invoke the Claude `${CLAUDE_PLUGIN_ROOT}` PreToolUse *blocking* command-hook contract." A follow-up session **live-probed Grok 0.2.87 directly against its own docs and instrumentation** and that conclusion is **disproven**. This subsection supersedes §11's Grok paragraph (cause #2) and the Grok follow-up framing; §11 is retained as the historical record.

**What the live probe showed (Grok 0.2.87):**
- **Grok DOES execute PreToolUse blocking command-hooks and honors deny.** A guard wired via `~/.grok/hooks/` flipped hook discovery to `pre_tool=1` and **blocked** a `prisma migrate` hard-gate (`stopReason: Cancelled`, no output); the same command with no hook ran (`EndTurn`, exit 0). Grok's own `10-hooks.md` documents `PreToolUse` as the one blocking event, plugin-bundled hooks as a source, and `CLAUDE_PLUGIN_ROOT` as an injected alias.
- **The real root cause: Grok's hook-execution plane does not ingest plugin-bundled hooks.** `xai_grok_agent::plugins::discovery` reports the plugin `has_hooks=true`, but `xai_grok_hooks::discovery` loads **only** from `~/.grok/hooks`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.cursor/hooks.json` → `total_hooks=0`. The same is true of xAI's own `has_hooks=true` plugins. So `grok plugin install` surfaces skills but never the guards. The `../` manifest bug (§11 cause #1) was **not** the operative blocker — a perfect `./` manifest (`grok plugin validate` clean, installed+trusted) still yields `total_hooks=0`.
- **Second, independent bug: the guards spoke only Claude's I/O envelope.** Grok sends `toolName` (camelCase) = **`"Shell"`** and `toolInput.command`, and expects a top-level `{decision:"deny"}`; the guards read `tool_name`/`tool_input` (snake_case) and emitted `hookSpecificOutput` → read `undefined`, emitted a verdict Grok ignores → fail-open even when loaded. Operator-decisions surface as **`AskQuestion`**, not `AskUserQuestion`.

**Fix shipped in this PR (kernel-ratified delivery scope: `opt_global_context_gated`, `principle_decide` `DI-C17A5861CE0E`, composite 6.096, margin 1.339, high, no commandment conflict; vs `opt_project_scoped`, `opt_global_unscoped`):**
1. **Envelope portability** — a shared `hooks/lib/hook-io.mjs` normalizes input (`toolName`/`tool_name`, `Shell`/`run_terminal_command`/`Bash`, `AskQuestion`/`AskUserQuestion`) and emits a **dual deny envelope** (`{decision}` for Grok + `hookSpecificOutput` for Claude/Codex). All five blocking guards (lease-punt, decision-routing, lease, root-clone, compose) route through it — Claude/Codex unaffected (superset read).
2. **Delivery** — the installer writes a global `~/.grok/hooks/dpf-guards.json` (always-trusted; no folder-trust prompt) pointing at the managed guard copies, since Grok's plugin plane is a dead end for hooks.
3. **DPF-workspace scoping** — because the delivery is global, each guard first confirms the session `cwd` is inside a DPF checkout (`inDpfWorkspace`, `packages/dpf-skill-pack` marker) so DPF-branded denials never fire in unrelated repos.

**End-to-end verification (real refactored guards on real Grok 0.2.87):** in a DPF worktree cwd a `prisma migrate` hard-gate was **DENIED** (`stopReason: Cancelled`); in a bare non-DPF cwd the same command **RAN** (`EndTurn`, exit 0) — envelope portability + delivery + scoping all confirmed live. Classification: **Grok Gate B LIVE (Gate A wired for `AskQuestion`).** BI-3157516C is re-scoped from "upstream contract gap" to the in-house delivery+portability fix landed here. The DPF MCP connector (plane 2) remains a defence-in-depth backstop, no longer the sole enforcing path on Grok.

## 13. Addendum (2026-07-07): Codex hook-trust — deliver + block, do not forge (BI-66EBEA06)

Codex remains **fail-open until the operator grants hook trust** (§11). There is still no supported non-interactive trust API ([openai/codex#21615](https://github.com/openai/codex/issues/21615)); forging `[hooks.state.*] trusted_hash` entries is explicitly out of scope (version-specific, brittle).

**Fix:** the standalone installer (`update_agent_toolchain.py`) now (1) **merges** the five blocking plane-1 guards into `~/.codex/hooks.json` (Bash + AskUserQuestion matchers, preserving foreign hooks), (2) **detects** absent hook-trust state (`hooks.state` / `[hooks.state.*] trusted_hash` in `config.toml`), and (3) prints an **ACTION REQUIRED** block with the hook roster (BI-276EC984) plus optional exit code `2` when `--require-codex-hook-trust` or `DPF_REQUIRE_CODEX_HOOK_TRUST=1` is set. This converts the silent fail-open into a blocking install-time instruction — the acceptance path allowed when automation is impossible.

## 12. Addendum (2026-07-06) — match executable text, not quoted data

**Observed false positive:** Gate B's patterns ran against the raw Bash command
string, so quoted DATA that merely *mentioned* a gate command was denied like a
real invocation. Live case: a `curl` POST recording MCP evidence whose JSON
summary contained the words "prisma migrate deploy" was blocked — and the Bash
command writing the backlog item *about* the bug was blocked too, then the
sibling `lease-guard` blocked the command writing the regression-test files
because they mention "pnpm dev". Same class in both guards.

**Fix (shared helper `hooks/command-text.mjs`):** deny/block patterns now match
`executableCommandText(command)` — the command with single/double-quoted
segments and heredoc bodies removed, and with `sh|bash|zsh|dash -c '<payload>'`
payloads unquoted and re-appended (a `-c` payload IS a command; one recursion
level). `GOVERNED_MARKERS` deliberately still match the RAW text: they act in
the allow direction, so an over-match fails open, consistent with the guards'
never-wedge-the-session contract. Known accepted misses (fail-open by design):
a command smuggled inside a heredoc piped to a shell, and unmatched quotes
(strip to end). Regression tests: `hooks/command-text.test.mjs` plus new cases
in both guard test files — including the evidence-post repro verbatim.

## 11.1 Correction (2026-07-07, later session): Grok Gate B/A is LIVE — §11 cause #2 was wrong (BI-883FC2FC)

§11 above classified Grok **guards-dead** with a residual "harness contract gap — Grok does not invoke the Claude `${CLAUDE_PLUGIN_ROOT}` PreToolUse *blocking* command-hook contract." A follow-up session **live-probed Grok 0.2.87 directly against its own docs and instrumentation** and that conclusion is **disproven**. This subsection supersedes §11's Grok paragraph (cause #2) and the Grok follow-up framing; §11 is retained as the historical record.

**What the live probe showed (Grok 0.2.87):**
- **Grok DOES execute PreToolUse blocking command-hooks and honors deny.** A guard wired via `~/.grok/hooks/` flipped hook discovery to `pre_tool=1` and **blocked** a `prisma migrate` hard-gate (`stopReason: Cancelled`, no output); the same command with no hook ran (`EndTurn`, exit 0). Grok's own `10-hooks.md` documents `PreToolUse` as the one blocking event, plugin-bundled hooks as a source, and `CLAUDE_PLUGIN_ROOT` as an injected alias.
- **The real root cause: Grok's hook-execution plane does not ingest plugin-bundled hooks.** `xai_grok_agent::plugins::discovery` reports the plugin `has_hooks=true`, but `xai_grok_hooks::discovery` loads **only** from `~/.grok/hooks`, `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.cursor/hooks.json` → `total_hooks=0`. The same is true of xAI's own `has_hooks=true` plugins. So `grok plugin install` surfaces skills but never the guards. The `../` manifest bug (§11 cause #1) was **not** the operative blocker — a perfect `./` manifest (`grok plugin validate` clean, installed+trusted) still yields `total_hooks=0`.
- **Second, independent bug: the guards spoke only Claude's I/O envelope.** Grok sends `toolName` (camelCase) = **`"Shell"`** and `toolInput.command`, and expects a top-level `{decision:"deny"}`; the guards read `tool_name`/`tool_input` (snake_case) and emitted `hookSpecificOutput` → read `undefined`, emitted a verdict Grok ignores → fail-open even when loaded. Operator-decisions surface as **`AskQuestion`**, not `AskUserQuestion`.

**Fix shipped in this PR (kernel-ratified delivery scope: `opt_global_context_gated`, `principle_decide` `DI-C17A5861CE0E`, composite 6.096, margin 1.339, high, no commandment conflict; vs `opt_project_scoped`, `opt_global_unscoped`):**
1. **Envelope portability** — a shared `hooks/lib/hook-io.mjs` normalizes input (`toolName`/`tool_name`, `Shell`/`run_terminal_command`/`Bash`, `AskQuestion`/`AskUserQuestion`) and emits a **dual deny envelope** (`{decision}` for Grok + `hookSpecificOutput` for Claude/Codex). All five blocking guards (lease-punt, decision-routing, lease, root-clone, compose) route through it — Claude/Codex unaffected (superset read).
2. **Delivery** — the installer writes a global `~/.grok/hooks/dpf-guards.json` (always-trusted; no folder-trust prompt) pointing at the managed guard copies, since Grok's plugin plane is a dead end for hooks.
3. **DPF-workspace scoping** — because the delivery is global, each guard first confirms the session `cwd` is inside a DPF checkout (`inDpfWorkspace`, `packages/dpf-skill-pack` marker) so DPF-branded denials never fire in unrelated repos.

**End-to-end verification (real refactored guards on real Grok 0.2.87):** in a DPF worktree cwd a `prisma migrate` hard-gate was **DENIED** (`stopReason: Cancelled`); in a bare non-DPF cwd the same command **RAN** (`EndTurn`, exit 0) — envelope portability + delivery + scoping all confirmed live. Classification: **Grok Gate B LIVE (Gate A wired for `AskQuestion`).** BI-3157516C is re-scoped from "upstream contract gap" to the in-house delivery+portability fix landed here. The DPF MCP connector (plane 2) remains a defence-in-depth backstop, no longer the sole enforcing path on Grok.

## 13. Addendum (2026-07-07): Codex hook-trust — deliver + block, do not forge (BI-66EBEA06)

Codex remains **fail-open until the operator grants hook trust** (§11). There is still no supported non-interactive trust API ([openai/codex#21615](https://github.com/openai/codex/issues/21615)); forging `[hooks.state.*] trusted_hash` entries is explicitly out of scope (version-specific, brittle).

**Fix:** the standalone installer (`update_agent_toolchain.py`) now (1) **merges** the five blocking plane-1 guards into `~/.codex/hooks.json` (Bash + AskUserQuestion matchers, preserving foreign hooks), (2) **detects** absent hook-trust state (`hooks.state` / `[hooks.state.*] trusted_hash` in `config.toml`), and (3) prints an **ACTION REQUIRED** block with the hook roster (BI-276EC984) plus optional exit code `2` when `--require-codex-hook-trust` or `DPF_REQUIRE_CODEX_HOOK_TRUST=1` is set. This converts the silent fail-open into a blocking install-time instruction — the acceptance path allowed when automation is impossible.

## 14. Post-incident addendum (2026-07-23): Gate A vocabulary gap — delivery worked, **logic** failed (BI-0F0BE69A)

§9's bypass was delivery, not logic — `decide()` returned `block:true` on the escaping payload, the hook simply never registered. **This incident is the exact inverse: the hook was registered, was reached, and returned `block:false` on a genuine platform/build decision.**

**Incident.** While scoping the customer incumbent-application coverage capability, an external coding agent put three questions to the operator in one `AskUserQuestion` call: epic sequencing across three epics (`EP-ASSET-INTELLIGENCE` vs a new epic vs `BI-ECO-001` first), a **change to the closed `SETUP_STEPS` contract** (adding a 12th onboarding step), and build-scope depth. Replaying the recorded payload through the hook binary returned exit 0 with no deny. The operator caught it, not the harness.

**Root cause — register mismatch, not strength.** `DECISION_LANGUAGE` matched only *engineering* register: `architectur`, `spec`, `schema`, `migration`, `implement`, `refactor`, `which <engineering-noun>`, `option 1|2|3`, and `how (should|far|do) (we|i|you)`. The questions were phrased in *product/roadmap* register and matched nothing:

- `/how\s+(?:should|far|do)\s+(?:we|i|you)\b/` **required a pronoun**. "How should **this scope** enter the roadmap" and "How **ambitious** should the output be" both slipped past a pattern that exists to catch precisely them.
- `roadmap`, `epic`, `backlog`, `scope`, `phase`, `sequencing`, `wizard step`, `prioritize`, `fold into` were absent from the vocabulary entirely.
- The `header` field is concatenated into the matched text but contributed no matching token either ("Scope shape", "Onboarding", "Sales artifact").

The generalizable lesson: **scoping and epic-sequencing work is normally *thought* in delivery register**, so the register that most needs Gate A was the one register it could not see. A vocabulary allow-list calibrated on one professional dialect silently exempts every adjacent dialect.

**Fix (three layers, `packages/dpf-skill-pack/hooks/decision-routing-guard.mjs`).**
1. **Pronoun relaxation** — `how (should|far|do|much|many|deep|ambitious|aggressive|broad|big)` no longer requires `we|i|you`.
2. **`DELIVERY_LANGUAGE`** — a second vocabulary covering the delivery register: roadmap, epic, backlog, sequencing, numbered phase, scope, wizard/setup/onboarding step, prioritize, fold into, build/ship first|now|later|order, first pass.
3. **`TECHNICAL_ARTIFACT`** — a *structural* signal that needs no vocabulary at all: a question carrying a code identifier is by construction about the codebase. Patterns: semantic ids (`BI-`/`EP-`/`DI-`/`PR-`/`DOC-`/`AGT-`), `SCREAMING_SNAKE` constants, source filenames, and `packages/|apps/|scripts/|services/|docs/` repo paths. This is the highest-precision layer — it caught two of the three escaping questions on identifiers alone (`EP-ASSET-INTELLIGENCE`, `BI-ECO-001`, `SETUP_STEP`) — and is structurally inert against naming/branding/market questions.

**False-positive posture, revisited.** The original file asserted "false-positive control is the NARROW scope, not the block strength." That framing is what produced this gap: narrowness was tuned against one dialect. The revised posture is that **precision comes from signal quality, not vocabulary scarcity** — hence layer 3, which widens coverage while *lowering* false-positive risk. Acronyms without underscores (`SMB`, `HOA`, `CRM`) are deliberately not `SCREAMING_SNAKE` matches, so market-segment questions stay clear. Locked by regression tests asserting pricing, hiring, tagline, and market-segment questions still pass.

**Verification.** The three escaping questions are now regression fixtures (verbatim). 13/13 in `decision-routing-guard.test.mjs`, 175/175 across the skill-pack hook suite, and the recorded payload replayed through the hook binary end-to-end now emits the dual-envelope deny.

**Evidence the gate was load-bearing.** After correction, the three decisions were routed through `principle_decide` (`DI-B4B65B293024`, `DI-5C75BC6ACAFC`, `DI-41949223919C`). On the scope-shape decision the kernel **inverted** the agent's pre-decided answer with high confidence — `fold-into-sam` 17.04 vs the agent's preferred `thin-keystone-epic` 13.55 (margin 2.56, tieMargin 0.2, no commandment conflict), with *Architecture Over Shortcuts*, *Optimize for the Whole* and *Proper Fix Over Quick Fix* the discriminating contributors. The agent's instinct was not merely unverified; it was wrong. Gate A existed to force that consultation and did not fire.

**Residual.** The guard remains a heuristic over natural language and will always have a tail. Layer 3 is the durable part — a structural signal that does not depend on predicting phrasing. A stronger future signal would be semantic (embed the question, compare against the decision-class centroid) rather than lexical; deferred as tuning, not filed as a blocker.

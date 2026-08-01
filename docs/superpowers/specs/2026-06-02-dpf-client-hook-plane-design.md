---
title: DPF client-side governance plane — Phase 1 (β-bundle) six-event lifecycle hook bundle
status: draft-for-operator-review
author: Claude (Opus 4.8)
reviewers:
  - Mark (operator review pending)
date: 2026-06-02
backlog:
  - BI-A56D77B6 (parent — this spec)
epics:
  - EP-CLIENT-HOOK-PLANE
related:
  - scripts/hooks/run-hook.mjs
  - .claude/settings.json
  - .claude/settings.local.json.example
  - apps/web/lib/mcp-governed-execute.ts
  - apps/web/lib/tak/agent-grants.ts
  - apps/web/lib/agent-coworker-context.ts
  - AGENTS.md
related_backlog:
  - "BI-0F7C7464 (DONE, PR #1281 — cross-platform hook launcher this spec builds on)"
  - "BI-A56D77B6 (parent BI requesting this spec)"
  - "BI-E1FB2307 (Phase-2 γ-upgrade blocker — Decision Perspective Gate consolidation)"
  - "BI-5FE9DF99 (sibling — MCP tool-surface audit; different plane, complementary work)"
  - "BI-CE49D82E (PR #1367 — Build Studio design-review iteration tracking; informs why Slice 1 routes direct rather than via BS)"
kernel_consultations:
  - "callingSurface=slice-1-client-hook-plane-design (2026-06-02): γ-population-aware destination ratified, composite 6.05, margin 0.66, HIGH confidence. β-then-γ phasing."
  - "callingSurface=slice-1-epic-selection (2026-06-02): new EP-CLIENT-HOOK-PLANE ratified vs fold-under alternatives, composite 5.54, margin 1.09, HIGH confidence."
prs: []
---

# DPF client-side governance plane — Phase 1 spec

## Execution note (operator decision, 2026-06-02)

**This work is done directly in this repo, not promoted to Build Studio.** Build Studio's design-review loop is currently fragile (BI-CE49D82E iteration tracking landed in PR #1367 but is still in-flight; agentic-loop sticky-veto deadlock BI-6FE34236 remains open). Per memory rule [[build-studio-down-route-direct-pr]], routing this spec directly is the safer choice. Build Studio testing is deferred to a lower-stakes BI once the iteration-tracking fix is merged. Claude authors the spec directly; the normal BS Ideate→Build→Verify gates are replaced by operator review of this spec plus the per-event acceptance criteria below.

## Purpose

DPF has two governance planes by deliberate architectural choice: the **server-side tool boundary** (`apps/web/lib/mcp-governed-execute.ts` + `apps/web/lib/tak/agent-grants.ts`) covers MCP tool calls; the **client-side lifecycle** (Claude Code hooks via `scripts/hooks/run-hook.mjs`) covers everything else — `Edit`, `Write`, `Bash`, `Read`, `SessionStart`, `PreCompact`, `Stop`. The server boundary is strong; the client boundary today wires only `PostToolUse` and `SessionEnd` (both forwarding to a single `safety/transcript-snapshot` script). This leaves the rest of the client lifecycle blind to client-side guards.

Phase 1 (this spec) extends the client plane to a full six-event lifecycle bundle, deliberately framed as **the second governance plane**, not as ad-hoc convenience scripts. Phase 2 (γ-upgrade, separate spec) later wires `agent-coworker-context` through and routes ambiguous decisions through the Decision Perspective Gate.

## Phase-1 invariants (★ kernel-ratified)

These are non-negotiable for Phase 1. Phase 2 lifts each as appropriate.

1. **Contributor-scope only.** Slice 1 hooks fire strictly under `in_platform_coworker` sessions on DPF contributor machines. They MUST NOT be installed into customer-coworker (in-portal) sessions until Phase 2 lands. Phase 1 enforces this by **not being part of the customer install profile** — hooks live in the contributor `.claude/settings.json`, never in any path the customer install touches.
2. **No `principle_decide` calls from the hook layer.** WWMD/WWWD lane purity per AGENTS.md §16: until BI-E1FB2307 consolidates the Decision Perspective Gate, hooks must not invoke the kernel directly. Hooks remain population-blind.
3. **Hook blocks emit `ToolExecution` rows.** Every block is auditable on equal footing with other governed tool calls. Blocks write a row via the same governance ledger `mcp-governed-execute` writes to (DPF MCP, not raw DB) — see §"Telemetry contract" below.
4. **Inline scripts, not skill shims.** Each hook is a `scripts/governance/<name>.{ps1,sh}` script invoked by the existing `run-hook.mjs` launcher. Promotion to a DPF skill (`dpf-config-protection`, etc.) only happens when the pattern repeats across ≥3 hooks. Phase 1 has no skills.
5. **Claude-Code-only Phase 1.** Cross-harness reach (Codex, Cursor) is Slice 2 under a future separate epic. This spec does not block on harness portability.
6. **Launcher-contract amendment is explicit.** `run-hook.mjs` today exits 0 ALWAYS. Phase 1 requires a documented `BLOCK` mode for `PreToolUse:*` events — see §"Launcher contract amendment" below. Existing PostToolUse/SessionEnd behavior must not change.

## Substrate this spec extends

| Surface | Path | What's there today | What this spec adds |
|---|---|---|---|
| Launcher | `scripts/hooks/run-hook.mjs` | Node launcher, exit 0 ALWAYS, dispatches to per-OS sibling | Block-mode amendment (non-zero exit propagation for PreToolUse) |
| Settings | `.claude/settings.json` | PostToolUse + SessionEnd → `safety/transcript-snapshot` | Six new hook wirings (see below) |
| Hook scripts | `scripts/safety/transcript-snapshot.{ps1,sh}` | One existing hook script | Six new `scripts/governance/<name>.{ps1,sh}` pairs |
| Telemetry | `mcp__dpf__record_tool_execution` (via MCP) | Server-side tool-call rows | Hook-block rows tagged `source=client-hook` |

Nothing in `apps/web/` changes for Phase 1. All the work is in `scripts/`, `.claude/`, plus a documentation update to `AGENTS.md` adding the client-plane framing.

## Launcher contract amendment

The current launcher contract: missing target / spawn error / non-zero child exit ALL resolve to exit 0. That contract is correct for PostToolUse/SessionEnd snapshot hooks (you never want a transcript-snapshot failure to break a tool call).

PreToolUse hooks need the opposite for block decisions: a non-zero exit from the child script must reach Claude Code so the tool call is blocked. The launcher amendment is narrow:

- A new optional CLI flag `--may-block` makes the launcher propagate the child's non-zero exit. Without the flag, current behavior holds.
- The flag is opt-in per hook in `settings.json`. Existing PostToolUse + SessionEnd wirings get no flag (no behavior change).
- The launcher continues to exit 0 on missing target / spawn error / traversal — only the *legitimate child non-zero exit* propagates. (A missing PreToolUse hook script must not silently block; it must no-op.)

This keeps the launcher's "never break a workflow accidentally" guarantee while enabling deliberate blocks.

## The six events

Each event has a fixed contract: pass/fail definition, install path, telemetry shape, test plan, and the kernel principle it enforces.

### 1. PreToolUse: config-protection

**Purpose.** Block `Edit` / `Write` operations targeting CI-meaningful config files. Today these only fail in CI — hours after the change. The hook turns the failure pre-run.

**Targets (Phase 1 closed list).** `.eslintrc*`, `.prettierrc*`, `tsconfig.json` (and `tsconfig.*.json`), `package.json` (only the `dependencies` / `devDependencies` / `peerDependencies` / `scripts` keys), `pnpm-workspace.yaml`, `turbo.json`, `.github/workflows/*.yml`.

**Pass/fail contract.**
- **Pass (exit 0)**: target file is not in the closed list, OR target file is in the list but the proposed edit is a comment-only / formatting-only change (Phase 2 may relax further; Phase 1 keeps it strict).
- **Block (exit 1)**: target file is in the closed list and the edit changes substantive content. The hook prints a one-line operator-facing message: `BLOCKED: <path> is governance-protected — file BI or use --override-config-protection to acknowledge`.
- **Override.** Setting env var `DPF_HOOK_ALLOW_CONFIG_EDIT=1` for the session bypasses the block (with a `governance.override` row written). Operator escape hatch; not for routine use.

**Install path.** `scripts/governance/config-protection.{ps1,sh}` invoked by `run-hook.mjs --may-block governance/config-protection`. Settings.json wiring matches PreToolUse with `matcher: "Edit|Write"`.

**Telemetry.** On block, write `record_tool_execution(toolName="hook:config-protection", status="blocked", details={path, reason, override_available: true})` via the DPF MCP tool. On override, write `status="override"`.

**Test plan.**
- Unit (vitest): `scripts/governance/config-protection.test.ts` — table-driven cases for protected-path / non-protected-path / override / comment-only-edit.
- Integration: a fixture `.claude/settings.json` with the hook wired, run via the `run-hook.mjs` launcher harness; assert exit codes match the contract.
- Functional: opening Claude Code in a worktree, attempting `Edit` on `.eslintrc.json`, asserting the block fires.

**Kernel principle citation.** `architecture-over-shortcuts` (CI failures are a shortcut; pre-run blocks are the architecture). `evidence-before-diagnosis` (a config-edit block is itself evidence the contributor needs to file a BI).

---

### 2. PreToolUse: bash-allowlist-validator

**Purpose.** Content-based Bash gate beyond static permission rules. Catches BSD-vs-GNU sed footguns (`sed -i` without `''`), `git` without `--no-pager`, `rm -rf` outside the worktree, `npm install` (DPF is pnpm-only), `git config` modifications, etc. — patterns DPF has hit repeatedly per memory ([[bsd-sed-gnu-portability]], [[macos-first-run-cross-platform]]).

**Pass/fail contract.**
- **Pass**: Bash command matches none of the closed deny-patterns AND is on an allow-list of common forms (or matches a pattern the operator has approved via `DPF_HOOK_BASH_OVERRIDE`).
- **Block**: command matches a deny-pattern. Hook prints `BLOCKED: <pattern-name> — <one-line explanation> — see <kernel-rule-or-memory-link>`.

**Deny-pattern closed list (Phase 1).** `sed -i ''` missing (macOS BSD sed), `git` invocations missing `--no-pager` for query commands (per AGENTS.md), `rm -rf /`, `rm -rf ~`, any `rm -rf` outside `$CLAUDE_PROJECT_DIR`, `npm install` / `yarn install` (DPF is pnpm), `git config --global`, `chmod 777`, curl piped to sh.

**Install path.** `scripts/governance/bash-allowlist.{ps1,sh}` with `run-hook.mjs --may-block governance/bash-allowlist`. Matcher: `"Bash"`.

**Telemetry.** Block writes `toolName="hook:bash-allowlist"`, `details={command, pattern, suggestion}`. The hook's own block message is reused in the row's `details.suggestion`.

**Test plan.**
- Unit: table-driven cases per deny-pattern.
- Integration: a fixture invocation harness routes synthetic Bash payloads through the hook.
- Functional: a known-bad pattern (e.g. `sed -i 's/foo/bar/' file`) blocks; same with `sed -i '' 's/foo/bar/' file` passes.

**Kernel principle citation.** `never-assume-verify` (verify the command shape before letting it run). `never-fabricate` (a broken `sed -i` produces fabricated state).

---

### 3. SessionStart: memory-load

**Purpose.** Auto-load DPF memory + recent backlog context at session start so the operator doesn't manually re-orient. Solves the "every fresh session re-reads MEMORY.md by hand" pattern.

**Pass/fail contract.**
- **Pass (always — this is a load, not a block)**: prints a one-screen context summary to stdout, which Claude Code surfaces as a SessionStart system message.
- **Content emitted**: contents of `~/.claude/projects/<project-hash>/memory/MEMORY.md` (the index), trimmed; the top 10 open BIs by `updatedAt` from `mcp__dpf__query_backlog`; current branch + last 3 commits; any open Build Studio build IDs from `mcp__dpf__list_work_capsules`.
- **Failure mode**: if MCP is unreachable, falls back to MEMORY.md + git only; never exit non-zero.

**Install path.** `scripts/governance/memory-load.{ps1,sh}`. No `--may-block`. Matcher: `SessionStart`.

**Telemetry.** Writes `toolName="hook:memory-load"`, `status="ok"`, `details={memoryBytes, openBiCount, currentBranch}`. On MCP-unreachable fallback, `status="degraded"`.

**Test plan.**
- Unit: stub `mcp__dpf__query_backlog` and assert the script emits expected sections.
- Integration: against a live DPF MCP (in-process), assert the SessionStart payload contains all four sections.
- Functional: open Claude Code on the dev portal worktree, assert the first system message includes the MEMORY.md index entries.

**Kernel principle citation.** `live-state-over-seed-data` (load live backlog, not a cached snapshot). `do-the-work-dont-task-the-operator` (the operator should not have to re-orient by hand each session).

---

### 4. PreCompact: save-state

**Purpose.** Durable handoff record before context compaction. Today compaction loses thread state silently — decisions made mid-context vanish from the post-compact prompt unless they were already in memory or a BI.

**Pass/fail contract.**
- **Pass**: writes a `SessionDigest` row capturing: last 20 tool calls (names + status), files edited this session, BIs touched, MCP evidence rows created, current branch + dirty/clean status, and a 200-word LLM-emitted summary of the active task. Always exits 0.
- **No block path.** PreCompact is informational; we never want compaction to fail because the hook failed.

**Install path.** `scripts/governance/save-state.{ps1,sh}`. Matcher: `PreCompact`.

**Telemetry.** Writes `toolName="hook:pre-compact-save"`, `status="ok"`, `details={digestRowId, taskSummary, fileCount, biCount}`. The `SessionDigest` row itself is a new lightweight table (one-time migration; see "Schema additions" below).

**Test plan.**
- Unit: digest-builder unit tests cover each input class (tool calls, file diff, BI touch).
- Integration: a stubbed PreCompact event triggers the hook, the SessionDigest row appears in the test DB.
- Functional: trigger compaction in a real session, verify the digest row + that the post-compact session can read it via SessionStart's memory-load.

**Kernel principle citation.** `single-source-of-truth` (post-compact context has ONE place to recover from). `evidence-before-diagnosis` (the SessionDigest is the evidence base for "what happened in the lost context window").

**Schema additions.** New table `SessionDigest` — `(id, sessionId, recordedAt, summary, toolCallsJson, filesJson, bisTouchedJson, branch, isDirty)`. Migration is a small Prisma add; spec'd in the child BI but not blocking other events.

---

### 5. Stop: session-summary

**Purpose.** On session Stop, append a final `SessionDigest` row tying the conversation to BIs touched, files changed, decisions recorded — separate from the PreCompact digest because Stop is the terminal record.

**Pass/fail contract.**
- **Pass**: writes a `SessionDigest` row with `kind="stop"` containing the same shape as PreCompact, plus an `outcome` field (`completed-task | abandoned | crashed | unknown`). Always exits 0.
- **No block path.**

**Install path.** `scripts/governance/session-summary.{ps1,sh}`. Matcher: `Stop`. **Coexists with the existing `safety/transcript-snapshot` SessionEnd hook**; that one stays for raw transcript persistence, this one writes the structured digest.

**Telemetry.** Writes `toolName="hook:session-summary"`, `details={digestRowId, outcome, durationMs}`.

**Test plan.**
- Unit: digest shape + outcome classification rules.
- Integration: synthetic Stop payload, assert the row + the `outcome` heuristic match.
- Functional: complete a real task session, verify the row.

**Kernel principle citation.** `live-state-over-seed-data`. `evidence-before-diagnosis` (every session leaves a final ledger entry).

---

### 6. PostToolUse: governance-capture

**Purpose.** Log secret-handling, policy-touching, and substrate-mutating tool calls to a per-session governance ledger. Precursor to Slice 4 (session-as-corpus mining loop) — when that arrives, this is the data it mines.

**Pass/fail contract.**
- **Pass**: writes a `GovernanceEvent` row when a triggering tool was used. Triggers (Phase 1 closed list): any `mcp__dpf__*` write tool, any `Bash` matching secret-handling patterns (env var writes containing TOKEN/SECRET/KEY substrings), any `Write`/`Edit` to `.env*` files, any tool returning `status="blocked"` or `"override"` from other hooks.
- **No block path.**

**Install path.** `scripts/governance/governance-capture.{ps1,sh}`. Matcher: `PostToolUse`. Coexists with existing `safety/transcript-snapshot` PostToolUse — both fire; both are async.

**Telemetry.** Writes `toolName="hook:governance-capture"`, plus the actual `GovernanceEvent` row (new lightweight table — see "Schema additions" below). Async; failure to write the row is logged but doesn't block.

**Test plan.**
- Unit: trigger-classifier table-driven cases.
- Integration: fire synthetic PostToolUse events, assert GovernanceEvent rows for the triggering classes.
- Functional: run a real session that touches `.env`, asserts a row.

**Kernel principle citation.** `evidence-before-diagnosis` (governance events ARE the evidence base for "what did the session touch"). `single-source-of-truth` (one ledger for all client-plane policy-touching tool use).

**Schema additions.** New table `GovernanceEvent` — `(id, sessionId, recordedAt, kind, toolName, payloadJson, sensitive)`. Same migration window as `SessionDigest`.

---

## Telemetry contract (cross-event)

All six hooks emit telemetry through the **DPF MCP server**, not direct DB writes — even though it's tempting to write directly from a shell script. Rationale: every governance event must pass through `mcp-governed-execute` so the server-plane and client-plane share one audit ledger. The hook scripts shell out to:

```
dpf-mcp-call record_tool_execution --tool hook:<name> --status <ok|blocked|override|degraded> --details <json>
```

A thin CLI wrapper `scripts/governance/dpf-mcp-call.{ps1,sh}` is filed as its own child BI (cross-cutting, see §"Child BI decomposition" below) so all six hooks share one MCP-call mechanism.

If the MCP is unreachable, telemetry falls back to appending a JSONL line to `.claude/governance-fallback.jsonl` in the project root; a future hook reconciles those rows once MCP is back.

## Phase-2 forward-looking (γ-upgrade, NOT decomposed)

Phase 2 lifts invariants 1, 2, and 5. Sketched here so child BIs don't accidentally close them off.

- **Phase-2.1**: hooks consume `apps/web/lib/agent-coworker-context.ts` to learn `callingPopulation` + active coworker identity. The launcher receives this context via a SessionStart-set environment.
- **Phase-2.2**: ambiguous decisions (e.g. "should THIS coworker be allowed to edit `.eslintrc` given THIS task?") route through the **Decision Perspective Gate** (BI-E1FB2307) — NOT raw `principle_decide`. The Gate enforces the WWMD/WWWD lane split.
- **Phase-2.3**: hooks become part of the customer install profile, scoped to `in_platform_coworker` AND `human` populations on customer machines. External agents (`external_coding_agent`) get a different scope based on their grant trees.
- **Phase-2.4**: cross-harness reach (Slice 2) generalizes the launcher to invoke from Codex/Cursor adapters.

None of the Phase-1 work conflicts with the above — Phase-1 hooks ship as population-blind scripts; Phase 2 wraps them with context-aware preludes. No rewrites required.

## Acceptance (for the parent BI-A56D77B6)

- This spec committed at `docs/superpowers/specs/2026-06-02-dpf-client-hook-plane-design.md` (this file).
- 5-7 child BIs filed under EP-CLIENT-HOOK-PLANE — one per event (6) plus 1 cross-cutting (the `dpf-mcp-call` wrapper + `--may-block` launcher amendment).
- Each child BI cites its event's pass/fail contract and the kernel principles above.
- `AGENTS.md` updated with a brief client-plane framing in §X (TBD — operator picks the section number during review).
- Parent BI-A56D77B6 moves to `done` once children are filed and AGENTS.md update is in PR.

## Child BI decomposition (proposed)

| Child | Title (proposed) | Event | Sizing | Notes |
|---|---|---|---|---|
| Child-1 | Launcher `--may-block` amendment + `dpf-mcp-call` wrapper | (cross-cutting) | small | Must land first; all PreToolUse events depend on it |
| Child-2 | PreToolUse: config-protection | event 1 | small | |
| Child-3 | PreToolUse: bash-allowlist-validator | event 2 | medium | Deny-pattern catalog needs review |
| Child-4 | SessionStart: memory-load | event 3 | medium | Calls 3-4 MCP tools; shape matters for token budget |
| Child-5 | PreCompact: save-state + SessionDigest table | event 4 | medium | Includes Prisma migration |
| Child-6 | Stop: session-summary | event 5 | small | Reuses event 4's table |
| Child-7 | PostToolUse: governance-capture + GovernanceEvent table | event 6 | medium | Includes Prisma migration |

7 children; sum of sizing ≈ 1.5 large (medium ×4 + small ×3). Reasonable for a Phase-1 epic.

## Out of scope (Phase 2 γ-upgrade)

- Wiring `agent-coworker-context` through the hook layer.
- Hooks consuming `callingPopulation` and routing through the Decision Perspective Gate.
- Customer-coworker (in-portal) hook firing.
- Cross-harness adapters (Codex / Cursor / OpenCode).
- Session-as-corpus mining loop (Slice 4 — consumes Phase-1 PostToolUse:governance-capture telemetry).
- Eval harness for hooks (Slice 3 — depends on Phase-1 telemetry surface).

Each of the above re-enters scope as a Phase-2 follow-on BI under EP-CLIENT-HOOK-PLANE, post BI-E1FB2307 landing.

## Cross-refs

- Kernel consultations recorded in BI-A56D77B6 and in `mcp__dpf__record_external_development_evidence` rows (sessionId=`ecc-investigation-2026-06-02`).
- Parent BI: BI-A56D77B6.
- Epic: EP-CLIENT-HOOK-PLANE.
- Predecessor (cross-platform plumbing): BI-0F7C7464 / PR #1281.
- Phase-2 blocker: BI-E1FB2307 (Decision Perspective Gate).
- Sibling work, different plane: BI-5FE9DF99 (MCP tool-surface ergonomics audit).
- Skills composed: [`dpf-writing-plans`](../../../packages/dpf-skill-pack/skills/dpf-writing-plans/SKILL.md) (this spec's authoring), [`dpf-decision-via-kernel`](../../../packages/dpf-skill-pack/skills/dpf-decision-via-kernel/SKILL.md) (γ destination + new-epic kernel calls), [`dpf-record-decision-outcome`](../../../packages/dpf-skill-pack/skills/dpf-record-decision-outcome/SKILL.md) (audit-trail discipline).
- Source memory note (provenance): [ecc-everything-claude-code-evaluation](file:///Users/markbodman/.claude/projects/-Users-markbodman-dpf/memory/ecc-everything-claude-code-evaluation.md). The four-event-class taxonomy idea surfaced through ECC; the architectural framing, the scope, and the destination are DPF-native and would have arrived independently as Build Studio scale increased.

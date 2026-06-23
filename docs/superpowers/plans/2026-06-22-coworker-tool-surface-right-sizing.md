# Coworker tool-surface right-sizing + on-demand load + honest overflow

Date: 2026-06-22
Epic: EP-COWORKER-INTERACTIVITY
Backlog items: BI-F75E897A (WS1 grant/attachment right-sizing), BI-AC4E66A3 (WS3 error
propagation), BI-6A745E3C (WS2 cap + delegation — partially delivered here).

## Problem

On a fully-local install the in-portal coworker agentic loop attaches the agent's
grant-expanded tool surface every turn. A tier-2 page coworker (`ops-coordinator`,
"Scrum Master") holds only 5 grants, but those grants + the universal read baseline
(`COWORKER_READ_BASELINE_GRANTS`) expand to ~104 tools ≈ ~34k tokens of JSON schema.
The local model serves a 32,768-token context, so every tool-using turn fails with
HTTP 400 `exceed_context_size_error`. Because a fully-local install has no cloud
fallback, `callWithFallbackChain` exhausts and the coworker dies — surfaced to the
user as a misleading "providers momentarily busy, try again in 30s".

Two prior operator decisions are in tension:
- BI-FD7E4D72 (2026-06-06): every coworker should be *able* to read the page, docs,
  source, and code graph (breadth → useful).
- 2026-06-22 (this work): 104 tools is too many for one agent on a budget local model;
  right-size and limit what is attached.

They reconcile by separating **authority** (grants — unchanged) from **attachment**
(schemas sent per turn — right-sized). Operator decision: **cap + load on demand**.

## What this delivers (done here — Build Studio cannot build a fix to its own
overflowing engine, so the work is direct)

1. **Per-turn attachment budget** — `apps/web/lib/actions/coworker-tool-budget.ts`
   (pure, unit-tested). `selectCoworkerToolBudget()` splits the authorized set into
   `attached` (page actions + role-granted + core, up to `MAX_COWORKER_ATTACHED_TOOLS`
   = 48) and `deferred` (the breadth tail), preserving order. Authority is untouched:
   deferred tools stay granted.
2. **On-demand load** — `load_tools` meta-tool (`LOAD_TOOLS_TOOL`) attached only when
   tools were deferred. The agentic loop intercepts it (like the plan tools), moving
   matching deferred tools into the live provider tool set for subsequent iterations.
   `selectLoadableTools()` matches by exact name or keyword query, capped per batch.
3. **Authority-preserving auto-load** — if the model calls an authorized-but-deferred
   tool directly (without first calling `load_tools`), the loop promotes it from the
   deferred pool and executes it, so deferral caps cost without ever removing
   capability.
4. **Honest overflow propagation** — `describeToolRouteFailure` gains an
   `exceed_context_size_error` branch: a deterministic context overflow no longer
   reports as a transient rate-limit.

Wiring is backward-compatible: `deferredTools` is a new optional param on
`runAgenticLoop` / `executeAutonomousAgenticLoop`, empty for autonomous + build
callers, so only the chat coworker path changes behavior. Grants are unchanged, so
the BI-FD7E4D72 grant tests stay green.

## Touched files
- NEW `apps/web/lib/actions/coworker-tool-budget.ts` (+ `.test.ts`)
- `apps/web/lib/actions/agent-coworker.ts` — budget the attached set, pass deferred,
  log `authorized`/`attached`/`deferred`.
- `apps/web/lib/tak/agentic-loop.ts` — `deferredTools` param, `load_tools` interception,
  auto-load, overflow message.
- `apps/web/lib/tak/autonomous-work-run.ts` — thread `deferredTools` through.

## Verification
- Unit: `coworker-tool-budget.test.ts` (tiering, cap, deferral order, loadable match).
- CI is the gate (worktree has no node_modules; local vitest unavailable).
- Live signal after deploy: the `[tools]` log for `ops-coordinator` on
  `/ops/self-upgrade` shows `attached` well under the served context, `deferred` > 0,
  and tool turns stop returning `exceed_context_size_error`.

## Deferred (follow-on, BI-6A745E3C and a future grant-taxonomy item)
- Derive the cap from the served context window instead of a constant.
- Split coarse grants (`registry_read` ≈ 28 tools) into finer opt-in grants.
- Coordinator delegation pattern (coordinators dispatch specialists via
  spawn_work_thread / request_coworker rather than holding specialist tools).
- Prioritize `requiresExternalAccess` tools into the attached tier when external
  access is enabled.
- Minimal-tool compaction so the summarization call cannot itself overflow.

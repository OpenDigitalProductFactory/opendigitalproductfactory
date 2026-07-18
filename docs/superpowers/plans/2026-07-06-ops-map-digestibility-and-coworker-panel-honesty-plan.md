# Operations Map digestibility + coworker panel honest states — implementation plan

- **Date:** 2026-07-06
- **Backlog items:** BI-E3969A69 (Operations Map digestibility pass, product/feature, build/medium), BI-D028B2A8 (coworker composer honest states + thread-load retry, product/bug, build/small, EP-BS-UX-HARDENING)
- **Origin:** Operator session 2026-07-06 — operator reported /platform/ai/operations-map as "difficult to process… internal IDs… not actionable", and a coworker panel stuck on "Sending…" with no user action (diagnosed: stale tab across the 10:19 self-upgrade swap; thread-load server action failed; error swallowed; placeholder lies).
- **Related:** BI-F381D902 (client version-skew handling — separate root-cause track, NOT this plan), docs/superpowers/specs/2026-06-05-ai-operations-map-three-band-cohesive-layout-design.md (unified canvas Stages 0–E), docs/superpowers/specs/2026-06-28-activity-level-ai-routing-harness-design.md (recipe key semantics).

## Kernel decision (recorded)

`principle_decide` (callingPopulation=external_coding_agent, governing profile: platform) on where BI-E3969A69 lands relative to the in-flight unified-canvas refactor:

| Option | Composite |
| --- | --- |
| A presentation layer now on current panels | 10.617 |
| B fold into Stage D/E canvas cutover | 10.592 |
| **C hybrid: pure label/empty-state module + attention queue now; structural re-layout deferred to canvas cutover** | **10.862 — recommended, confidence high, margin 0.245** |

Consequence encoded as a guardrail below: no structural layout changes to the legacy panels in this plan, so the canvas parity baseline (Stage 0 fixtures) stays stable; the new presentation module is pure and becomes a shared dependency of the canvas at cutover.

## UX fit review (dpf-ux-fit-review)

- Decision: fits-with-guardrails
- Owning area: Platform (AI Operations); coworker panel work is portal-global chrome under EP-BS-UX-HARDENING ("status surfaces stay honest")
- Route family: /platform/ai/operations-map (no new routes, no new dashboard)
- Primary persona: founder/operator triaging AI-workforce health; platform-engineer forensics moves behind disclosure
- Navigation layer touched: local page only
- Reuse/convergence: pure `route-labels` module reusable by Stage B–E canvas; badges/tooltips compose existing report-kit/status primitives; no new component dialect
- Source truth: `OperationsMapActivityStep` / `OperationsMapRoutingTopology` projections (apps/web/lib/ai-operations-map/) — no schema or read-model change
- AI boundary: unchanged; page stays read-only, approval queuing keeps explicit confirmation
- Captured in: this plan + BI bodies

## Status

- Phase 1 (composer honest states + thread-load retry): **implemented** — `composer-state.ts` state machine, shell load-state + bounded auto-retry + Retry banner.
- Phases 2–4: in flight on `feat/opsmap-digestibility`.

## Workstream 1 — BI-D028B2A8: coworker composer honest states (ships first, independent)

### Phase 1: truthful composer state machine + thread-load retry

Files (verified in tree 2026-07-06):
- `apps/web/components/agent/AgentMessageInput.tsx:815` — placeholder currently `disabled ? "Sending..." : busy ? … : …`. Replace the boolean with an explicit `composerState` prop: `ready | busy | sending | connecting | clearing | load-failed`, each with a truthful placeholder ("Connecting…", "Clearing conversation…", "Couldn't load this conversation"). "Sending…" is shown only between send-click and send-settled.
- `apps/web/components/agent/AgentCoworkerPanel.tsx:1122` — currently `disabled={isClearing || !threadId}`. Derive `composerState` instead: `isClearing → clearing`, thread loading → `connecting`, load error → `load-failed`.
- `apps/web/components/agent/AgentCoworkerShell.tsx:229-273` — the load effect currently `catch`es, warns, and leaves `threadId=null` with no recovery. Add `threadLoadState: loading | ready | failed` + a `retryToken` state the effect depends on; one bounded auto-retry (~2s) then a visible panel error state ("Couldn't load this conversation — Retry") wired to bump `retryToken`. Preserve the queued-auto-message drain semantics inside the load callback exactly (comment block at :251-262 documents the race it prevents).

Verification:
- Vitest: state-mapping unit tests (composerState → placeholder/disabled), and a shell test forcing `getOrCreateThreadSnapshot` rejection → asserts failed-state + retry re-invokes the load.
- Functional: contributor preview with the snapshot action stubbed to reject — panel shows error + Retry; placeholder never reads "Sending…" absent an in-flight send. Erase-conversation path shows "Clearing conversation…".

Risks: string assertions in existing tests referencing "Sending..."; the auto-message race if the effect dependency array changes — mitigated by only adding `retryToken` and keeping drain logic in place.

### Phase 1 correction (2026-07-18): failed-state recovery is a reload, not a soft retry

Follow-up on an operator report of the same symptom this plan targets ("conversations aren't loading" — panel showing the load-failed banner after the 10:36 self-upgrade swap). The Phase-1 recovery shipped a **Retry** that bumped `retryToken` to re-invoke `getOrCreateThreadSnapshot`. That cannot recover the *diagnosed* cause: a self-upgrade rotates the Next.js server-action IDs, so the stale tab's cached action reference 404s and re-invoking the **same** reference from the already-loaded bundle fails every time. The `~2s` bounded auto-retry already covers brief transient blips before the banner ever shows, so by the time an operator sees the failed state a soft re-call adds no recovery reload doesn't.

Correction: the failed-state action is now **"Reload to reconnect"** → `window.location.reload()`, which fetches a fresh client bundle with current server-action IDs (the only recovery that fixes the stale-tab case, and a superset recovery for the transient case). `onRetryThreadLoad` → `onReloadToReconnect`; the auto-retry + queued-auto-message drain semantics are unchanged. The shell test now asserts the failed state exposes a reconnect action that reloads without re-invoking the dead server action.

## Workstream 2 — BI-E3969A69: Operations Map digestibility

### Phase 2: pure route/recipe presentation module

- New `apps/web/lib/ai-operations-map/route-labels.ts` (pure, no React):
  - Parse `harnessRecipeKey` (`<provider>.<distribution>.<activity>.<confidence>`, e.g. `glm.center.summarize.provisional`) into parts + a human label ("GLM 5.2 via Z.ai — provisional trial recipe for summarize work at the center tier").
  - Display-name maps for provider/model/distribution/activity terms; container-image shortener (`docker.io/ai/qwen3.6:latest` → "Qwen 3.6 (local container)"); plain-language copy registry for confidence tiers (calibrating/provisional/trusted/degraded) and priority chips.
  - Graceful fallback for unparseable/unbound keys (never throw; return the raw key as `technicalId`).
- Unit tests over real fixture keys from `ActivityRoutingWorkbench.test.tsx` + malformed inputs.

Verification: vitest green; module imported by nothing yet (safe to land alone).

### Phase 3: apply presentation + honest empty states in the workbench

Files: `apps/web/components/platform/ActivityRoutingWorkbench.tsx` (raw `harnessRecipeKey` renders at :170, :307, :388; evidence facts at :370-413).
- Node cards + drawer show the humanized label; raw recipe key, `adapterTelemetryId`, `routeDecisionId` move behind a "Technical details" disclosure with copy affordance.
- Outcome Evidence: when all of signal/route/tokens/cost are unknown, render one sentence — "No outcome recorded yet — this route hasn't run." — instead of four Unknowns. Alternatives Excluded: single line when empty, no empty panel box.
- Confidence + priority chips get tooltips/legend from the Phase 2 copy registry.
- Guardrail (kernel decision): no panel/band re-layout; changes are content-level within existing structure. New code lives in new files where possible (module-size ratchet: AiOperationsMap.tsx is already 2,789 lines — do not grow it).

Verification: update `ActivityRoutingWorkbench.test.tsx` fixtures (failed + attention + all-unknown activities); assert no raw recipe key in default render; desktop + narrow-viewport check on contributor preview per dpf-use-shared-nonprod-environment.

### Phase 4: attention-first review queue

- The "N needs review" badge (ActivityRoutingWorkbench.tsx:116-120, count from :54-56) becomes a button opening a local queue view (drawer/section, local page nav only) listing failed/attention activities.
- Each row: humanized activity label, plain-language reason, and its action — "Queue approval" when an action proposal exists (existing `proposeActivityHarnessOverrideAction` path, confirmation preserved), "Open originating task/build" via `taskRef` when present, else explicit "Informational — no action available yet" with the reason.
- FAILED phase cards (Ideate/Plan/Design review) link to the owning build's surface rather than dead-ending.

Verification: interaction test (badge → queue → action row states for all three cases); live-install spot check with a real failed activity.

### Phase 5 (explicitly deferred): first-viewport structural re-layout

Deferred to the unified-canvas Stage B–E cutover per the 2026-06-05 three-band spec and the kernel decision above. `route-labels.ts` is the shared dependency the canvas consumes at cutover. Nothing in Phases 1–4 may fork the layout.

## Sequencing, risk, rollback

- Order: Phase 1 (independent PR, quick win) → Phase 2+3 (one PR) → Phase 4 (one PR). Each lands via DCO-signed PR against main with CI babysat to green.
- Blast radius: UI layer only; zero schema/read-model changes; rollback = revert the offending PR.
- Known ratchet gotchas: whole-tree Module-Size/Style-Drift guards inherit main's baseline (rebase + `--update`, take `--ours` on baseline.json); use `var(--dpf-*)` tokens exclusively.
- Definition of done = acceptance criteria on BI-D028B2A8 and BI-E3969A69 (this plan's phases map 1:1).

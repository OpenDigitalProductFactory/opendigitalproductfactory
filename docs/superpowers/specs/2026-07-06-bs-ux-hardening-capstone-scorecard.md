# EP-BS-UX-HARDENING Capstone — Non-Technical User Verification Scorecard

**Goal:** Build Studio works end-to-end for a non-technical user, proven by repeated clean
runs through the real portal UX. Exit: 2 consecutive full-matrix sweeps with zero invariant
violations + zero terminal interventions, then 5 fresh quick-box builds unassisted.

**Invariants (violation = BI):** 1 no dead-ends · 2 no silent stalls · 3 no jargon failures ·
4 no terminal recovery · 5 honest status · 6 gates explain themselves.

**Preflight:** 2026-07-06 CAN-TEST — served `0688f82a` contains latest BS commit `43347bc5`
(#2620 inference-recovery fix). Advanced via governed self-upgrade twice this session.

## Scenario matrix

| # | Scenario | Size | Injection | Sweep 1 | Sweep 2 | Sweep 3 | BIs |
|---|----------|------|-----------|---------|---------|---------|-----|
| A1 | Quick-box ad-hoc build | xs | — | pending | | | |
| A2 | Quick-box ad-hoc build | multi-phase | — | pending | | | |
| B1 | Backlog BI promoted | xs | — | pending | | | |
| C1 | Coworker-initiated build | any | — | pending | | | |
| D1 | Fix-flow (bug work-kind) | xs | — | pending | | | |
| F1 | Quick-box | xs | first inference turn killed | pending | | | |
| F2 | Quick-box | xs | AI provider briefly unavailable | pending | | | |
| F3 | Any | xs | TaskRun wedged in 'working' | pending | | | |
| F4 | Quick-box | xs | no taxonomy anchor | pending | | | |
| F5 | Any | any | scout research fails | pending | | | |
| F6 | Multi-phase | feature | design-review rejection cycle | pending | | | |

## Run log

### 2026-07-06 ~00:04–00:56 · A1 attempt 1 · FB-673BF54B ("Greet me by my first name…")
Quick-box build created ~00:04 (pre-swap runtime). First coworker turn ran: scout dispatched,
findings saved 00:04:20, assistant replied "findings should land on the next turn". Then
**46 minutes of nothing** — no continuation is ever scheduled for ad-hoc builds; the
boot-resumer detected the strand twice (00:34, 00:37) but `dispatchIdeateForApprovedBuild`
hard-skips ad-hoc builds (`skipped-no-bi`, activity log). Meanwhile the UI showed
"Getting started — …the coworker is drafting your Feature Brief… **Nothing is wrong**",
"Needs you: 0", ENGINE: PENDING DISPATCH. A user nudge message ("Any update on this build?")
revived the build — turn resumed, "What we're building" populated.

**Findings:**
1. **[F-1 / invariants 2+5]** Custodian "Getting started / Nothing is wrong" card
   (`build-studio-custodian.ts` ideate-&&-brief==null branch, BI-86D6AD78) has **no time
   bound** — it shadows the 5-min early-phase quiet detection (BI-97738ED0) forever. The
   two shipped fixes fight; the stalled-ideate window (the most common failure window, per
   the code's own comment) shows soothing copy indefinitely.
2. **[F-2 / invariants 1+2]** Ad-hoc (quick-box) ideate has **no autonomous continuation**:
   post-turn scout completes, findings sit waiting for "the next turn", nothing fires a next
   turn; resume-on-boot skips ad-hoc builds. Only a user message revives it — and the UI
   copy explicitly tells the user to passively wait ("let the coworker keep drafting").
3. **[F-3 / invariants 1+3, platform]** Stale browser tab after self-upgrade swap: server
   action IDs from the pre-swap bundle fail (`Failed to find Server Action … older or newer
   deployment`) with no user-visible "portal was updated — reload" prompt. Coworker send
   silently did nothing from the user's perspective.
4. **[F-4 / invariants 3+5, platform]** Banner "Upgrade postponed, failed. You can continue
   working." shown right after a *successful* upgrade (swap to 0688f82a verified in DB).
   False-negative banner regression/leftover. (Later "Platform upgrade preparing… ETA about
   5 min" quiescence banner is good copy.)

### 2026-07-06 00:50–00:56 · A1 attempt 1 continued · swap-killed turn
User nudge 00:50:09 revived the turn (Codebase Research ran, "What we're building" populated).
The 00:52 self-upgrade swap (0688f82a → 23261b9f) killed the turn mid-flight: brief+designDoc
persisted 00:52:16, but the assistant reply was never written — the thread shows the user's
question unanswered, panel stuck "Agent is working…". Quiescence banner had promised "current
work will finish before the update"; it did not. **[F-5, folded into F-2's BI]**
Predicted self-heal: periodic janitor (10-min interval, 20-min staleness) should re-fire
reviewDesignDoc (designDoc now exists → ad-hoc skip no longer applies) by ~01:12–01:22.

**A1 attempt 1 verdict: FAIL — invariants 1, 2, 3, 5 violated (4 BIs).**

| # | Scenario A1 findings | BI |
|---|---|---|
| F-1 | Unbounded "Nothing is wrong" custodian card shadows stall detection | BI-0F7C855A |
| F-2+F-5 | No autonomous continuation for ad-hoc ideate; swap-killed turn loses reply | BI-06EA3D96 |
| F-3 | Stale tab post-swap: server actions fail, no reload prompt | BI-F381D902 |
| F-4 | "Upgrade postponed, failed" banner after successful upgrade | BI-3C6447D5 |

### 2026-07-06 01:07 · A1 attempt 1 · autonomous resume → NEW root cause (F-6)
The periodic janitor DID self-heal the swap-killed turn as predicted (fired
reviewDesignDoc at 01:07, design passed, size ok) — but the build STILL did not
advance. Root cause found in logs: the auto-intake epic leg threw "`headers` was
called outside a request scope" (createBuildEpic → requireBuildAccess → headers())
because the resume path has no request scope. Error swallowed, epicId stayed null,
gate blocked on "Missing: epic". This is THE reason ad-hoc builds never advance
autonomously — a distinct, higher-leverage bug than F-2's framing. **[F-6]**

## BIs filed this effort

- BI-0F7C855A — custodian getting-started card unbounded (invariants 2+5) — **FIXED** (PR pending)
- BI-836C5243 — ideate auto-intake epic-create fails outside request scope (invariants 2+5) — **FIXED** (PR pending)
- BI-06EA3D96 — ad-hoc ideate pre-designDoc continuation + swap-killed turn reply loss (invariants 1+2) — open (follow-up)
- BI-F381D902 — client version-skew: stale tab server actions fail silently (invariants 1+3) — open (triage: defer, platform-shell change; see below)
- BI-3C6447D5 — false "Upgrade postponed, failed" banner (invariants 3+5) — open (triage: self-healing cosmetic; see below)

## Structural changes vs. what was already solid

**Changed this effort (PR fix/bs-ux-capstone-a1):**
1. `autoCreateBuildEpic` helper (apps/web/lib/integrate/auto-intake-epic.ts) — request-scope-independent epic
   creation, injected prisma client. reviewDesignDoc auto-intake + createBuildEpic server action both delegate
   to it (DRY). Unblocks autonomous ideate→plan advance for ad-hoc builds. (BI-836C5243)
2. Custodian getting-started card now bounded by the early-phase quiet threshold: past the bar it shows an
   honest "Drafting your Feature Brief has stalled" card with a restart-drafting action instead of the
   unbounded "Nothing is wrong". (BI-0F7C855A)

**Already solid (verified working live):** the periodic stranded-build janitor (10-min tick) fires
reviewDesignDoc on resume exactly as designed; the ideate auto-intake backlog/constrainedGoal/taxonomy legs
(direct prisma writes) work in the autonomous path; the quiescence "preparing/upgrading" banners have good
plain-language copy; the quiescence reconcile (Case 2) self-corrects false-failed rows within ≤20 min.

## Triage rationale for deferred BIs
- **BI-F381D902 (stale-tab server actions):** real, but the robust fix is a platform-shell change (global
  server-action-error interception + a "platform updated — reload" affordance) with broad blast radius across
  every authenticated route. Out of scope for the Build-Studio-flow fix PR; belongs in a dedicated focused build.
- **BI-3C6447D5 (false "failed" banner):** self-healing — the banner auto-dismisses after 60s and the periodic
  quiescence reconcile re-emits `succeeded` within ≤20 min. Cosmetic-only alarming word during a transient
  window; a proper fix (suppress "failed" when the running bundle already equals the run's target) is a
  banner+event-contract change better done deliberately than bundled here.
- **BI-06EA3D96 (pre-designDoc continuation):** the remaining core-flow gap — an ad-hoc build with no designDoc
  and no active turn has no autonomous driver (dispatchIdeateForApprovedBuild requires a BI for research
  context). F-1's honest stalled card now gives the user a one-click restart in that window; full autonomy
  (headless drafting turn) is a larger change tracked as its own follow-up.

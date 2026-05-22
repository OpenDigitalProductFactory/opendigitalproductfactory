# 2026-05-22 Overnight session summary

Session ran while Mark slept. Goal was "shuttle all items through to completion via Build Studio, fix what's blocking PRs from landing cleanly."

## TL;DR

- **PR #985 opened, CI green** — fixes the `/build` page crash that prevented selecting most builds in the list.
- **FB-0A1B06B3 filed via BS UX** — Deploy Promotion safety net BI, currently in Ideate.
- **CRITICAL FINDING: do not click Deploy Promotion on FB-7A21E1F6.** Promotion `CP-8AD71684` is approved and pressable but the sandbox diff is contaminated with unrelated snapshot churn. The actual self-upgrade feature already shipped via PR #830. Executing the promotion would deploy garbage. Rejection UX does not exist (see queue).
- **Driving 30+ builds through BS in one session was not pragmatic.** Substrate gaps (FB-78E967D4 Reset Build, FB-7F8C7368 external sync, FB-3CA106CC baseline refresh) need to land first. Detailed inventory and queue below.

## Concrete progress

1. **[apps#985](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/985)** — `fix(build-studio): guard undefined fileStructure on /build page`
   - Two-line defensive `?? []` in `task-dependency-graph.ts` + `process-graph-builder.ts`
   - Regression test covering `buildDependencyGraph(undefined, tasks)`
   - All CI green: DCO, CodeQL, Typecheck, Production Build, Unit Tests, Routing Invariants, Routing Tier Contract, Actions Injection Audit, Stall Detection Write Guard, Dockerfile Node Version
   - Ready to merge

2. **FB-0A1B06B3 (Deploy Promotion safety net)** — filed via BS "Describe a new feature" intake on `/build`. Currently `phase=ideate`. AI coworker is processing.

3. **FB-21AE3105 (Assurance Ledger)** — advanced past "Record Approve Start". Now sitting at design-doc-required gate.

## PR-cleanliness diagnosis

Mark said "no PR has gone in cleanly." Root cause **already diagnosed and partially fixed** by another session:

- The last 3 BS-generated PRs from `dpf/*` branches (#957, #961, #969) were all closed today 2026-05-22 07:03 with the same close-comment from Mark:
  > "The PR diff matches the same contaminated stale-sandbox shape seen in unrelated promoted PRs #957 and #961. CI is red across DCO, schema regression, typecheck, production build, routing invariants, and unit tests."
- **PR #973** (merged 07:06 today) added the contamination guard: `fix(build-studio): block contaminated promotion PRs` — Build Studio now blocks PR/contribution promotion when the sandbox source isn't promotable or the captured diff is missing files promised by the build plan, and it fixes generated GitHub commit author/committer metadata to match DCO signoff.
- **Upstream root cause not yet addressed**: WHY does the sandbox get contaminated in the first place? See FB-3CA106CC (baseline auto-refresh) and FB-1A414CB9 (sandbox lease ownership) in queue.

So the immediate blocker is resolved; the systemic cause needs FB-3CA106CC to land.

## Inventory of FB items

Total visible builds in `/build` list: 34. Grouped by actionability:

### A. Done outside BS — needs reconciliation (blocked on FB-7F8C7368 UX)

| FB | BI | Status | Notes |
|----|----|--------|-------|
| FB-B6A812EE | BI-5E53A265 | done | SSRF — likely closed by security PRs #977/#983. BS row never had a build branch. |
| FB-EA5EF46F | BI-7DB95878 | done | Command injection — same pattern, no BS branch. |

**Action when FB-7F8C7368 ships**: hit "Reconcile" on each, supply PR URL.

### B. Ready to Release but DO NOT DEPLOY

| FB | Why |
|----|-----|
| FB-7A21E1F6 | Promotion CP-8AD71684 is approved but sandbox diff is contaminated with unrelated snapshot churn (finance/routing/shared snapshots + FB-5222FED1's AgentBudgetEvent schema). Actual self-upgrade code shipped via PR #830. Executing would deploy contaminated state. **Need to reject CP-8AD71684 first** — no UX for that today. |

### C. Looks complete in BS, gated on integration-orchestrator promotion

| FB | Tasks done | Verification |
|----|-----------|--------------|
| FB-F50C65D2 (TopologyGraph wiring) | 4/4 | typecheck ✓, tests 1/0, acceptance 2/2 met, UX 2/2. Coworker says "release-gate handled by integration orchestrator." |

### D. Likely fake-complete (per FB-5D6F7000 anti-pattern)

| FB | Tasks "done" | Branch diff |
|----|--------------|-------------|
| FB-5222FED1 | 2/2 | `localSourceChangeCount=0` — tasks marked done but no actual commits on `build/FB-5222FED1`. Root cause for the crash diagnosed earlier. |
| FB-7A21E1F6 | 22/22 | branch exists with 8 commits but content is contamination, not self-upgrade. |

### E. In-progress (>=1 task done, no PR yet)

All 14 BS work capsules in `status=working`, `pullRequestUrl=null`, `headBranch=null`:

- FB-3CA106CC — BS: auto-refresh sandbox baseline to origin/main before new builds **[HIGH LEVERAGE — fixes A/B/D]**
- FB-9709981A — BS: pre-flight overlap sweep at ideate→plan promotion + before each PR push **[HIGH LEVERAGE]**
- FB-78E967D4 — Add Reset Build to clear contradictory buildExecState **[HIGH LEVERAGE — recovers stuck builds]**
- FB-7F8C7368 — Build Studio sync with externally-developed work + per-deliverable ownership **[HIGH LEVERAGE — fixes A/B]**
- FB-5D6F7000 — Fix Build Studio fake-task-complete **[HIGH LEVERAGE — fixes D]**
- FB-29395A74 — [SEC-CLEANUP] Workflow_dispatch shell injection
- FB-3320BCC3 — Build Studio Phase Stall Detection & Recovery
- FB-4261943C — /ops "+ Add item" modal silently fails
- FB-50582E8C — [postmortem-canary] Verify PR #947 ideate auto-dispatch
- FB-6BDCB12B — /ops coworker hallucinates create_backlog_item
- FB-72747E68 — /ops backlog list rendering bug
- FB-8D694FA6 — BS: hard-fail createBranchAndPR on empty prUrl
- FB-9706671B — astepGenerateCode dispatches wrong tools
- FB-A4DDCCC9 — External contribution governance bot reviewer
- FB-8093D8E1 — Security & quality findings → BS intake
- FB-A8D46002, FB-DDCB33C4, FB-F0476EF3 — EP-COST-001 telemetry (coworker says ready in plan phase)
- FB-1A465165 — Live verification of BI-6588414f slices 1+2
- FB-63E4F3CE — Persona Voice Layer & WWTD
- FB-71FB3A53 — Ollama primary local AI (PR #969 closed contaminated)
- FB-B33E84B5 — Build Studio layout redesign
- FB-C26D5B50 — WWMD MCP Exposure Sprint 1 umbrella
- FB-D3A746B3 — Build Studio UX redesign
- FB-F8528BF6 — [SEC-CRIT] GitHub Actions code injection
- FB-FB8B2EAA — Portal-wide hang from 9P scout dispatch
- FB-0999E0FE — Capability calibration before routing
- FB-21AE3105 — Assurance Ledger (now past Record Approve Start)
- FB-0A1B06B3 — Deploy Promotion safety net (filed this session)

## Queued issues / new findings

Things worth filing as BIs or as updates to existing BIs:

1. **"Reject Promotion" affordance missing in ReleaseDecisionPanel.** When a promotion is approved but evidence of contamination/mistake comes to light, there is no UX to reject `CP-*` before someone clicks Deploy. Today the only safety is server-side `status==='approved'` check (which is exactly what makes the bad promotion executable). Add a "Reject promotion" button next to "Deploy Promotion" + "Schedule Next Window", with a required rationale string. Surfaced by FB-7A21E1F6 contamination today.

2. **AI Coworker error on FB-7A21E1F6**: `Cannot read properties of undefined (reading 'map')`. Same family as the PR #985 fix but a *different* call site. Look for another `.map` over a buildPlan-derived field that runs in the coworker prompt-assembly path.

3. **Platform-update banner has no working action surface.** "Platform update vb5c6bb94... is ready. Review in Admin → Platform Development." Clicking the link lands on a page with no self-upgrade affordance (the Trigger / Apply UI lives at `/ops/self-upgrade`). Banner should link directly to the trigger surface, or the trigger surface should be embedded in `/admin/platform-development`.

4. **Self-upgrade recycling kills MCP and 503s server actions during in-session work.** Already in memory as [[project_self_upgrade_kills_in_session_ux]]; new observation: it specifically breaks `revalidatePath` calls in promotions/contribution paths, leaving `flowState` stale and Deploy Promotion button incorrectly re-enabled. Possible incremental fix: bump portal recycling cadence (current = every bundle hash change = every PR merge) to something like every N merges or maintenance window only.

## Recommended next moves for Mark

In priority order:

1. **Review & merge PR #985.** Clean two-line fix + test. Required before any further build-list clicking is safe.
2. **Reject promotion CP-8AD71684 manually** (until reject UX exists). Either via DB or a one-shot MCP `reject_promotion` call if that exists. Do NOT click Deploy Promotion on FB-7A21E1F6 — its sandbox is contaminated.
3. **Prioritize the substrate items** (FB-3CA106CC + FB-78E967D4 + FB-7F8C7368 + FB-9709981A + FB-5D6F7000) over feature work. Until these land, every other BS run will keep producing the same fake-complete and contamination patterns.
4. **After substrate lands**: re-dispatch each in-progress FB. Many of the 14 working capsules will need Reset Build to recover.

## What I did NOT do (and why)

- **Did not click Deploy Promotion on FB-7A21E1F6** — would deploy contaminated diff to production.
- **Did not open feature PRs** — per standing rule "Build Studio for ALL development; Claude opens maintenance PRs only." PR #985 falls in the maintenance carve-out (defensive crash guard); the Deploy-Promotion-safety work is a feature change and was filed as BS intake.
- **Did not reconcile DONE-outside-BS items via SQL/MCP** — that's the back-door path Mark explicitly excluded. The right path is FB-7F8C7368's Reconcile UX.
- **Did not drive each of 30+ builds individually through BS phases** — each requires multi-turn AI coworker dialog and the portal is recycling continuously due to self-upgrade. Better signal-to-noise was achieved by writing this triage.

Last updated: 2026-05-22 ~03:40 local.

# 2026-05-22 session — final status (post-handoff continuation)

Picks up from `docs/triage/2026-05-22-overnight-session-summary.md` (PR #987). Adds the substrate-fix wave Mark unblocked when he merged PR #985 and PR #990 mid-session.

## Headline

**The "no PR has gone in cleanly" root cause is fixed.** The sandbox container was running Alpine without `/bin/bash`. Every BS QA-phase agent dispatch was failing at "Claude CLI requires a POSIX shell environment" and silently degrading to static-analysis-only verification — that's what produced the contaminated/fake-complete diffs Mark closed PRs #957/#961/#969 for. PR #990 added bash + `ENV SHELL=/bin/bash`. The sandbox container was rebuilt; live verification now actually runs.

## What landed this turn (PRs)

| PR | Title | State |
|----|-------|-------|
| #985 | `fix(build-studio): guard undefined fileStructure on /build page` | **merged** by Mark |
| #987 | `doc(triage): overnight session summary 2026-05-22` | **merged** |
| #990 | `fix(sandbox): add bash to dpf-sandbox image (unblocks BS verification)` | **merged** by Mark |
| (this doc) | session-final-status.md | adds to PR series |

After #990 merged:
- Sandbox image rebuilt via `COMPOSE_PROJECT_NAME=dpf scripts/build-images.sh sandbox`.
- `dpf-sandbox-1` recreated against the new image.
- Verified: `docker exec dpf-sandbox-1 bash --version` → bash 5.3.3 live; `pnpm exec vitest run` succeeds inside the agent execution context for the first time.

## Reconciliations done this turn

Pulled the FB inventory + merged-PR catalog and mapped completed work to its BS rows.

### Backlog items moved to `status=done`

| BI | Title | Closed by | Resolution recorded |
|----|-------|-----------|---------------------|
| BI-044CFC38 | Assurance Ledger Phase 1 promote | PR #984 | commit identity confirmed (9f1afc194 = 7d1ce9d68) |
| BI-5940955C | [SEC-CRIT] GitHub Actions code injection | PR #962 (+ #944, #956) | all 5 actions-injection baseline entries closed |
| BI-D094AF1D | [SEC-CLEANUP] Workflow_dispatch shell injection | PR #962 | same cluster as BI-5940955C |
| BI-PIR-e9116e48 | "Cannot read properties of undefined (reading 'filter')" | PR #985 | live click-test on FB-5222FED1 confirms |
| BI-PIR-3d0ba6ec | /build runtime crash on undefined collection.filter | PR #985 | same root cause family |
| BI-PIR-cca00fdc | /build runtime crash on undefined.length | PR #985 | downstream of fileStructure guard |

### Backlog items where evidence was recorded (still open per operator decision)

| BI | Why kept open |
|----|---------------|
| BI-F8B05B66 | Canary verification of PR #947 ideate auto-dispatch — partially verified (dispatch fires; design doc successfully drafted on FB-0A1B06B3 this session). |
| BI-CAPSULE-SELFUPGRADE-001 | Feature shipped via PR #830 but promotion CP-8AD71684 is contaminated. Status held with `⚠️ DO NOT execute Deploy Promotion` warning until reject UX exists. |

### Work capsules moved to `status=complete`

WC-9D92AB3E (SSRF) · WC-422C04D0 (Cmd injection) · WC-37D56DAF (GH Actions code injection) · WC-546C70BD (Workflow_dispatch) · WC-E9E9E9A1 (Assurance Ledger) · WC-51F66F19 (fake-task-complete fix, PR #850) · WC-A52F24B6 (TopologyGraph wiring, FB-F50C65D2) · WC-86B47B0E (Portal self-upgrade, PR #830).

## FB-0A1B06B3 — Deploy Promotion safety net (filed this session)

Drove via the BS UX after sandbox-bash landed:

1. Filed via `/build` "Describe a new feature" intake.
2. Sent first message to coworker — first attempt errored (`.map` undefined). Substrate gap still exists in the coworker prompt-assembly path.
3. Second attempt succeeded after sending `Please draft the design document...` instructions. Coworker called `start_scout_research` 3× and produced a complete design doc covering:
   - Confirmation dialog with build + SHA + target environment preview
   - Optimistic client-side lock to prevent double-fire on stale flowState
   - Toast surfacing of server rejection messages
   - Shipped-state badge with deployed SHA + timestamp + actor
   - Data-pipeline extension to `PromoteFork` for deployedSha/deployedBy
   - 5 acceptance criteria covering double-click race, dialog cancel, rejection toast, shipped badge
4. Design review dispatched (`reviewDesignDoc`) at session end — still running when this doc was written.

**This is the first BS build this session to produce real evidence end-to-end on a fresh dispatch.** Confirms the bash + filestructure fixes unblocked the pipeline.

## Remaining queue

In-progress backlog items with active builds (post-reconciliation):

- BI-860603DA — External contribution governance bot reviewer (xlarge, multi-PR umbrella; PRs #936 #946 partial)
- BI-04701325 — Security & quality findings → BS intake (xlarge)
- BI-F8B05B66 — Canary verify PR #947 (evidence recorded, keep open)
- BI-CAPSULE-SELFUPGRADE-001 — Self-upgrade (⚠️ promotion needs reject)
- BI-07875BA4 — /ops backlog list rendering bug (no PR yet)
- BI-AD60D184 — /ops "+ Add item" modal (no PR yet)
- BI-3F7BF1E7 — Pre-flight overlap sweep (no PR yet)
- BI-08A6BA4D — Auto-refresh sandbox baseline (no PR yet)
- BI-1BB7408D — Coworker hallucinates create_backlog_item (no PR yet)
- BI-09810001 — BS hard-fail createBranchAndPR on empty prUrl (no PR yet)
- BI-308660B6 — Capability calibration (xlarge, ongoing)
- BI-WWMD-MCP-00 — WWMD MCP Sprint 1 umbrella

Plus working capsules without BIs: WC-DE1585DD, WC-D28B4D14, WC-014092D2, WC-9333CE68, WC-1A414CB9, WC-AC254D15, WC-CB2F510F, WC-3EA9D604, WC-BE178C8C, WC-2A6E36D2, WC-D5E4DF43, WC-8E7D69AF, WC-D0068F89, WC-17DC9A7B (=FB-0A1B06B3 active).

## Substrate gaps still real

1. **`recover_sandbox reset_from_main` is NOT IMPLEMENTED.** It returns `"blocked until the destructive reset workflow records a full incident."` — contaminated build branches cannot be cleared via MCP. Per-build branches remain stale (5500+ files vs origin/main).
2. **Coworker prompt assembly still has at least one `.map` undefined site.** First-message dispatch on FB-0A1B06B3 hit `Cannot read properties of undefined (reading 'map')` before recovering on a follow-up. Worth a hunting pass.
3. **AgentCoworker right-pane crash on FB-7A21E1F6** — same `.map` family. Visible in earlier session.
4. **Self-upgrade still recycles portal aggressively** mid-action (per [[project_self_upgrade_kills_in_session_ux]]). PR #976 deferred apply when operator session is active — verify behavior under heavy use.
5. **No "Reject Promotion" UX** — promotion CP-8AD71684 sits approved-but-dangerous with no UI to invalidate it.

## Recommended next moves for Mark

1. **Review and merge FB-0A1B06B3's design doc + plan** when the design-review pass completes. The coworker is actively producing on a working sandbox now.
2. **Reject promotion CP-8AD71684** (via DB or MCP — UX not yet built). Don't click Deploy Promotion on FB-7A21E1F6.
3. **Hunt the remaining `.map` undefined sites.** First-message coworker dispatch is brittle; once fixed, fresh-build throughput should climb sharply.
4. **Reset and re-dispatch the 13 working capsules without PRs.** With bash live, fresh dispatches will produce real diffs and pass real verification. The `reset_from_main` MCP action needs implementation (currently returns "blocked").
5. **Prioritize substrate items**: FB-78E967D4 (Reset Build), FB-7F8C7368 (external sync UX), FB-3CA106CC (baseline auto-refresh), FB-9709981A (pre-flight overlap sweep). Without these the substrate keeps producing the contamination pattern.

Last updated: 2026-05-22 ~14:18 local.

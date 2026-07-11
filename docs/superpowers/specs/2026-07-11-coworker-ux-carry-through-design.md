# AI Coworker UX Carry-Through — One Coworker Home, One Fleet Home, Retire the Duplicates

- **Epic:** EP-26E528F5 · **BIs:** BI-98329D0C (P1 record completion), BI-CF6D8C12 (P2 fleet home), BI-E7E33D9B (P3 retirement)
- **Capsule:** WC-3CCB41EC · **Branch:** `feat/coworker-ux-carry-through`
- **Date:** 2026-07-11 · **Author:** Claude Code (external surface), founder-directed
- **Kernel decisions (external_coding_agent profile, both high-confidence):**
  - Direction = **record-centric carry-through** (composite 9.88, margin 3.34) over new-hub / ops-map-first / chat-first.
  - Scope = **full carry-through, retirement IN scope and gating completion** (composite 10.00, margin 2.71) over record-only or retirement-only.

## 1. Problem

Founder walk-through (2026-07-11): working with AI coworkers means jumping across surfaces to see and edit one coworker's details. Verified fragmentation on `main` (ec8655e58):

1. **Golden-Triangle priority editable in 3 disconnected places** — org default at `/platform/ai/assignments` (`GoldenTrianglePriorityPanel`), per-coworker on the record Priority tab (`CoworkerPriorityControl`), and the chat composer dock (`CoworkerPriorityDock`).
2. **Proactivity editable ONLY in the chat dock** (`CoworkerPriorityDock.tsx` → `saveCoworkerProactivityPreference`); shown **read-only** in the chat profile panel (`CoworkerProfilePanel.tsx`); **absent from the coworker record** — an admin configuring a coworker cannot see or set it there.
3. **advise/act mode, page-edit assist, web access** exist only in the chat composer (`CoworkerPostureControl`); these are *deliberately conversation-scoped* (see §4.3) but nothing on the record explains that, so users hunt for them.
4. **Model routing spread across editors:** per-coworker `AgentModelRoutingCard` (record), fleet `AgentModelAssignmentTable` (`/platform/ai/assignments`), `/platform/ai/providers`; legacy `/routing` and `/model-assignment` are already redirects (good), but `/platform/ai/priority/outcomes` is a live outcomes surface orphaned from all navigation.
5. **Two rosters:** platform `/platform/ai/overview` (`RosterView`) and HR `/employee?view=workforce` (`WorkforceRosterPanel`) list the same fleet with different fields and no cross-links.
6. **Two competing tab definitions over `/platform/ai`:** the canonical `platform-nav.ts` AI Operations family and the dead-but-present `WorkforceTabNav.tsx` (zero page usages; component + test survive).
7. **The one true fleet directory is hidden:** `/platform/ai/overview` is not in `platform-nav.ts` subItems; `/platform/ai` deliberately lands on Readiness, not the workforce. The per-coworker record is reachable only through the roster or deep links.
8. **No UI at all** for coworker memory (EP-8C706944 owns projections) and lifecycle actions (EP-COWORKER-LIFECYCLE owns certification; the stage is display-only) — out of scope here, recorded for honesty.

### Why five prior attempts didn't fix it

Phase 7B (2026-03-13), Agent Panel Redesign (2026-03-14), EP-AI-WORKFORCE-001 (2026-04-02), EP-COWORKER-PANEL-UX (2026-06-23), EP-COWORKER-RT (#2461, 2026-06-26) each shipped real substrate — `Agent.displayName`/`kind`, the editable 6-tab record, the directory + workforce summary, per-coworker priority — and each **deferred the surface-retirement step** to bound blast radius. The pieces exist; nothing ever disappeared, so the felt cognitive load never dropped. This pass exists to do the deferred last step, plus close the record's remaining gaps. Retirement gates completion (kernel scope decision).

## 2. Research & Benchmarking

Benchmarked (2026-07-11, primary docs fetched): **commercial** — Salesforce Agentforce (Studio + Command Center), Microsoft Copilot Studio, OpenAI GPTs/workspace-agents admin, Intercom Fin, HubSpot Breeze; **open-source** — CrewAI (+ AMP console), Dify, Flowise, LangSmith/LangGraph Studio. Full trail in the epic's research record.

**Patterns adopted:**
- **Roster → profile click-through; the profile is ONE tab-set covering the whole lifecycle** (Copilot Studio Build/Preview/Evaluate/Monitor; Agentforce Builder + Observe; Dify Orchestrate/Overview/Logs). No benchmarked product scatters one agent's config across admin areas — concerns are columns/tabs, not destinations. → the record stays the single per-coworker home; we complete it.
- **Two altitudes, cleanly split but linked:** fleet observability (Command Center, LangSmith registry) vs agent configuration, with one-click drill-down. Recurring fleet columns: status, health, usage, **last activity**, cost. → `/platform/ai/overview` becomes the nav-anchored fleet home and gains a last-activity signal; Readiness/Operations Map remain the health altitude, one click away.
- **Plain-English section labels** (HubSpot's "What this agent can do / knows"): our record copy explains proactivity and where conversation controls live in user language.
- **Monitoring closes the loop into configuration** (Intercom Optimize, Dify annotations): already present in DPF (Needs & Playbooks, corpus growth gaps) — preserved, not duplicated.

**Patterns rejected:**
- **New parallel hub surface** (rejected by kernel too): Copilot Studio's classic-vs-new dual experience shows parallel surfaces double cognitive load. We retire, not add.
- **Config-as-canvas** (Flowise/Dify node view) for management: great for authoring, terrible for "what can this coworker do, is it healthy" — DPF keeps the declarative record.
- **Chat-first management:** no benchmark manages agent config primarily through conversation; settings need a stable, auditable home.

**Anti-patterns identified (and their DPF mirror):**
- OpenAI's governance-only admin (list + delete/approve, no unified profile) ⇒ exactly the DPF risk if grants/routing lived only in fleet grids — the record must show config + activity together (it does; we finish it).
- Fragmenting per-concern admin pages across the app ⇒ the current `/platform/ai/*` sprawl; addressed by retirement + nav integration.
- Analytics without recourse ⇒ the orphaned `/platform/ai/priority/outcomes`; addressed by linking it from the Priority & Models surface it calibrates.

**Gap this design fills vs benchmarks:** none of the eight products handles *per-user* proactivity preferences on a shared agent; DPF's proactivity is a per-viewer setting (`UserFact`), so the record labels it "your setting for this coworker" instead of pretending it's global (§4.2).

## 3. Design principles

1. **One durable home per altitude.** Per-coworker durable settings live on the record. Fleet-wide defaults and guardrails live at Priority & Models. Conversation-scoped switches live in the composer. Every other editor of the same value must be the *same component* or a link.
2. **Functional equivalence.** No capability is removed. Every retired surface redirects; every relocated control writes the same server action/store as before.
3. **Concerns are tabs/columns, not destinations.** New information appears on existing surfaces; zero new top-level routes.
4. **Progressive disclosure.** Roster rows stay scannable (identity + status chips); live signals are compact; detail lives one click down on the record.

## 4. Target design

### 4.1 Fleet altitude — one workforce home

- `platform-nav.ts` AI Operations family gains **"Workforce" → `/platform/ai/overview` as the FIRST subItem**; `/platform/ai/page.tsx` redirect flips from `/platform/ai/readiness` to `/platform/ai/overview`. The AppRail "AI Workforce" entry then lands on the actual workforce. Readiness remains the second tab (health altitude), unchanged.
- **RosterView rows gain a last-activity signal** (`lastActiveAt` on `RosterRow`, one grouped query over `AgentMessage` per load; rendered via the shared `LocalTime`/relative-time affordance). This is the fleet-scale "what are they doing" signal (relates to BI-D80A1C3E without expanding into a full activity feed here).
- Roster rows already deep-link to the record (click-through pattern) — verified, kept.

### 4.2 Individual altitude — complete the record

- Record **Priority tab → "Priority & Autonomy"** (id stays `priority`; label + content change):
  - Existing `CoworkerPriorityControl` (Golden Triangle with inheritance provenance) — unchanged.
  - **New: Proactivity** — the *same* `ProactivityLevelControl` used by the chat dock, wired to the *same* `get/saveCoworkerProactivityPreference` actions, labeled **"Your proactivity for this coworker"** (it is a per-viewer `UserFact`, not an org-global — honest labeling per §2 gap).
  - **New: "In the chat" explainer card** — states that advise/act mode, page-edit assist, and web access are per-conversation switches that live in the chat composer, with the reason (session-scoped safety posture), so users stop hunting for a global toggle that intentionally doesn't exist.
- **Chat profile panel proactivity becomes editable** (`CoworkerProfilePanel`): the read-only display is replaced by the same shared control + save action used by the dock 20px below it — one behavior, one component. Panel also gains **"Open full record"** linking to `/platform/ai/agent/[agentId]`, closing the chat → admin jump.
- `RecordActionsMenu` "Authority & tool grants" href fixed to `/platform/ai/authority` (currently points at `/platform/ai`, which redirects to Readiness — a dead-end teleport).

### 4.3 What deliberately stays where it is

- **advise/act, page-edit, web access:** conversation-scoped by design (`AgentCoworkerPanel` state + `resolveCoworkerRuntimeMode`); a durable per-coworker default would change runtime semantics — out of scope, explained in-product by the §4.2 card.
- **Fleet guardrail grid** (`AgentModelAssignmentTable` at Priority & Models): the legitimate bulk-editing altitude; record's routing card is the per-coworker view of the same config.
- **HR roster** (`/employee?view=workforce`): different altitude (humans + AI together); its agent rows gain a deep link to the record instead of being merged away.

### 4.4 Retirement (the step prior passes deferred)

| Surface | Action |
| --- | --- |
| `WorkforceTabNav.tsx` + test | **Delete** (zero usages — dead competing nav) |
| `/platform/ai` landing on Readiness | Redirect target → `/platform/ai/overview` (workforce home) |
| `/platform/ai/priority/outcomes` | Verified already linked from Priority & Models ("See outcomes →") — no change needed |
| `RecordActionsMenu` → `/platform/ai` dead-end | Points at `/platform/ai/authority` |
| Chat profile panel read-only proactivity | Replaced by the shared editable control |
| HR roster agent rows (no link) | Deep link to the coworker record |

`/platform/ai/routing`, `/platform/ai/model-assignment`, `/platform/ai/priority` already `permanentRedirect` to canonical homes — no action, recorded as verified.

## 5. Out of scope (recorded, not forgotten)

- Coworker **memory UI** — EP-8C706944 owns projections; the record is its future mount point.
- **Lifecycle actions** (establish/certify/promote) — EP-COWORKER-LIFECYCLE; stage stays display-only.
- **Duplicate roster identities** (two COOs, two Build Leads, …) — data/seed defect filed as BI-74FD6420.
- Org-wide autonomy envelope (`BusinessContextForm`) — a ceiling, not a per-coworker setting; unchanged.

## 6. Verification plan

- Unit: nav config test (Workforce first subItem, no dead hrefs), RosterRow lastActive mapping, record tab render with proactivity control, profile-panel save path.
- Gates: worktree typecheck + scoped vitest; `pnpm run pregate` (local-CI sandbox) for the merged-code gate.
- UX: drive `/platform/ai` → workforce home → record → Priority & Autonomy (set proactivity) → chat dock shows the same value; chat profile panel edit + "Open full record"; every retired/redirected URL resolves.

## 7. UX-Fit decision

Scored via `principle_decide` on `human_cognitive_load` (see PR trailer `UX-Fit-Decision:`): extending the existing Priority tab beat adding a ninth record tab and beat surfacing proactivity on Overview — progressive disclosure keeps the record's tab count stable and puts both behavior dials (priority, proactivity) on one pane.

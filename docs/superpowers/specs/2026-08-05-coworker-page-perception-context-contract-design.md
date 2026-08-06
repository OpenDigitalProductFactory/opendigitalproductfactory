# Coworker Page-Perception: Page-Owned Context Contract — Design

**Status:** Draft for kernel decision + founder review
**Date:** 2026-08-05
**Related epics:** EP-8C706944 (Coworker Memory & Context Architecture), EP-0AF96937 (Decision Governance)
**Related memory:** `coworker-page-perception-agency-gap`, `coworker-memory-architecture-epic`

---

## 1. Problem

An operator on the **Self-Upgrade** page (`/ops/self-upgrade`) asked the coworker *"what's this background job issue?"* — pointing at the on-screen **"Background jobs need attention"** Inngest alert. The coworker answered with a **backlog summary** (234 open items, 20 in-progress, 424 done, an epic list) — data with nothing to do with the page in front of the operator.

This is not a one-off model error. It is the visible symptom of a structural gap: **the coworker's knowledge of "what page am I on" is maintained centrally, apart from the pages themselves, as a coarse allow-list.** Every new page ships blind — or, worse, confidently mislabeled — until someone hand-wires a provider in a central file.

### 1.1 Exact causal chain (grounded)

Three failures stacked; only the first is architectural.

1. **Mislabel by prefix fallthrough (root cause).** `/ops/self-upgrade` has no context provider. Route resolution is **longest-prefix match**, so it fell through to the `/ops` provider `getOpsContext` ([`route-context.ts:417`](../../../apps/web/lib/tak/route-context.ts)), which injects *"PAGE DATA — Operations Backlog"* (backlog items + epics). That block **is** the answer the operator saw. The coworker was told it was on the Backlog page.
2. **Local-model turn couldn't self-correct.** The turn fell to the bundled local model (`buildLocalFallbackBanner`, [`downgrade-explanation.ts:151`](../../../apps/web/lib/routing/downgrade-explanation.ts)) because configured providers were ineligible for the data sensitivity/capability. On local, the tool surface is capped/skipped at 15 tools ([`fallback.ts:261`](../../../apps/web/lib/routing/fallback.ts)), so the model could not call a read tool to check itself — it answered straight from the mis-scoped PAGE DATA block, which survives arbitration as L1/compressible.
3. **The page is unreadable even on a healthy turn.** The "Background jobs need attention" data comes from `getJobEngineHealth` ([`job-engine-health.ts:202`](../../../apps/web/lib/queue/job-engine-health.ts)). **No MCP tool exposes it.** Self-upgrade status *does* have read tools (`get_self_upgrade_queue_status`) but they require the non-baseline `release_plan_read` grant. So the specific thing the operator pointed at is unreadable regardless of perception.

---

## 2. Current architecture (as-is)

```
AgentCoworkerPanel.tsx     usePathname() → effectiveRoute (routeContextOverride can mask it)
  │  POST /api/agent/send { routeContext }
  ▼
agent-coworker.ts          getRouteDataContext(route, userId)              [sendMessage :735]
  ▼
route-context.ts           longest-prefix match vs ROUTE_CONTEXT_PROVIDERS (18 of ~286 routes)
                             · match    → provider RE-FETCHES data for that prefix
                             · no match → buildDefaultRouteContext = static page-NAME label only
  ▼  wrapped "--- PAGE DATA ---", tier L1, priority 1, compressible (~1500-char floor)
arbitrate(contextSources)  token budget by inferred model tier; PAGE DATA may compress or drop
  ▼
prompt-assembler.ts        emits the "--- PAGE DATA ---" block into the system prompt
```

Agency side: ~357 MCP tools in 78 packs, of which only **5 are baseline** every coworker inherits — `registry_read`, `file_read`, `document_read`, `code_graph_read`, `work_capsule_read` ([`agent-grants.ts:93`](../../../apps/web/lib/tak/agent-grants.ts)). Everything else is opt-in per role.

### 2.1 The 18 enrolled route prefixes

`/platform/ai`, `/platform/ai/providers`, `/platform/tools/discovery`, `/ops/dev-loop`, `/ops`, `/compliance/licensing`, `/compliance`, `/workspace`, `/finance`, `/portfolio/product`, `/portfolio`, `/inventory`, `/employee`, `/build/work`, `/build`, `/storefront`, `/customer/funnel`, `/coworker-decisions`. Everything else → static name label.

---

## 3. The structural flaws

Perception fails on **two independent axes**, both rooted in *centralization decoupled from the page*:

| Axis | As-is | Consequence |
|---|---|---|
| **Coverage** | 18/286 routes enrolled; sub-routes inherit the parent prefix's provider | `/ops/self-upgrade`, `/ops/patches`, `/ops/journeys`, `/ops/changes`, `/ops/promotions`, `/ops/security` all inherit *"you're on the Backlog."* ~268 routes get only a page *name*. |
| **Fidelity** | Providers **re-fetch** in `route-context.ts`, disconnected from what `page.tsx` rendered | The Self-Upgrade page already computed `jobEngine`, `ownerReleaseSummary`, the local-changes ledger — the coworker sees none of it and gets a re-derived guess. |
| **Agency parity** | No convention that a governed surface ships a matching read/act tool; no CI guard | Inngest job-engine health, retention-sweep state, impact summary have UI + server actions but **zero MCP tools**. |

**The deep problem:** the page and the coworker's knowledge of the page are maintained in two different files by two different mechanisms. Prefix-inheritance of *data* means a page can be actively lied to about its own identity. This is why five prior coworker-UX passes never closed it and why the operator still hits it.

The read-baseline comment states the intended invariant — *"a coworker must have complete visibility of the page it is on"* ([`agent-grants.ts:68-92`](../../../apps/web/lib/tak/agent-grants.ts)). Today that invariant is aspirational, not enforced.

---

## 4. Goals / Non-goals

**Goals**
- G1. A coworker's page context is the *same data the page rendered* — one source of truth, no re-fetch, impossible to mislabel.
- G2. A page with no declared context resolves to its own static name label — **never** a sibling's data.
- G3. Every governed data surface ships a matching read tool, enforced at build time.
- G4. Baseline coworkers can *see the page they are on* without a per-role grant, honoring the stated invariant.
- G5. Closing the ~268-route blind spot is by construction, not by hand-enrolling each route.

**Non-goals**
- Changing the arbitration/token-budget model (orthogonal; PAGE DATA priority stays L1).
- Changing the local-fallback tool cap (tracked separately; the mislabel is fixed regardless of model tier).
- Redesigning the coworker chat UX or memory lifecycle (EP-8C706944 P1–P4 already shipped).

---

## 5. Options considered

Per `dpf-brainstorming`: three architecturally-distinct candidates, grounded in existing substrate. **The kernel decision (`principle_decide`) has not yet run** — the dpf MCP is not connected in this authoring session. Options are laid out with tensions for scoring; §5.4 is the author's provisional recommendation pending kernel ratification.

### Option A — Point-fix + keep the central registry (minimal)
Carve out a `/ops/self-upgrade` provider (and the other five `/ops/*` orphans), exactly as `/ops/dev-loop` was fixed (BI-FD7E4D72). Add the missing Inngest-health read tool.
- **Wins:** smallest blast radius; unblocks this page today; matches an established precedent.
- **Loses:** does not fix the architecture — the 269th route is still born blind; the fidelity gap (re-fetch vs page's own data) persists; the treadmill of hand-enrolling routes continues. Fails G1, G3, G5.

### Option B — Page-owned context contract (durable rebuild) — *recommended*
Invert the model: **each page declares the context it already computed.** The central registry becomes a fallback for un-migrated legacy routes, not the primary path. Add exact-route resolution (no data inheritance) and a surface→tool parity CI guard.
- **Wins:** satisfies G1–G5; eliminates re-fetch drift; blind-by-default becomes name-label-by-default (safe) and rich-by-page (correct); one place to reason about a page.
- **Loses:** larger up-front refactor; requires a migration path for the 18 existing providers; touches a hot-ish file (`route-context.ts`).

### Option C — Runtime DOM/props scrape (reuse the render)
Have the client serialize the page's rendered props / a structured snapshot and ship it as `routeContext` payload, so perception is literally "what's on screen."
- **Wins:** maximal fidelity with near-zero per-page authoring; genuinely "sees the screen."
- **Loses:** sends potentially sensitive rendered data to the model uncontrolled (sensitivity-classification and data-governance blast radius); payload size vs token budget; brittle to DOM churn; hard to govern which fields leave the browser. Tension with the sensitivity/clearance model that caused the local fallback in the first place.

### 5.4 Provisional recommendation
**Option B**, with **Option A as its Phase 1** (the point-fix is the first vertical slice of the contract, not a competing path — same shape as the `both_phased` kernel verdict recorded for this problem class in the `coworker-page-perception-agency-gap` memory). Option C's fidelity is attractive but its data-governance cost is high; fold its "use what the page rendered" instinct into B's contract (the page *chooses* what to expose, server-side, governed) rather than scraping the DOM.

**Kernel gate:** run `principle_decide` over {A, B, C} with dimensions including *Architecture Over Shortcuts*, *blast radius*, *diversity-of-thought*, and the data-sensitivity commandment (relevant to C) before committing. Record the ledger ID in this doc.

---

## 6. Proposed design (Option B)

### 6.1 The contract
Each page (or route segment) optionally exports a co-located `pageCoworkerContext` that returns the same structured data the page rendered:

```ts
// apps/web/app/(shell)/ops/self-upgrade/coworker-context.ts   (co-located with page.tsx)
export const coworkerContext: PageContextProvider = {
  route: "/ops/self-upgrade",
  label: "Self-Upgrade",
  build: async ({ userId }) => {
    const status = await getSelfUpgradeStatus();        // the SAME call the page makes
    return {
      summary: describeSelfUpgradeForCoworker(status),   // running/available/queued + jobEngine health
      // names the tools the coworker should call to go deeper
      readTools: ["get_self_upgrade_queue_status", "get_job_engine_health"],
    };
  },
};
```

- **Single source of truth.** The provider calls the page's own loader; it cannot drift from what the operator sees.
- **Discovery, not central registration.** A route-manifest step (the existing `build-route-manifest.ts` pattern) collects declared `coworkerContext` modules so `route-context.ts` no longer needs to know every route by hand. Migrating the 18 existing providers into co-located modules is mechanical.

### 6.2 Resolution: exact-route, no data inheritance
`getRouteDataContext` resolves by **exact declared route** (or an explicitly declared prefix that opts in to sub-route inheritance). A route with no declared context resolves to `buildDefaultRouteContext` (static name label) — it **never** inherits a sibling's PAGE DATA. This directly kills the `/ops/self-upgrade → /ops` mislabel and every instance of that class.

### 6.3 Surface→tool parity guard (G3)
Extend the existing `tool-registry.test` invariant (which today asserts grant-coverage and no duplicate packId) with a **surface-coverage** assertion: a governed data surface that declares a `coworkerContext.readTools` list must reference tools that exist in the registry, and a lint/CI check flags a declared surface whose rendered data has no backing read tool. Ship the missing `get_job_engine_health` read tool as the first instance (wrapping `getJobEngineHealth`), plus a retention-sweep read.

### 6.4 Baseline "see my own page" grant (G4)
Add a narrow, read-only baseline capability so a coworker can read the *page it is currently on* (scoped to the declared `readTools` for the active route), honoring the stated invariant without granting broad `release_plan_read`. Sensitivity classification still applies — this widens *page-scoped read*, not clearance.

---

## 7. Phasing

- **Phase 1 (point-fix / first slice):** `/ops/self-upgrade` co-located `coworkerContext` + `get_job_engine_health` read tool + carve out the other five `/ops/*` orphans. Unblocks the reported incident. Small.
- **Phase 2 (contract + resolution):** introduce `PageContextProvider` type, manifest discovery, and exact-route resolution (no data inheritance). Migrate the 18 existing providers to co-located modules. Refactor / large.
- **Phase 3 (parity guard):** CI surface→tool coverage assertion; baseline page-scoped read grant. Chore / med.
- **Phase 4 (sweep):** enroll high-traffic un-migrated routes; dashboards for perception coverage. Ongoing.

Phases 1 and 2 map onto the two BIs already filed under EP-8C706944 ((c) per-page registry every page contributes to; (d) BI-F9204A97 governed-tool convention + guard). **Verify those BIs are still open against the live backlog before filing new ones** (per project memory they were filed-not-shipped; only point-fixes landed).

---

## 8. Verification
- Unit: `getRouteDataContext("/ops/self-upgrade", …)` returns Self-Upgrade context, **not** backlog — a regression test that reproduces the incident FIRST (per `dpf-tdd`).
- Unit: an un-declared route returns the name-label fallback, never a sibling's data.
- CI: surface→tool parity assertion fails when a declared surface references a non-existent read tool.
- Live: on `/ops/self-upgrade`, ask "what's this background job issue?" and confirm the coworker describes the Inngest job-engine health (functional verification per `dpf-verify-on-live-install`; structural pass is not verification).

## 9. Risks & mitigations
- **`route-context.ts` churn / conflict treadmill** — mitigate by moving providers *out* into co-located modules (reduces central-file edits over time).
- **Migration regressions for the 18 enrolled routes** — golden test per migrated provider asserting output parity before/after.
- **Option C temptation (DOM scrape) creeping in** — the contract exposes server-chosen, governed fields only; no raw rendered payload leaves the browser.
- **Sensitivity** — page-scoped baseline read must not widen clearance; sensitivity classification remains the gate.

## 10. Open questions (kernel / founder input)
1. Kernel: score {A, B, C}; confirm `both_phased` (A as slice of B) vs full-B-now. Record ledger ID.
2. Founder governance: should there be a kernel *principle* banning perception allow-lists (flagged in prior memory as needing WWMD, not autonomous) — i.e. "every governed surface is perceivable and actable by construction"?
3. Should a golden-journey **page-comprehension probe** be added (ask each enrolled page a canned question; assert the answer is about that page)?

## 11. References
- `apps/web/lib/tak/route-context.ts` — provider registry, longest-prefix match, default fallback
- `apps/web/lib/actions/agent-coworker.ts:735` — `getRouteDataContext` call + arbitration wrap
- `apps/web/lib/tak/prompt-assembler.ts` — `--- PAGE DATA ---` emission
- `apps/web/components/agent/AgentCoworkerPanel.tsx` — client `routeContext` capture
- `apps/web/lib/mcp/packs/self-upgrade-pack.ts`, `apps/web/lib/queue/job-engine-health.ts` — self-upgrade read tools + the unexposed job-engine health
- `apps/web/lib/tak/agent-grants.ts:93` — read baseline; `:68-92` stated invariant
- `apps/web/app/(shell)/ops/self-upgrade/page.tsx` — the page whose data the coworker cannot see
- Prior art: `/ops/dev-loop` carve-out (BI-FD7E4D72), `/wiki` provider + default fallback (PR #2768, #2777)

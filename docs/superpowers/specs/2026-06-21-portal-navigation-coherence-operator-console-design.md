# Portal Navigation Coherence & Operator Console Design

| Field | Value |
| --- | --- |
| Status | Draft — ready for founder/architect review; keystone slice in flight |
| Date | 2026-06-21 |
| Owner | Mark Bodman |
| Author | Claude (Opus 4.8) |
| Scope | Internal portal navigation: cross-context jumps, secondary-nav coherence, taxonomy reconciliation, dev-loop/self-upgrade refiling, global breadcrumb, worker/operator mode, cognitive-load reduction |
| Out of scope | External customer `/portal` auth, permission/role changes, deleting routes (redirect classification only), archetype worker-home content (owned by EP-REDUCTION-GEAR-ARCH workspace-home slices) |
| Supersedes | The navigation-consolidation portion of `docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md` (the "later slices" deferred by the done `BI-CD6EE9D8`). Inherits its evidence and standards. |
| New epic | `EP-NAV-COHERENCE` (created this pass; nav IA was previously bolted onto the unrelated `EP-REDUCTION-GEAR-ARCH`) |
| Anchor code | `apps/web/lib/navigation/portal-navigation-model.ts`, `apps/web/lib/govern/permissions.ts`, `apps/web/components/shell/AppRail.tsx`, `apps/web/components/platform/platform-nav.ts`, `apps/web/components/admin/admin-nav.ts`, `apps/web/components/ops/OpsTabNav.tsx` |

## Executive Verdict

The portal already shipped the **typed canonical navigation model** (`portal-navigation-model.ts`, Phase 0 of the 2026-06-05 audit, `BI-CD6EE9D8` done). What never shipped were the *behavioral* slices that model was meant to enable — the audit's own note on that done item reads: *"Later slices handle labels, redirects, layout nav, platform/admin boundary, worker/operator shell context, bridges, and archetype pilot UX."* None of those were filed as backlog items. The felt problems the founder reports today are precisely those un-shipped slices.

Three structural defects produce every symptom:

1. **Cross-context teleports with no trail back.** A secondary-nav *tab* can jump the user into a different route tree that renders a different secondary nav, and there is **no global breadcrumb anywhere in the shell**. The named example — Platform Hub → "Core Admin" → `/admin` — is a tab that swaps the entire tab row to Admin's families with no "Platform" tab and no breadcrumb. The audit named this exact pattern: *"a cross-context jump disguised as a sibling tab."*
2. **One rail item is a junk drawer of unrelated workflows.** `/ops` is labelled "Backlog" in the rail but its tab row is `Backlog · Improvements · Changes · Promotions · Self-upgrade · Dev Loop` — mixing delivery intake with platform-runtime operations. Self-upgrade (the platform deploying *itself*) and Dev Loop (build-runtime coordination) have no conceptual business under "Backlog."
3. **Three divergent taxonomies for the same surfaces, and an always-on flat rail.** Every surface is grouped three different, disagreeing ways; the rail renders ~25 links fully expanded for an operator; and the worker/operator mode the model was built to support was never wired.

The resolved direction (founder-directed, this pass): **one operator console** with a single shared secondary nav and a **global breadcrumb** so platform/admin movement never feels like leaving; **Backlog returns to a pure delivery queue** with self-upgrade/changes/promotions refiled to a console "Runtime & Releases" family and dev-loop refiled under Build Studio / Build Runtime; **the three taxonomies collapse to one** canonical grouping derived from the existing model; and **worker/operator mode + a condensed rail** land as the cognitive-load payoff.

## Founder Directive (2026-06-21)

> "I'm looking at the platform hub, navigating just fine. Then I get to core admin, but now I'm no longer in platform hub, I'm in admin. What happened? … you took them entirely out of context into another one with no valid reason and no way to navigate back."

> "Under the backlog, we have the self upgrade? This doesn't make sense … The rest of the dev loop is more under the build studio, where the work actually happens, or in the AI coworker, where we choose the worker LLM."

> "Review all navigation paths, let's make the process and UX consistent and conformant to typical design of a platform of this caliber. We also are on a path to eliminate human cognitive load where possible … make complexity hidden and more condensed and automated."

Mapping: complaint 1 → root cause 1 (teleport + no breadcrumb). complaint 2 → root cause 2 (junk-drawer rail item). "consistent / conformant / cognitive load" → root cause 3 (taxonomy + flat rail + dead mode).

## Evidence (code-grounded, 2026-06-21)

### Confirmed: the Platform→Admin teleport is live

- `apps/web/components/platform/platform-nav.ts:104-111` — `PLATFORM_FAMILIES` still contains a 6th family `{ key: "admin", label: "Core Admin", href: "/admin", subItems: [{ "Admin Home", "/admin" }] }`.
- `apps/web/components/platform/PlatformTabNav.tsx` renders those families as the platform tab row. The "Core Admin" tab points at `/admin`.
- `apps/web/app/(shell)/admin/page.tsx` renders `AdminTabNav`, whose families (`apps/web/components/admin/admin-nav.ts`: Access · Organization · Configuration · Advanced) **do not include any "Platform" tab**. The platform tab row is gone; the user cannot climb back within the secondary nav.
- `apps/web/components/shell/Header.tsx` — the shell header has **no breadcrumb and no nav** beyond a logo link to `/workspace`. The only persistent nav is the left `AppRail`.
- Breadcrumb audit: only `components/product/ProductHeader.tsx` and `components/portfolio/PortfolioNodeDetail.tsx` render local breadcrumbs. **No global/shell breadcrumb exists.**

### Confirmed: self-upgrade + dev-loop filed under "Backlog"

- `apps/web/lib/navigation/portal-navigation-model.ts:374-387` — the `backlog` record is labelled **"Backlog"**, path `/ops`.
- `apps/web/components/ops/OpsTabNav.tsx` — tabs are `Backlog · Changes · Promotions · Self-upgrade · Dev Loop` (Improvements was retired into the Backlog tab upstream per EP-INTAKE-UNIFY — improvements are now backlog items surfaced via the "Improvement" origin).
- Page intents (read this pass): `/ops/dev-loop` = runtime coordination map (worktree leases, sandbox targets, heartbeats — build-runtime substrate); `/ops/self-upgrade` = portal image/SHA self-deploy lifecycle; `/ops/promotions` = release/version promotion; `/ops/changes` = RFC/rollback; `/ops/improvements` = improvement proposals → backlog intake.

### Confirmed: three divergent taxonomies + dead mode

- **`domain`** (7): `workspace · business · delivery · platform · admin · knowledge · customer` (`portal-navigation-model.ts:14-21`).
- **`shellNav.sectionKey`** (5 rail groups): `workspace · business · products · platform · knowledge` (`govern/permissions.ts:177-203`).
- **`WORKSPACE_SECTION_BLUEPRINTS`** (3 workspace-launcher groups): `ai-control · product-oversight · business-operations` (`govern/permissions.ts:215-239`).
- They disagree. Examples: **Build Studio** is `domain=delivery`, rail `sectionKey=platform`, blueprint `ai-control`. **Backlog** is `domain=delivery`, rail `products`, blueprint `product-oversight`. **Admin** is `domain=admin`, rail `platform`, blueprint `ai-control`.
- **Mode is dead:** `PortalAudienceMode = worker|operator|customer|diagnostic` exists and every route carries `audienceModes`, but `AppRail.tsx` renders a single flat role-filtered rail (all sections, fully expanded) and `getShellNavSections` takes no mode. The audit's Phase 3 (`WorkspaceShellContext` with `showOperatorSwitch`) was never built.

### Already done (do not redo)

Duplicate *routes* mostly already redirect (Phase 5 partially landed): `/admin/prompts→/platform/ai/prompts`, `/admin/skills→/platform/ai/skills`, `/admin/backlog→/ops`, `/platform/integrations→/platform/tools/catalog`, `/platform/services→/platform/tools/services`, `/admin/business-context→/storefront/settings/business`, `/admin/operating-hours→/storefront/settings/operations`. The *duplicate-route* debt is mostly retired — but see the route census below: the *coverage* debt is large and new.

### Route census — the canonical model is not canonical for routes (2026-06-21)

A structural cross-reference of every App Router `page.tsx` against the canonical `portal-navigation-model.ts` (`scripts/nav-route-census.mjs`, throwaway analysis):

- **291 page routes** total; **261** under `(shell)`. The canonical model declares only **63 paths** (3 of them legacy-redirect).
- Classification of all page routes: **61 in the canonical model · 68 dynamic/detail · 37 redirect shims · 125 ORPHANS** (static routes, not in the model, not redirects).
- **125 `(shell)` orphans** are reachable by URL but invisible to the canonical model — so the new breadcrumb title-cases their labels (no modeled parent chain) and any "derive the rail from one model" work (P3) would miss them. They cluster in the domains that own their own *parallel* nav models: **finance (39)** (whole invoices/bills/banking/reports tree), **platform (22)** (runtime-health, founder-review, edge-nodes, device-catalog, change-lanes, every `tools/integrations/<provider>` page), **admin (14)** (settings, branding, reference-data, diagnostics, backups, hive, … — Admin's entire body is model-invisible), **compliance (14)**, **storefront (6)**, **ea (5)**, **ops (5)**, **customer/marketing (4)**.
- **Odd singletons:** `/complaints` and `/inventory` are top-level `(shell)` routes with **no nav entry anywhere**. `portfolio/product/[id]` **and** `portfolio/products/[productId]` are **two parallel product-detail trees** — a route-level duplicate.
- **37 redirect shims, only 3 classified** as `legacy-redirect` in the model (e.g. `/platform/ai/{authority,history,operations,routing}`, `/storefront/{items,sections,units}`, `/workspace/{calendar,my-queue}` are unclassified redirects).
- The two "dead model entries" the census flagged (`/portfolio`, `/docs`) are **false positives** — both are served by `[[...slug]]` catch-all routes.

**Conclusion:** the model is a hand-curated *subset* (rail + breadcrumb seeds), while the real route taxonomy lives in **N per-domain parallel nav models** (`finance-nav.ts`, `ComplianceTabNav`, `EaTabNav`, …) that never register into it. This is root cause 3 ("divergent taxonomies") seen at the route level — and it is bigger than three taxonomies. P3 must therefore not just reconcile three lists but **bring every real route under one registered model**, and a **route/nav inventory gate** (the 2026-06-05 audit's Phase 0 that `BI-CD6EE9D8` only half-built) must fail CI on any new orphan or unclassified redirect.

### SysML / EA graph — navigation is not a first-class surface (the structural prize)

The platform already projects its surfaces into the SysML/EA architecture graph (Parity Engine, `EP-PARITY-ENGINE`), so structural and impact analysis should run *there*, not in a one-off script. Interrogating the live graph (`get_code_graph_freshness`, `query_ontology_graph`, `trace_code_surface`, `search_code_graph`, `explain_blast_radius`) shows:

- **The route TREE is modeled.** `apps/web/lib/ea/route-extract.ts` projects the full Next.js route tree into SysML — an "Application Routes" `Package` containing `Part Definition` nodes nested by URL segment via `contains`, derived from a build-time manifest "so the UX/navigation architecture cannot drift." `trace_code_surface({route})` resolves any route to its `IMPLEMENTS_ROUTE` files (e.g. `/admin` → its `layout.tsx` + `page.tsx`, **0 related tests**). The code graph also models `portal-navigation-model.ts` itself (symbols `PortalDomain`/`PortalNavRecord`/…, with `govern/permissions.ts` importing it).
- **The NAVIGATION surface is NOT modeled.** The extractor suite has `route-`, `process-`, `mcp-authority-`, `scheduled-job-`, `value-stream-`, `data-model-` extractors — but **no `navigation-extract`**. The route projection is a *containment tree only*: it records that `/ops/self-upgrade` exists under `/ops`, but **not** that it is reachable from a nav tab, nor which nav entry points to it, nor that a tab crosses a domain. `explain_blast_radius("Application Routes")` returns *no estate item* — routes aren't even wired into the dependency/impact model.
- **Therefore the graph cannot answer the very questions this epic asks** — "which routes have no nav entry (orphans)?", "which nav tab is a cross-domain teleport?", "what is the blast radius of removing a nav family?" That gap is exactly why a filesystem census was needed, and it is the *same defect class* as the 2026-06-21 scheduling-surface finding (a real surface absent from the code graph because no extractor reads its source).

**The architecturally-correct response (and the durable prize): make navigation a first-class SysML surface.** Add a `navigation-extract.ts` that projects `portal-navigation-model` + the per-domain nav models as a `Navigation` package of `nav-entry` parts, with `navigates-to` relationships into the existing route-surface parts. Then a `reconcile-navigation` parity pass emits conformance findings — **`route-without-nav-entry` (orphan)** and **`nav-entry-crosses-domain` (teleport)** — that surface in the EA canvas and are kept drift-proof by the Parity Engine. The route/nav **inventory gate (P6)** then becomes the CI face of that parity check rather than a standalone script, and the orphan/teleport counts above become *live, queryable, drift-proof* architecture facts instead of a point-in-time census.

## Root Causes

| # | Root cause | Symptom the founder named |
| --- | --- | --- |
| 1 | Secondary-nav tabs can be cross-domain teleports + zero global breadcrumb | "no longer in platform hub, I'm in admin … no way to navigate back" |
| 2 | `/ops` rail item conflates delivery intake with platform-runtime ops | "under the backlog, we have the self upgrade?" |
| 3 | Three disagreeing taxonomies, flat always-expanded rail, unwired worker/operator mode | "consistent / conformant … eliminate cognitive load … condensed and automated" |

## Resolved Decisions

The 2026-06-05 audit left five open decisions "for founder/architect review." The founder directive resolves them and adds new ones:

| # | Question | Resolution (this pass) |
| --- | --- | --- |
| D1 | Admin: absorb into Platform, or keep separate? | **Absorb into a single operator console.** Platform + Admin share ONE secondary-nav model (`CONSOLE_FAMILIES`) and one `ConsoleTabNav`. Admin becomes an "Administration" family. Route paths may stay (`/admin/*`) to keep migration risk low; the *navigation context* unifies. Removes the teleport by construction. |
| D2 | `/ops` → "Delivery", runtime ops moved out? | **Yes.** Backlog rail item becomes a pure delivery queue (just Backlog — Improvements was retired into it upstream). Self-upgrade · Changes · Promotions → console "Runtime & Releases" family. Dev Loop → Build Studio / Build Runtime (per founder: "under the build studio … or the AI coworker"). |
| D3 | Remove `/admin` from Platform family tabs? | **Yes, immediately** (keystone). The teleport tab is deleted; admin is reachable via the unified console nav + the persistent rail. |
| D4 | Three taxonomies | **Collapse to one.** The `domain` axis on `portal-navigation-model` is the single source; rail groups and workspace blueprints are *derived* from it, not independently authored. |
| D5 | Worker/operator mode | **Wire it.** Default non-operator business users to worker mode (archetype rail, ~5–7 items); operators get a mode switch to the full console. Condense the rail into collapsible groups with the active group open. |
| D6 *(new)* | Global breadcrumb | **Add one** in the shell, derived from the existing `parentPath` chain. This is the universal cure for "no way back" across every route, not just platform↔admin. |

### UX-Fit decision record (governed)

Per AGENTS.md §12 the cognitive-load axis was run through `principle_decide` (population `external_coding_agent`, surface `portal-nav-ia-overhaul`). **The result was degenerate and is not followed:** only commandment-tier principles were in scope, the `human_cognitive_load` dimension was never scored (no principle in the kernel uses it), and the math recommended "status-quo-cosmetic" by penalizing the more ambitious options on proxy dimensions ("don't task the operator," "never ask the user to run commands") that are irrelevant to a design-quality choice. The tool is advisory and the caller retains authority. Decision: **unified-operator-console**, phased, on the merits — the cognitive-load and platform-caliber case is grounded in external standards (below) and is the prior audit's own recommendation. **Kernel gap noted:** the UX-Fit gate mandates scoring on `human_cognitive_load`, but no kernel principle carries that dimension, so `principle_decide` cannot actually weigh it. Captured for founder review (candidate kernel-gap follow-up).

`UX-Fit-Decision:` unified-operator-console (progressive disclosure: one console, one breadcrumb, condensed rail; worker mode hides operator chrome). Scored on human_cognitive_load via principle_decide; tool degenerate (no cognitive-load principle in kernel), decided on merits + external standards.

## Research & Benchmarking (AGENTS.md §10)

**Operator/admin consoles of this caliber** — reading their navigation models, not just feature lists:

- **AWS Console / GCP Console / Azure Portal:** one persistent global shell; a single service-scoped secondary nav; a breadcrumb that always shows depth and is climbable. Crossing services keeps the shell and resets the breadcrumb to that service's root — you never lose the chrome or the trail. *Adopted:* one console shell + always-present breadcrumb. *Rejected:* AWS's per-service nav sprawl (we keep one console-wide family model).
- **Vercel / Stripe / Supabase / Render dashboards:** Settings/Admin is **one area** reached from a stable entry (gear or bottom-of-nav), never sprayed across sibling tabs or duplicated per product area. *Adopted:* Administration as one console family, not a peer teleport.
- **Linear / Datadog:** collapsible nav groups with the active group expanded; progressive disclosure of advanced/operator surfaces; a command palette as the power-user accelerator. *Adopted:* condensed collapsible rail + worker/operator mode. *Deferred:* command palette (separate BI).
- **NN/g Menu Design Checklist:** communicate current location; provide local navigation for closely related content; avoid internal jargon. *Gap filled:* breadcrumb communicates location; the teleport (no current-location signal after the jump) is the exact anti-pattern.
- **Material Design navigation guidance:** navigation drawers suit 5+ top-level destinations but warns against *competing* primary navigation components. *Anti-pattern identified:* the AppRail + the platform tab row + the admin tab row currently compete; the console model makes the tab row consistent under one drawer.
- **GOV.UK service manual:** design around the user's whole journey, not the org's internal module boundaries. *Adopted:* group by durable user jobs (delivery vs runtime ops vs administration), not by implementation package.

## Target Navigation Model

### One canonical taxonomy

`domain` on `portal-navigation-model` is the single grouping source. Rail groups and workspace-launcher groups are derived projections of it. No surface is grouped two disagreeing ways. Reconcile the misfits (Build Studio, Backlog, Admin) so domain == rail-group intent.

### The operator console (cures complaint 1)

Platform + Admin + the refiled runtime/release surfaces are ONE console with a single `CONSOLE_FAMILIES` model rendered by one `ConsoleTabNav` (layout-injected — also advances the audit's Phase 2 section-nav centralization). Proposed families (sub-items shown only for the active family — progressive disclosure):

| Family | Owns | Notes |
| --- | --- | --- |
| Overview | `/platform`, Schedule, Workbooks hub | Console home |
| Identity & Access | `/platform/identity/*` | unchanged |
| AI Operations | `/platform/ai/*` (Assignments = "where we choose the worker LLM", Prompts, Skills, Providers & Routing, **Build Runtime**) | the "AI coworker" surface |
| Tools & Services | `/platform/tools/*` | unchanged |
| Governance & Audit | `/platform/audit/*` | unchanged |
| Runtime & Releases *(new)* | Self-upgrade, Promotions, Changes | refiled out of "Backlog" |
| Administration *(was a teleport)* | Users & Roles, Branding, Settings, Reference Data, Business Models, + Advanced (Platform Development, Diagnostics, Backups, Scheduled Jobs, Hive, Issue Reports) | Admin families folded in as one console family |

There is no "Core Admin" tab that leaves the console; Administration is a peer family, the tab row never disappears, and the breadcrumb always shows `Console › Family › Page`.

### Delivery vs Runtime (cures complaint 2)

- **Delivery** (rail): Backlog only — the work queue (Improvements already converged into it upstream, EP-INTAKE-UNIFY). (Rail label may stay "Backlog" or become "Delivery"; founder did not object to the queue, only to self-upgrade living in it.)
- **Runtime & Releases** (console family): Self-upgrade, Promotions, Changes.
- **Dev Loop** → surfaced under **Build Studio** (the runtime behind builds) and adjacent to **Build Runtime** in AI Operations — per the founder's "under the build studio … or the AI coworker." Route may stay `/ops/dev-loop` initially; nav re-points.

### Global breadcrumb (cures "no way back" everywhere — D6)

A shell-level `ShellBreadcrumb` derives the trail from `getRouteNavRecord(pathname)` walking `parentPath` to the domain root, each crumb a link. Unknown/detail paths fall back to title-cased URL segments. Rendered once in `(shell)/layout.tsx`, so depth and cross-area moves always carry a visible, climbable trail. Pure addition; lowest-risk, highest-leverage cure.

### Worker/operator mode + condensed rail (cognitive load — D5)

Wire the existing `audienceModes`: `getShellNavSections` takes a mode; non-operator business users default to worker mode (archetype rail, ~5–7 jobs); operators get a mode switch to the full console. The rail becomes collapsible groups with the active group expanded (vs ~25 links always open). Generated from the one canonical model + archetype + mode — hand-maintained-in-three-places becomes derived-from-one (automation).

## Cognitive-Load Treatment (hide · condense · automate)

- **Hide:** worker mode removes operator chrome for non-technical users; advanced admin tucked inside one Administration family, not sprayed across peers.
- **Condense:** collapsible rail groups; one console tab row instead of competing platform/admin rows; breadcrumb replaces "where am I / how do I get back" hunting.
- **Automate:** rail groups, console families, breadcrumb, and workspace launcher all *derive* from the single canonical model — adding a route updates every surface without editing three hand-kept lists.

## Phased Plan → Backlog (continues the 2026-06-05 "later slices")

| Phase | BI | Scope | Size |
| --- | --- | --- | --- |
| **P0 keystone** | BI-NAV-KEYSTONE | Global `ShellBreadcrumb` (derived from nav model) + remove "Core Admin" teleport from `PLATFORM_FAMILIES` + group `OpsTabNav` into Delivery (Backlog) vs Runtime & Releases | medium |
| P1 | BI-NAV-CONSOLE | Unify Platform + Admin into one `CONSOLE_FAMILIES` + one layout-injected `ConsoleTabNav`; add "Runtime & Releases" family; retire per-page `AdminTabNav`/`PlatformTabNav` imports | large |
| P2 | BI-NAV-DEVLOOP | Surface Dev Loop under Build Studio / Build Runtime; finalize Runtime & Releases home for self-upgrade/promotions/changes | medium |
| P3 | BI-NAV-TAXONOMY | Collapse the 3 taxonomies to one derived model AND register the **125 orphan routes + per-domain nav models** into it (finance/compliance/ea/admin/… stop being parallel); reconcile Build Studio/Backlog/Admin grouping; resolve the odd singletons (`/complaints`, `/inventory`) and the duplicate product-detail trees (`product/[id]` vs `products/[productId]`) | large |
| P4 | BI-NAV-MODE | Wire worker/operator mode + condensed collapsible rail (uses existing `audienceModes`) | large |
| P5 | BI-NAV-SECTIONNAV | Layout-level section-nav centralization for the remaining per-page navs (Ops, Employee, EA, Finance); classify the **37 redirect shims** (only 3 are modeled) + telemetry | medium |
| **P6** | BI-NAV-SYSML-SURFACE | **Navigation as a first-class SysML surface** (extends `EP-PARITY-ENGINE`). Add `navigation-extract.ts` projecting `portal-navigation-model` + per-domain navs as a `Navigation` package of `nav-entry` parts with `navigates-to` edges into the route surface; a `reconcile-navigation` parity pass emits `route-without-nav-entry` (orphan) + `nav-entry-crosses-domain` (teleport) conformance findings on the EA canvas. Same fix pattern as the 2026-06-21 scheduling-surface extractor. | large |
| **P7** | BI-NAV-INVENTORY-GATE | Route/nav **inventory gate** — the CI face of the P6 parity check: fails on any new orphan/unclassified redirect (completes the 2026-06-05 audit's Phase 0 that `BI-CD6EE9D8` only half-built). Until P6 lands, the throwaway `scripts/nav-route-census.mjs` is the interim census. | medium |

## Keystone (this PR)

Resolves the worst symptom of both named complaints, low-risk and CI-gated:

1. **Global breadcrumb** in the shell — always a visible, climbable trail back (cures "no way to navigate back" for *every* route).
2. **Remove the "Core Admin" teleport tab** from `PLATFORM_FAMILIES` (+ test). Admin stays reachable via the rail; no more whole-context swap disguised as a sibling tab.
3. **Group `OpsTabNav`** into a "Delivery" cluster (Backlog) vs a "Runtime & Releases" cluster (Changes, Promotions, Self-upgrade, Dev Loop), so self-upgrade/dev-loop are visibly *not* under "Backlog" (routes unchanged; re-homed in P1/P2 console families).

## Acceptance Criteria

- No secondary-nav tab links out of its own domain's route tree (teleport census = 0).
- A global breadcrumb is present on every `(shell)` route and is climbable to the domain root.
- "Backlog" exposes only delivery work; self-upgrade/dev-loop/promotions/changes are reachable from their conceptual homes.
- Platform and Admin share one secondary-nav model (post-P1); crossing the boundary keeps the tab row and the breadcrumb.
- One canonical taxonomy; rail + workspace groups derived from it (post-P3).
- Worker mode hides operator chrome; operator mode is one switch away (post-P4).
- Theme tokens only; live UX verified desktop + mobile for one operator path and one worker path.

## Risks

- **Big-bang console merge.** Mitigated by phasing: keystone is additive (breadcrumb) + subtractive (teleport tab) + a tab relabel; the console merge is its own reviewed PR (P1).
- **Breadcrumb on unmodeled detail routes.** Mitigated by graceful URL-segment fallback.
- **Mode default surprises operators.** Mitigated by defaulting superusers/operators to the full console; worker mode only auto-applies to non-operator roles with an active archetype.

## Implementation log

- **P0 keystone (BI-8866F144)** — merged via PR #2234 (squash `d24c40bfb`): global `ShellBreadcrumb`, removed the Platform→Admin teleport from `PLATFORM_FAMILIES`, grouped `OpsTabNav` (Delivery vs Runtime & Releases).
- **P6 navigation SysML surface (BI-E71E7FA5)** — WWMD/`principle_decide` ranked it the next track (composite 2.62, margin 1.24, high confidence — Architecture Over Shortcuts + Never Assume—Verify favour establishing the governed surface before more UX surgery). v1 landed:
  - `apps/web/lib/ea/navigation-extract.ts` — pure `buildNavigationModel` projecting the canonical nav model as a `Navigation` SysML package (one `part_definition` surface per domain, a `part_usage` per entry) with cross-layer `traces` (navigates-to) edges into the route surface (`route:<path>`), plus `toNavEntries`/`buildDomainResolver` normalization. Emits conformance findings `route-not-in-canonical-nav` (orphan) and `nav-entry-crosses-domain` (teleport).
  - `apps/web/lib/ea/reconcile-navigation.ts` — thin IO shell (canonical model + committed route manifest → desired model → shared seeder), wired into `reconcile-sysml-projections.ts` after `reconcileRoutes` so the `traces` edges resolve same-pass; labelled in `architecture-parity-steward.ts`.
  - **Scope note:** v1 source is the canonical model only; the per-domain nav components (`finance-nav`, `ComplianceTabNav`, `EaTabNav`, …) are the parallel taxonomies P3 converges, so their routes surface as `route-not-in-canonical-nav` findings — the convergence backlog made into live, drift-proof graph facts. The teleport guard is in place but fires only once non-canonical sources are added (the canonical model is teleport-free by construction).
- **P7 inventory gate (BI-E7D871ED)** — `apps/web/lib/ea/navigation-inventory-gate.test.ts`: the CI face of the parity surface. Locks two invariants against regression: (1) **zero cross-domain teleports** in the canonical nav model (founder complaint #1); (2) every PAGE-route orphan lives under a **known top-level segment** (enumerated from the App Router tree), so a brand-new feature area cannot ship with no navigation. Also fixed `reconcile-navigation` to count **page routes only** (API route handlers never carry nav). The full orphan-count ratchet driving the per-domain-nav backlog toward zero is tracked by the live conformance findings as P3 converges the parallel taxonomies.
- **P3 convergence — slices 1–7: Finance + Admin + Compliance + EA + Ops + Marketing + Storefront (BI-89F03D6E)** — `apps/web/lib/ea/domain-nav-sources.ts`: registers the per-domain nav components as additional navigation sources via **read-time unification** (not a second copy of the data). A generic `familyNavSource` flattens family-style navs to `NavSourceEntry` rows with teleport-aware `targetDomain`: pure-data `FINANCE_FAMILIES` + `ADMIN_FAMILIES` (the two biggest orphan clusters, 39 + 14), plus `COMPLIANCE_FAMILIES` lifted out of `ComplianceTabNav.tsx` into `compliance-nav.ts` (the P5 step — extract the inline array to a pure module, re-import it, register it). `getAllNavEntries()` merges canonical + per-domain, deduped by path; both the reconcile projection and the P7 gate read it, so those section routes (invoices, banking, settings, branding, diagnostics, risks, controls, audits, …) join the navigation surface, gain `navigates-to` edges, and leave the orphan set. EA, Ops, Marketing, and Storefront were lifted the same way (`ea-nav.ts` / `ops-nav.ts` / `marketing-nav.ts` / `storefront-nav.ts`; a generic `tabNavSource` handles flat tab lists). Storefront's top tabs are archetype-dynamic, so its surface ingests a static route inventory (`STOREFRONT_ROUTES`) while the static settings sub-nav was lifted fully. **Static per-domain-nav convergence is complete** — only Employee remains, and it has no distinct routes (query-param `?view=` views), so there is nothing to converge. The end state has each per-domain `TabNav` render from the one model (the Customer nav is the existing exemplar).
- **P1 operator console (BI-CB07C8BA)** — PR #2279: `console-nav.ts` (`CONSOLE_FAMILIES` composing `PLATFORM_FAMILIES` + a single **Administration** family folding the Admin areas) + one shared `ConsoleTabNav`; `PlatformTabNav` + `AdminTabNav` re-export it, so `/platform` and `/admin` render the **same** secondary-nav row (no rewire of the ~18 render sites) — crossing the boundary changes only the active family, never the whole context. Live UX verification on a deployed build is the remaining gate.
- **P4 worker/operator mode (BI-2F3682C6)** — PR #2280: `getShellNavSections(user, { mode })` filters by `audienceModes` (`ShellNavItem`/`SHELL_ITEMS` now carry them); **worker** = the condensed day-to-day rail (hides operator/platform chrome), **operator** = the full rail. The shell resolves the mode from a `dpf-nav-mode` cookie, **defaulting to operator** (no regression); `AppRail` renders a Simple/Full toggle (operator always one click away — no stranding). Follow-up: smart default-by-role (live-verified).
- **P2 Runtime & Releases console family (BI-058EA759)** — added a **Runtime & Releases** family to `CONSOLE_FAMILIES` (self-upgrade · promotions · changes · dev-loop), giving the platform's own runtime/release operations a coherent operator-console home (founder complaint #2 — they did not belong under "Backlog"). Follow-up (live-verified): render `ConsoleTabNav` on the four runtime `/ops` pages so they sit fully inside the console, and slim `OpsTabNav` to the Delivery group.

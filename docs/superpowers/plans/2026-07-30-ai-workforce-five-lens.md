# AI Workforce Five-Lens Consolidation Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Status

- Backlog item: `BI-F2278856`
- Epic: `EP-UX-SYSTEM`
- Branch: `feat/ai-workforce-five-lens`
- Work Capsule: `WC-D9A0DA75`
- Canonical design: `docs/superpowers/specs/2026-07-25-ai-workforce-ia-design.md`
- Repository visual prototype: `docs/superpowers/specs/assets/2026-07-30-ai-workforce-five-lens-prototype.html`
- Plan coverage receipt: `cms71bt3e0dvn01ogx7azs3tx`
- Delivery decision: atomic
- Coworker declaration **design** dependency: PR `#3812`, merge
  `5a93ad2630d4e3fe7ab887d86f3be79c801a939b`; its implementation backlog below
  remains unmerged
- Marketing model-default dependency: PR `#3811`, merge
  `964eeaeb91436f0fa317dbd63d0cc91287941e83`; live acceptance remains a
  completion gate

This plan implements one information-architecture replacement. Its phases are implementation order, not release boundaries.

## Backlog Coverage

Parent BI: `BI-F2278856`

The live coverage decision is **atomic**. Shipping the registry, routes, navigation removal, compatibility behavior, or acceptance contracts separately would expose dead destinations or leave the existing AI Operations and Coworker Decision Engine navigation competing with the new model.

| Deliverable | Depends on | Independently shippable | BI |
| --- | --- | --- | --- |
| `lens-registry` - canonical five-lens and route-disposition registry | none | no | `BI-F2278856` |
| `lens-routes` - Coworkers, Work, Decisions, Setup, and Health routes | `lens-registry` | no | `BI-F2278856` |
| `navigation-convergence` - platform, portal, breadcrumb, mobile, and global navigation | `lens-registry`, `lens-routes` | no | `BI-F2278856` |
| `compatibility-routing` - redirects and contextual deep-link preservation | `lens-registry`, `lens-routes` | no | `BI-F2278856` |
| `acceptance` - Purpose Contracts, docs, telemetry safeguards, and browser evidence | `navigation-convergence`, `compatibility-routing` | no | `BI-F2278856` |

Before implementation or after a resume, revalidate receipt `cms71bt3e0dvn01ogx7azs3tx` against this exact plan path with `check_plan_backlog_coverage`.

## Outcome

An operator entering AI Workforce sees one stable section with five bookmarkable lenses:

1. **Coworkers** - find the right coworker and understand what it can offer this business.
2. **Work** - inspect AI-linked work in motion and continue it at the owning surface.
3. **Decisions** - improve policy, recurring exceptions, evidence, and learning without creating another approval queue.
4. **Setup** - resolve applicability, configuration, catalog, provider, and capability prerequisites.
5. **Health** - diagnose degraded coworker service by symptom before opening technical evidence.

The old ten-link **AI Operations** row and global **Coworker Decision Engine** destination disappear in the same release. Their routes remain addressable or redirect to an equivalent destination during the compatibility window.

## UX Contract

### One job per lens

| Lens | First question answered | Primary content | Owned actions | Content deliberately withheld |
| --- | --- | --- | --- | --- |
| Coworkers | "Who can help with this work?" | Four-portfolio roster, availability, offered work, selected coworker summary | Open coworker; start a specific ready offer after preview | Provider tables, raw prompts, full skill catalogs, raw decision rows |
| Work | "What are coworkers doing, blocked on, or finished with?" | Read-only projection of active/recent AI-linked work and attention counts | Continue at the owning work surface; open canonical Needs you | New approvals, duplicate claims, local completion state |
| Decisions | "Where is doctrine weak or repeatedly creating exceptions?" | Policy quality, recurring exception clusters, decision history, stances, learning | Open evidence; edit governed stance; deep-link human actions to Needs you | A second unresolved-action queue |
| Setup | "What must be configured before this coworker or offer is usable?" | Applicability, setup blockers, capability needs, provider/catalog readiness | Finish setup at the canonical owner; explain unsupported/undefined states | Health telemetry, operational work queues |
| Health | "Why is coworker service degraded, and what is the safest recovery?" | Symptom-oriented readiness, provider/runtime/browser/routing status, evidence freshness | Follow typed recovery link; open advanced diagnostics | Setup catalogs as the default view, raw logs in the first viewport |

### First-viewport hierarchy

Every lens renders, in order:

1. Shell breadcrumb.
2. One shared AI Workforce H1 and one-sentence purpose.
3. Existing Platform family navigation followed by the five semantic lens links.
4. One owner-readable status/summary band.
5. The primary task content.
6. Advanced evidence and technical controls behind labelled disclosures or contextual deep links.

No lens begins with operating doctrine, help copy, raw identifiers, an infrastructure table, or a card grid that has no ranked user task.

### Action ownership

- `/workspace/inbox` is the only actionable human-attention and approval queue.
- `/ops` / Backlog owns capability gaps and promoted work.
- Build Studio owns product-building execution.
- Platform Identity owns agent principals, authorization, and principal linkage.
- Priority & Models retains model-priority and binding ownership.
- Finance AI spend remains Finance-owned.
- AI Workforce projects those owners and links to them; it does not clone their rows or mutations.

### Coworker execution boundary

Named work uses the versioned, runtime-validated
`CoworkerNamedWorkTargetV1` and `CoworkerRecoveryTargetV1` owned by
`docs/superpowers/specs/2026-07-30-coworker-declarations-design.md`. This plan
does not define a second launch, permission, engagement, or dispatch contract.

Inspecting a coworker never executes or sends a prompt. A named Ask preview
names the coworker, offer, context sent, required operator inputs, expected
result, action-specific authority, destination, and durable receipt behavior.
Every offer resolves those fields from its own declaration; a shared launcher
must never inherit another coworker's context, field labels, readiness prose,
or receipt subject.
It must fail closed when applicability, readiness evidence, setup, an active
offer, or invocation authority is missing. A generic prompt string is not an
execution identity.

Recovery uses the declaration design's closed recovery target. It accepts
route-registry keys, opaque server retry references, governed unsupported reason
codes, or docs-map keys - never a raw recovery URL. Display prose never
determines routing.

## Canonical Navigation Contract

Add one pure registry, tentatively `apps/web/lib/navigation/ai-workforce-navigation.ts`, containing:

- `AI_WORKFORCE_LENSES`: key, label, canonical URL/pattern, order, parent,
  breadcrumb label, visibility, and route classification references.
- `AI_WORKFORCE_ROUTE_DISPOSITIONS`: every existing AI/Decision Engine route
  with a closed disposition, owner, target template, parameter mapping, query
  policy, safe return target, and visibility.
- resolvers for active lens, canonical route, breadcrumb label, compatibility target, and visible section links.

The navigation registry does **not** own purpose, primary task, success signal,
states, or disclosure. Those remain exclusively in Page Purpose Contract
sources. Every lens must have exactly one navigation record, one explicit
route-audience/shell classification, and one Purpose Contract.

Canonical URLs:

| Key | Label | URL |
| --- | --- | --- |
| `coworkers` | Coworkers | `/platform/ai/coworkers` |
| `work` | Work | `/platform/ai/work` |
| `decisions` | Decisions | `/platform/ai/decisions` |
| `setup` | Setup | `/platform/ai/setup` |
| `health` | Health | `/platform/ai/health` |

The registry is consumed by:

- `apps/web/components/platform/platform-nav.ts`
- `apps/web/components/platform/PlatformTabNav.tsx`
- `apps/web/lib/navigation/portal-navigation-model.ts`
- `apps/web/components/shell/ShellBreadcrumb.tsx`
- route-context and panel-context resolution
- Page Purpose Contract generation and route-policy fixtures
- compatibility redirect helpers
- docs and route tests

Generated route manifests remain generated outputs. Do not create a second manually maintained label or disposition list.

Explicit route classifications:

| Lens | `RouteAudience` | `RouteDestinationKind` | Derived UX shell |
| --- | --- | --- | --- |
| Coworkers | `owner` | `section-home` | `cockpit` |
| Work | `owner` | `section-home` | `cockpit` |
| Decisions | `owner` | `section-home` | `cockpit` |
| Setup | `owner` | `settings-config` | `settings` |
| Health | `owner` | `section-home` | `cockpit` |

These are explicit overrides in the existing route-audience substrate. No
AI-specific audience, destination, or shell registry is introduced. Health is
owner-readable and symptom-first; its provider/runtime deep links retain their
existing advanced/admin classifications.

### Exact shell hierarchy

The existing `PlatformTabNav` remains the one section-navigation component:

- The AI layout renders the shared AI Workforce H1 before `PlatformTabNav`;
  individual lens pages do not render another H1.
- Desktop: page identity, Platform family links, then the five AI Workforce lens
  links.
- Mobile: page identity, one `Platform area` selector, then one
  `AI Workforce view` selector.
- Lens pages do not render a third tab row or a second lens selector.
- The lens-specific purpose and status band follow navigation.
- Coworker search and portfolio filters render only inside Coworkers.

## Route Disposition

The table below is a human-readable summary only. The implementation's
machine-checkable disposition source is exhaustive against the canonical route
manifest for every `/platform/ai/*` and `/coworker-decisions/*` page pattern:

| Existing route family | Disposition |
| --- | --- |
| `/platform/ai/coworkers`, `/platform/ai`, `/platform/ai/overview`, `/platform/ai/agent/[agentId]` | Coworkers canonical home, compatibility entries, and record |
| `/platform/ai/history`, `/platform/ai/priority/outcomes` | Work projection or canonical Audit/owning-work deep link |
| `/platform/ai/founder-review`, `/platform/ai/decisions/[interactionId]`, `/coworker-decisions/review`, `/decisions/*`, `/stance`, `/proactivity`, `/perspectives/*`, `/craft/*`, `/matrix` | Decisions canonical summaries plus compatibility deep links |
| `/platform/ai/assignments`, `/prompts`, `/skills`, `/catalog`, `/browser-sessions/setup`, `/build-studio` | Setup summaries and advanced canonical owners |
| `/platform/ai/readiness`, `/operations-map`, `/capacity-continuity`, `/runtime-health`, `/providers`, `/browser-sessions` | Health symptom summaries and advanced diagnostics |
| `/platform/ai/capability-needs` | Backlog-owned compatibility redirect |
| `/platform/identity/agents` | Identity-owned deep link, never a duplicate roster |
| `/finance/spend/ai` | Finance-owned contextual deep link |
| `/admin/prompts`, `/admin/skills`, `/ea/agents` | Compatibility-only; no visible peer navigation |

Redirect helpers preserve mapped path IDs, allow-listed query parameters, and
a safe `returnTo`. Physical deletion is prohibited until the design's telemetry
gate passes.

Each registry row uses the canonical design's lifecycle contract verbatim:

```ts
type AiWorkforceRouteRegistryRow = AiRouteLifecycleDisposition & {
  canonicalOwnerRouteId: string;
  visibleInNavigation: boolean;
  safeFallbackRouteId: string;
};
```

`AiRouteLifecycleDisposition` remains the one closed source for observed page
state, target disposition, machine target, versioned context mapping, lifecycle
phase, activation prerequisites, and retirement evidence. Ownership and visible
navigation extend that row; they do not replace or rename its values. Actual
paths resolve through a tested pattern matcher; exact string lookup is
insufficient for dynamic routes.

The exhaustive guard explicitly covers nested/dynamic patterns including
`/platform/ai/assignments/bindings/[bindingId]`,
`/platform/ai/capacity-continuity`, `/coworker-decisions/[...slug]`,
`/coworker-decisions/edit/[...slug]`, and
`/coworker-decisions/perspectives/[profileId]/voice`. Documentation tables are
generated from that source; they are not maintained independently.

Server redirects cannot receive URL fragments, so fragments are not promised
through server-side redirects. Client-side compatibility links may preserve a
deterministic anchor only when it is part of the explicit target contract.
Unknown query keys are dropped. Tests include encoded IDs, repeated/unknown
keys, protocol-relative input, backslashes, CRLF, loops, and malformed returns.

## Implementation Phases

### Phase 0: Converge foundations and review artifact

Implementation gates:

1. Merge the Page Purpose Contract typed registry (`BI-B4A4C76E`), then
   shallow-safe rebase this branch onto current `origin/main`.
2. Preserve the merged coworker declarations design as the sole source for
   named-work targets, recovery, invocation permission, engagement receipts,
   and dispatch durability; add only five-lens IA behavior here.
3. Verify the repository-owned interactive prototype at
   `docs/superpowers/specs/assets/2026-07-30-ai-workforce-five-lens-prototype.html`.
4. Capture independent architecture and UX-fit reviews in this plan and fold
   all required edits into the contract before source implementation.

Release/completion gates:

1. Merge the Purpose Contract evaluator (`BI-D27323A0`) before UX evidence is
   accepted.
2. Merge and live-accept Marketing readiness (`BI-C1943813`) before the
   Marketing offer becomes executable.
3. Treat PR `#3812` as approved design only. Before named readiness, placement,
   record consumption, or Ask activation, merge the declaration reader
   (`BI-3FB40CCA`), aggregate contract (`BI-2E7972A7`), writer/CAS
   (`BI-33A623D0`), readiness normalization (`BI-1FDEF342`), four portfolio
   declaration batches (`BI-A00EAD43`, `BI-A02A060E`, `BI-3BDB5C04`,
   `BI-F798996C`), and roster/record consumption (`BI-57F76D61`).
4. Merge the durable execution contract and conformance gate (`BI-PSC-004`)
   before named Ask can dispatch.
5. Record exact dependency SHAs/statuses and evaluator results in completion
   evidence.

Implementation may render honest unavailable/undefined states while downstream
dependencies are pending; it may not expose affected execution or claim live
acceptance/completion.

Verification:

- Plan coverage receipt remains valid after rebase.
- Prototype opens without a server and demonstrates all five lenses at desktop and mobile widths.
- Review notes name route, persona, user harm, source truth, and required evidence.

### Phase 1: Canonical registry and dispositions

Write failing tests first for:

- exactly five ordered labels and URLs;
- no visible `AI Operations` or `Coworker Decision Engine` destination;
- unique canonical URLs and deterministic active-lens resolution;
- every static and parameterized AI/Decision Engine route having one disposition;
- preservation of route IDs, query, and return context;
- external ownership of Inbox, Backlog, Identity, Build Studio, Priority & Models, and Finance AI.
- parity across the navigation record, explicit route classification, and Page
  Purpose Contract for each lens.
- every observed launcher caller/export having exactly one canonical launcher
  disposition, owner, context contract, and acceptance fixture;
- scanner failure for missing, duplicate, stale, or ownerless launcher rows and
  for undeclared direct dispatch/panel emitters.

Implement the pure registry and redirect resolver. Update:

- `apps/web/lib/navigation/ai-workforce-navigation.ts` and tests;
- `apps/web/components/platform/platform-nav.ts` and tests;
- `apps/web/lib/navigation/portal-navigation-model.ts` and tests;
- `apps/web/components/shell/ShellBreadcrumb.tsx` and tests;
- navigation extraction and route-manifest tests that consume portal records.
- the declaration design's canonical launcher disposition registry, exact
  caller/export scanner, and CI integrity guard.

Verification:

- Registry tests prove there is no second label/order/disposition array.
- Existing legacy routes remain resolvable.
- Mobile and desktop section nav are generated from the same five records.

### Phase 2: Lens read models

Create pure, owner-preserving read models under `apps/web/lib/ai-workforce/`:

- Coworkers reuses the existing roster read model and
  `apps/web/lib/coworker-record/owner-areas.ts`; do not create another
  four-portfolio presentation map.
- `work-lens.ts`: active/recent AI-linked work plus canonical attention references; no mutation methods.
- `decisions-lens.ts`: doctrine quality, recurring exceptions, stances, evidence/history, and Needs you deep links.
- `setup-lens.ts`: declared applicability, readiness evidence, setup dependencies, capability gaps, and owner recovery.
- `health-lens.ts`: symptom-first status, evidence freshness, provider/runtime/browser/routing health, and typed recovery.

Reuse current loaders and models from the roster, attention projection, decision-governance, provider/readiness, operations-map, and runtime-health code. Add no persistence model and no new status enum.

The source contract is:

| Lens | Canonical source/helper | Visible projection | Freshness/partial failure | Allowed action |
| --- | --- | --- | --- | --- |
| Coworkers | `loadRoster`, active `CoworkerService`, `owner-areas.ts`, route-readiness/applicability evidence | Identity, all portfolio memberships, deterministic primary area, offered work, availability evidence time | Show last evidence time; a failed supporting corpus source does not hide the roster | Inspect coworker; preview one ready offer |
| Work | `TaskRun` is the run-status owner; `routeContext`, `buildId`, and typed `contextId` determine continuation; attention uses `loadAttentionItems` only for count/link | Title, coworker, status, updated/heartbeat time, owning destination | Stale working rows are labelled stale from heartbeat evidence; failed attention projection leaves work rows usable | Continue at owning route; open Needs you |
| Decisions | `DecisionInteraction` for decision evidence/history; governed `WikiPage` stance/principle records for doctrine; attention aggregation only for human-action count/link | Repeated exception clusters, policy gaps, evidence time, stance state | Source-specific notice; no human-required count is recomputed locally | Inspect evidence; edit canonical stance; open Needs you item |
| Setup | active `CoworkerService` declaration, route-readiness/applicability resolver, capability-gap Backlog projection, provider/catalog setup readers | Setup blocker, affected coworker/offer, evidence time, canonical owner | Missing evidence is `Undefined`, never `Available`; source failures retain unaffected blockers | Finish setup at canonical owner; review declaration; open Backlog |
| Health | `getAiReadinessSummary` is the lead health oracle; operations-map/runtime/provider/browser helpers supply advanced evidence | Symptom, impact, freshness, typed recovery, advanced evidence link | Each health source reports independently; one unavailable source cannot blank the lens | Follow typed recovery; open advanced diagnostic |

Every row carries its source kind and stable source identifier in the read model.
The UI never derives status or navigation from a display label.

Every actionable decision source - including decision residue, organization
decision gaps, conflict reviews, and weight proposals - must have one
`AttentionItem` adapter. Decisions reads those canonical attention IDs only for
summary/deep-link purposes. Add parity tests proving source pending IDs/counts
equal Inbox IDs/counts and proving Decisions imports no duplicate mutator.
`/coworker-decisions/review` becomes read-only or redirects to a filtered Needs
you view once parity exists. Durable stance/policy editing remains separate from
pending human attention.

Route-level state is also typed:

| State | Rendering contract | Primary recovery |
| --- | --- | --- |
| loading | report-kit skeleton preserving heading and navigation dimensions | none until settled |
| empty | distinguish no coworkers/work/findings/blockers/incidents from unconfigured | one owner-appropriate create/setup/return link |
| partial | render successful sections plus one source-specific Notice | retry failed source or open its owner |
| denied | explain the missing permission without leaking counts or names | return to AI Workforce or request canonical access |
| provider unavailable | Health symptom and affected work; no repeated raw error turns | provider recovery or local-capability explanation |
| failed launch | no optimistic work row; preserve origin and inputs | typed retry/setup/Needs you recovery |
| no results | preserve filters and show a clear reset | reset filters |

Write fixtures for:

- active `restaurant` archetype;
- all four portfolios;
- ready, setup-blocked, unsupported, excluded, future, inherited/universal, and undefined applicability;
- loading, empty, partial source failure, permission denial, provider unavailable, failed launch, and no results;
- attention rows that appear only as a count/link to Needs you.

Verification:

- An undefined declaration can never resolve to `Available`.
- Work exposes no claim/approve/complete mutation.
- Decisions exposes no duplicate unresolved count or resolution state.
- Every blocker carries typed recovery or an explicit unsupported explanation.

### Phase 3: Lens routes and progressive disclosure

Add:

- `/platform/ai/work`
- `/platform/ai/decisions`
- `/platform/ai/setup`
- `/platform/ai/health`

Add `/platform/ai/coworkers` as the canonical Coworkers home. Retain
`/platform/ai` and `/platform/ai/overview` only as compatibility entries that
preserve filters and return context. Build shared UI under
`apps/web/components/platform/ai-workforce/` only where it removes duplication:

- one lens header/section-nav composition;
- one compact owner-readable status band;
- semantic table/list primitives composed from report-kit;
- one advanced-disclosure primitive if the existing Disclosure/Details pattern is insufficient.

Do not nest cards inside cards. Do not create a dashboard of equal-weight tiles. Use links for navigation and buttons only for commands. All mobile controls meet the 44px target and have visible focus.

Coworkers uses full-width, scan-first roster rows within the four canonical
portfolio sections. The row shows all memberships; one deterministic
customer-inward area owns placement. `Other` is an exception notice with a
declaration-recovery action, not a fifth peer portfolio.

Verification:

- Each route's first viewport answers its one stated question.
- Headings, table relationships, accessible names, focus order, and keyboard behavior pass component tests and Axe.
- Empty and failed states retain one honest next step.
- Technical tables/logs are not first-view content.

### Phase 4: Integrate typed named work and recovery

Begin this phase only after the declaration implementation BIs and
`BI-PSC-004` above have merged. Consume their exported named-work target,
recovery target, invocation resolver, readiness projector, engagement receipt,
and dispatch adapter in the existing agent shell; this phase does not implement
or fork those contracts. Update:

- `apps/web/components/agent/AskCoworkerButton.tsx`
- `apps/web/components/agent/AgentWorkLauncher.tsx`
- `apps/web/components/agent/AgentCoworkerShell.tsx`
- `apps/web/components/agent/AgentCoworkerPanel.tsx`
- roster offer actions and contextual launch call sites touched by this slice

Keep legacy event payload support only as an explicit compatibility adapter
with tests. New AI Workforce offer actions use `CoworkerNamedWorkTargetV1`, the
shared invocation decision, and the exact preview; opening a panel must not
itself send a prompt.

The Phase 1 scanner continuously inventories every `AgentFAB`,
`AskCoworkerButton`, `AgentWorkLauncher`, launcher wrapper, direct
`open-agent-panel` emitter, and dispatch call. There remains one shared panel
and at most one generic opener per page. Roster execution is always
offer-specific.

Runtime boundary rules:

- parse `CoworkerNamedWorkTargetV1` before changing shell state;
- preserve canonical and provider Agent IDs, service, active offer, route
  context, safe return, and projection revision;
- resolve applicability and readiness through the shared projector and
  invocation permission through `resolveCoworkerServiceInvocationDecision` on
  the server;
- construct preview copy from resolved records, never caller prose;
- allow-list `returnTo` through the route-disposition/safe-return resolver;
- prohibit `autoMessage` for new structured launches;
- retain the conversational legacy adapter temporarily and test its boundary;
- create/replay the durable `CoworkerEngagement` and one-to-one dispatch receipt
  before dispatch; named Ask stays disabled until the `BI-PSC-004` durability
  prerequisite and its conformance gate pass.

Recovery is the runtime-validated `CoworkerRecoveryTargetV1`:

- navigation target resolved from a closed owner key;
- retry action with an opaque server-issued retry reference;
- unsupported reason code;
- documentation reference resolved through the docs route map.

No recovery variant accepts a raw external or protocol-relative URL.

Verification:

- ready offer: preview -> confirm -> correct coworker/context -> durable receipt or typed failure;
- setup-blocked: only `Finish setup`;
- unsupported: explanation, no execution;
- undefined applicability: administrator declaration review, no execution;
- failed launch: safe return destination and typed recovery.

### Phase 5: Navigation convergence and compatibility

Replace the visible ten-item AI row with the five registry links in both desktop and mobile navigation. Remove the global Coworker Decision Engine destination and any platform summary card copy that promotes AI Operations as a separate product.

Add compatibility handlers or redirects only after their equivalent lens destinations exist. Update internal links in:

- coworker record panels;
- wiki/decision pages;
- Workspace readiness/command-center surfaces;
- provider/runtime messages;
- user guide and route maps.

Compatibility pages may keep advanced controls during the window, but their breadcrumb and return path point to the owning lens. They do not render competing section navigation.

`/coworker-decisions/review` is the exception: it may not retain inline
answer/ruling mutations after canonical attention parity exists. It redirects
to filtered Needs you or becomes a read-only compatibility explanation.

Verification:

- source scan finds no visible navigation label `AI Operations` or `Coworker Decision Engine`;
- deep-link tests cover every parameterized compatibility family;
- no redirect loop;
- no route ID, query, or return-context loss;
- Platform Identity, Finance, Backlog, Needs you, and Build Studio ownership remains unchanged.

### Phase 6: Purpose Contracts, docs, and measured UX evidence

After the Purpose Contract foundation is present:

- register each canonical lens with one audience, job, primary action, visible-now content, deferred content, and success signal;
- classify compatibility routes as redirect/contextual/advanced and keep them out of primary navigation;
- regenerate route-purpose and route-shell artifacts through their canonical scripts;
- add `docs/ux-fit/2026-07-30-ai-workforce-five-lens.ux-fit.json` with a measured sweep, not acknowledgement evidence;
- update `docs/user-guide/ai-workforce/`, route maps, and the canonical design.

Measure at minimum:

- default visible words;
- lead-band words;
- primary actions;
- visible fields;
- maximum choices per control;
- sub-legible controls;
- buried primary action;
- Axe violations;
- link/button counts compared with the ten-surface baseline.

Targets:

- Coworkers default-visible words: below the committed 3,144-word baseline and
  within the `cockpit` shell budget of 350 unless an explicit measured exception is
  adjudicated.
- Lead band: at most 60 words.
- Lens choices: exactly 5.
- Maximum choices in any filter control: at most 20.
- Sub-legible controls: 0.
- Axe violations: 0.
- Buried primary action: 0 for Setup and Health recovery.
- Mobile tap targets: at least 44 by 44 CSS pixels.

Verification:

- purpose artifacts are generated and clean;
- the UX-fit manifest covers exactly the UI files in the diff;
- route budgets improve or have a documented, adjudicated baseline change;
- documentation names Coworkers, Work, Decisions, Setup, and Health consistently.

### Phase 7: Integrated acceptance

Run source-local focused tests first, then the governed exact-SHA merged-code gate in `local-integration-ci`.

Browser acceptance uses the real AppRail, Platform navigation, ShellBreadcrumb, and coworker shell at:

- desktop: 1440x900;
- narrow mobile: 390x844;
- one intermediate width where desktop/mobile nav changes.

Tasks:

1. From the AppRail, reach AI Workforce and identify a customer-facing coworker in the first viewport.
2. Filter across the four portfolios and open one coworker that belongs to more than one portfolio; it appears once and shows all memberships.
3. Open Work, distinguish in-progress work from Needs you, and reach the canonical owner without creating a second claim.
4. Open Decisions, inspect doctrine/evidence, and reach a human-required item in Needs you.
5. Open Setup for a blocked offer and reach the typed setup owner; confirm no start action.
6. Open Health with provider unavailable and follow symptom-first recovery before raw diagnostics.
7. Start the Marketing offer through preview and confirm the selected coworker, context, authority, return path, and receipt.
8. Verify Customer Advisor or an undefined archetype case fails closed.
9. Exercise legacy AI and Decision Engine deep links with IDs and query strings.
10. Verify loading, empty, partial-data, permission, failed-launch, provider-unavailable, and no-result states.

For every viewport:

- no horizontal overflow or incoherent overlap;
- no console errors or hydration warnings;
- keyboard focus remains visible and logical;
- mobile targets are at least 44px;
- technical details require deliberate disclosure;
- back/return navigation restores the originating context.
- launch preview traps focus, closes on Escape, isolates background content,
  restores focus to the invoker, announces result state, respects reduced
  motion, and works in light and dark themes.

## Test Matrix

- Pure registry/disposition tests.
- PlatformTabNav, Portal Navigation, breadcrumb, mobile selector, and route-context tests.
- Per-lens read-model tests with owner/source failures.
- Per-lens server component/render tests.
- Declaration-owned named-work, invocation, engagement, dispatch, and recovery
  contract tests.
- Redirect/deep-link parameter preservation tests.
- Page Purpose Contract generation and route-policy tests.
- UX budget/manifest and Axe tests.
- Affected-package Vitest.
- Web typecheck and production build.
- Governed merged-code exhaustive Vitest and Docker production build.
- Desktop/mobile live browser acceptance after governed self-upgrade.

## Blast-Radius Ownership

| Concern | Canonical source/generator | Required test/evidence |
| --- | --- | --- |
| Lens navigation/disposition | `ai-workforce-navigation.ts` | registry, uniqueness, exhaustive disposition |
| Portal records/breadcrumbs | `portal-navigation-model.ts`, `ShellBreadcrumb.tsx` | dynamic actual-path matching and breadcrumb parity |
| Audience/destination | `route-audience.ts` plus generated audience data | explicit five-lens classification |
| Shell policy | `route-shells.ts` plus generated shell data | cockpit/settings budget classification |
| Page purpose | `purpose-contracts/` and Purpose evaluator | one ratified contract and evaluator result per lens |
| Human attention | attention source adapters, aggregation, owner projection | source-to-Inbox ID/count parity |
| Launch/return safety | declarations design targets, invocation resolver, engagement/dispatch adapter, and navigation safe-return resolver | runtime parse, permission parity, durable receipt, allow-list, hostile-input tests |
| Route context | TAK/panel route-context maps and route-pattern matcher | dynamic path and selected-coworker context |
| Compatibility | every legacy route handler and disposition row | ID/query mapping, no loop, no duplicate nav/action |
| Generated artifacts | route manifest, audience, shell, and purpose generators | regeneration produces clean diff |
| Documentation | AI Workforce user guide, route maps, deep-link guidance | terminology and link scan |

## Risks And Rollback

| Risk | Mitigation | Rollback |
| --- | --- | --- |
| A lens becomes another queue | Read-only types and tests prohibit mutations outside canonical owners | Revert lens route while preserving owner links |
| Navigation sources drift | One registry, generated consumers, uniqueness/source scans | Restore previous platform nav from one registry change |
| Legacy deep links break | Exhaustive disposition table and parameter/query tests | Keep compatibility page readable; disable redirect |
| Undefined readiness is shown as available | Fail-closed read-model precedence and fixtures | Hide execution action and show declaration review |
| Launch context selects the wrong coworker/work | Typed envelope, preview, selected-coworker assertions | Route to coworker record without sending |
| Dense technical content returns to first viewport | Purpose budgets and progressive-disclosure tests | Move panel back behind advanced disclosure |
| Purpose Contract branch conflicts | Rebase only after it merges; extend its canonical registry/scripts | Stop and reconcile registry ownership before continuing |
| Route retirement removes a used path | No physical deletion before 30-day telemetry gate | Restore compatibility route immediately |

The release rollback is one PR revert. No data rollback or migration is required because this slice adds no persistence and does not delete routes.

## Review Record

### UX fit review

Independent review and three correction passes by
`019fbb85-c5a5-7580-89db-3c39e4171b14`:

- Final decision: `fits`
- Owning area: Platform
- Route family: `/platform/ai/{coworkers,work,decisions,setup,health}` with
  `/platform/ai` and `/platform/ai/overview` as compatibility entries
- Primary persona: founder/operator finding a coworker, continuing work,
  improving doctrine, resolving setup, or diagnosing service without remembering
  platform internals
- Navigation layer: Platform section navigation
- Reuse/convergence: existing roster projections, `SectionNav`, report-kit,
  owner-first disclosure, shared coworker panel, Needs you, and canonical domain
  owners
- Source truth: the field-level matrix in Phase 2 is binding
- Empty/failure behavior: typed, source-specific, and partial-data preserving
- AI boundary: inspect sends nothing; offer/work execution requires preview,
  authority evaluation, confirmation, and durable receipt
- Required edits: discriminated launch contract, sole-Inbox spec correction,
  exact shell hierarchy, source/state matrices, visible secondary memberships,
  complete launcher inventory, numerical UX targets, and dialog accessibility
- The current source correction gives the standalone prototype real
  Platform/lens mobile navigation, canonical links, dark/responsive styling,
  state-treatment examples, declaration-specific previews for every illustrated
  offer, input-preserving failed-launch recovery, and a filter reset that clears
  both text and toggles.
- Closure re-review of exact SHA `4df36fb356a83969f567fff1ac0cef41d9bd0816`
  returned `fits` with no P0-P2 findings. The reviewer confirmed one-to-one offer
  previews and receipt subjects, retained retry inputs, complete filter reset,
  and the explicit dialog-close behavior against the committed source and
  supplied browser evidence.
- Prototype evidence captured 2026-07-30:
  - desktop `1440x1000` and narrow mobile `390x844` rendered the inner AI
    Workforce design with zero horizontal overflow and no measured interactive
    control below `44x44` CSS pixels; full AppRail/header/shared-launcher fit
    remains a served-product completion gate;
  - all five lens links selected exactly one matching panel and preserved the
    canonical hash; the two mobile selectors replaced both desktop nav rows;
  - light and dark theme checks covered 98 rendered text samples with zero
    WCAG AA contrast failures after adding a theme-aware primary-action
    foreground token;
  - Axe reported zero violations and zero incomplete checks after the filter
    cluster gained explicit `role="group"` semantics;
  - the visible keyboard structure contained no positive `tabindex`, unlabeled
    control, or duplicate ID, and focused controls rendered a 3px focus ring;
  - the named-work dialog closes on Escape and restores focus, and the state
    appendix provides interactive context-preserving recovery examples.
- These checks approve the repository prototype only. Component, served-route,
  focus-trap, reduced-motion, and live desktop/mobile evidence remain completion
  gates for the implemented product.

### Architecture review

Independent advisory `019fbb85-c4db-7dc1-88ab-d056faefc13c`:

- Alignment: sound direction with required pre-implementation corrections.
- Adopted: separate implementation and completion dependencies; sole actionable
  Inbox with decision-source parity; navigation metadata separated from Purpose
  ownership; explicit route classifications; versioned runtime launch/recovery
  parsing; safe-return allow-listing; executable route dispositions with dynamic
  matching; final-label/atomic design reconciliation; and a concrete
  blast-radius ownership table.
- Standards: DPF single-source-of-truth and human-attention contracts; OWASP
  unvalidated redirect guidance; RFC 3986 fragment semantics.
- Escalated decisions: none. The corrections converge existing canonical owners
  and do not require a competing architectural option.
- Final correction pass approved the canonical launch/recovery contract, valid
  route classifications, and machine-led exhaustive disposition requirement;
  no architecture findings remain. Exact-source closure re-review of
  `4df36fb356a83969f567fff1ac0cef41d9bd0816` again returned `FIT` with no P0-P2
  findings after the prototype behavior corrections.

## Completion Gate

This BI is complete only when:

- the exact branch SHA passes the governed merged-code gate;
- the regular PR is healthy, review threads are resolved, and the merge queue lands it;
- the canonical install advances through self-upgrade;
- desktop and mobile acceptance passes on served bytes containing the merge;
- Marketing starts positively and the fail-closed coworker case remains non-executable;
- the five labels are the only visible AI Workforce section model;
- no canonical owner was duplicated;
- durable UX findings and any residual route-retirement work are recorded in the live backlog.

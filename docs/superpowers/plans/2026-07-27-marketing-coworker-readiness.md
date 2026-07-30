# Marketing Coworker Readiness

> For agentic workers: execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for behavior changes, `dpf-local-merge-ci-before-push` plus the completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Make Marketing the first genuinely available AI coworker for a
food-and-hospitality install. The live operator must be able to find Marketing,
see which service is ready, open the named Marketing conversation, and receive a
response. Customer Advisor remains fail-closed while its advertised backing
skill and tool do not exist.

- Backlog item: `BI-C1943813`
- Epic: `EP-UX-SYSTEM`
- Design: `docs/superpowers/specs/2026-07-25-ai-workforce-ia-design.md`
- Live failure: `VR-AI-WORKFORCE-LIVE-20260727`
- WWMD decision: `DI-865698390724` (`vertical-slice-first`, high confidence)
- Readiness architecture decision: `DI-999249BFE2E8`
  (`bulk-canonical-projection`, high confidence)

## Backlog Coverage

- Decision: `atomic`
- Receipt: `cms6c6ybe00k701l2gzg8u1zs`
- Plan path:
  `docs/superpowers/plans/2026-07-27-marketing-coworker-readiness.md`

The readiness evaluator, Marketing applicability declaration, roster/record
consumption, and named Ask entry are not independently useful releases. Without
all four, the live directory either remains unusable or overstates capability.

| Key | Deliverable | Depends on |
| --- | --- | --- |
| `service-readiness` | Evaluate advertised service backing from governed evidence | None |
| `marketing-applicability` | Declare the real Marketing campaign service for food and hospitality | Service readiness |
| `roster-record-entry` | Consume readiness and expose a named Marketing entry | Both prior deliverables |
| `verification-docs` | Update guidance and prove the live workflow | Roster/record entry |

## Existing Substrate

- `StorefrontConfig.archetypeId` resolves the install leaf and category.
- `CoworkerService.archetypes` is explicit applicability evidence.
- `projectCoworkerAvailability` owns owner-readable availability states.
- `CoworkerService.backingSkillIds`, `backingToolNames`, and
  `backingGrantKeys` describe executable backing.
- `PLATFORM_TOOLS` is the registered first-party tool catalog. UI read paths
  consume a lightweight verified service-tool list whose parity with
  `PLATFORM_TOOLS` is enforced in tests; they do not import the execution
  registry.
- `TOOL_TO_GRANTS`, `expandGrants`, and the persisted `AgentToolGrant` rows own
  effective tool authority.
- `SkillAssignment` owns enabled catalog-skill assignment.
- active `CoworkerCapabilityNeed` blockers already load with the roster.
- `loadEndpointManifests`, routing policy and overrides, persisted provider
  capacity, and `routeEndpointV2` own executable model eligibility.
- `AskCoworkerButton` and selected-coworker route resolution own the shared
  conversation entry.

No new table, availability store, wildcard archetype meaning, or UI-local
inference is introduced.

## UX Fit Review

- **Verdict:** fits with guardrails.
- **Owning area and persona:** Platform > AI Workforce, serving the
  founder/operator or AI-workforce operator who needs to find a coworker that
  can perform a real job now.
- **Route family:** existing `/platform/ai/overview` roster and
  `/platform/ai/agent/[agentId]` record. This is a contextual work-entry
  improvement, not a new global, section, or local navigation layer.
- **First-view job:** identify a relevant coworker, understand whether at least
  one service is usable for this business type, and open that coworker.
- **Progressive disclosure:** the card keeps one availability state and one
  named action. Service identity, backing evidence, skills, grants, provider
  routing, and blockers remain in the existing record/disclosure surfaces.
- **Component reuse:** `RosterView`, `StatusBadge`/existing availability
  presentation, `AskCoworkerButton`, and `OwnerFirstDisclosure`. No new card,
  status vocabulary, filter, tab, or launcher is introduced.
- **Source truth:** `StorefrontConfig`, `CoworkerService`, enabled
  `SkillAssignment`, persisted `AgentToolGrant`, `PLATFORM_TOOLS`, provider
  state, and governed capability blockers. Presentation code does not infer
  readiness from a coworker name or portfolio.
- **Empty and failure states:** missing or contradictory evidence fails closed
  to existing setup/attention/coverage states with an owner-readable next
  action. Customer Advisor remains unavailable while its backing is absent.
- **AI action boundary:** `Ask Marketing` opens the selected coworker but sends
  nothing. Message submission remains the explicit action boundary.
- **Evidence required:** focused projection/seed/component tests; merged-source
  build; desktop and 390x844 sandbox screenshots; selected-coworker assertion;
  harmless Marketing response; Customer Advisor fail-closed assertion; browser
  console and horizontal-overflow checks.

### Independent Critique

Two read-only reviewers independently evaluated the uncommitted design and
implementation before CI. Both rejected the first pass as not
acceptance-ready. Their shared release blockers and the adopted corrections
are:

| Critique | Correction |
| --- | --- |
| Roster folded canonical and slug evidence while the record read only the canonical row | Both surfaces now resolve the same executable runtime slug; grants, skills, model routing, and blockers come from that identity |
| An unpinned coworker passed provider health without any provider | Readiness now requires an eligible canonical conversation route; provider and model pins remain preferences, so an eligible fallback can keep the coworker available |
| One ready service hid unresolved siblings while all services appeared as work offered now | Discovery retains every service projection; the first view shows only `Ready work`, while Work Offered and Availability preserve individual sibling states |
| Malformed or empty backing arrays passed as clear | Invalid or absent executable backing fails closed to owner-readable setup work |
| Raw skill/tool identifiers leaked into the lead explanation | First-view reasons use owner language; raw dependency facts appear only under Availability evidence |
| Page-load code imported the full MCP execution graph | A lightweight verified service-tool constant is shared with the seed and protected by a `PLATFORM_TOOLS` parity test |

A second independent UX/implementation review rejected the rebased patch before
its exact-SHA gate. WWMD compared a local provider heuristic, one `previewRoute`
call per coworker, and one bulk canonical projection. The kernel selected the
bulk projection because it best satisfies Ship Real Functionality and Never
Fabricate without adding 77 repeated setup calls.

| Second critique | Correction |
| --- | --- |
| `Available` ignored sensitivity, capability/context floors, model tier, policy, capacity, local-only mode, and model pins | Roster and record load canonical routing inputs once and evaluate each coworker through `routeEndpointV2`; the selected route must also clear canonical hard constraints and success floors |
| Interaction badges aggregated every active service, even when a different service drove availability | Interaction now resolves only from services tied for the winning availability state; all sibling states remain under progressive disclosure |
| `Finish setup` linked to `/setup`, which redirects configured installs away from the problem | `Review setup` deep-links to the coworker's Availability tab and preserves the filtered roster return URL |
| Component fixtures made Customer Advisor appear available without real backing | Marketing is the positive fixture; Customer Advisor is explicitly setup-blocked and has no Ask action |

A third architecture and UX critique found that the second implementation still
reported a lower-level route as if it were a usable conversation. The revised
contract now shares composition code with live dispatch rather than maintaining
a synthetic parallel request.

| Third critique | Correction |
| --- | --- |
| Golden Triangle posture and DB-backed conversation requirements could diverge from readiness | Live dispatch and readiness now share initial-route and effective-request-contract builders; dimension floors merge with stricter-wins semantics |
| A configured pin was treated as a hard boundary even though dispatch falls back | Pins remain preferences; readiness evaluates the same eligible fallback pool |
| A sole provider in `reauth_required` or billing repair could still be advertised | The directory makes the stronger owner promise and blocks conversation entry for a selected provider with a known repair state |
| Workforce and record health counted raw route eligibility | Owner-facing health is derived from the full service availability projection and `canStartConversation` |
| Routing metadata failure could break the entire coworker record | Snapshot failure projects a recoverable needs-attention reason and keeps the record reachable |
| Capacity-store read failure could silently erase known provider repair evidence | Capacity evidence now fails through the same blocked snapshot path and has a loader-level rejection test |
| Customer Advisor could fail closed only because coverage was undefined | An integrated test evaluates the canonical seed backing, proves the missing skill/tool/grants, and verifies the rendered record has no Ask action |
| Moving from Availability to Capabilities dropped roster context | The Capabilities setup action preserves the validated `returnTo` query and restores the filtered roster |
| Fail-closed records still described interaction as “currently available” | The record says “currently available” only when Ask is possible; otherwise it labels the best-matching declared work |

A fourth architecture re-review tested the remaining selection boundaries
against live dispatch rather than accepting route construction alone.

| Fourth critique | Correction |
| --- | --- |
| Readiness stopped before the provider/model preference finalization used by live dispatch, so a below-floor preference could disagree with the advertised fallback | Both paths now call one pure preference finalizer over the canonically eligible candidate set; an excluded preference cannot replace the eligible winner |
| A persisted endpoint pin returned before explicit blocks, policy, sensitivity, residency, capability, context, quality, runtime cooldown, and persisted capacity checks | The pin fast path was removed. Pins now select only from candidates that cleared the complete canonical pipeline; direct tests cover every fence and preserve the eligible fallback |
| Provider/model finalization happened after the execution plan was built | Preference finalization now precedes recipe selection and plan construction, so provider, model, adapter, recipe, and settings describe one winner |
| Preview and live dispatch applied preferences in different stages | Both pass the same preferences into `routeEndpointV2`; parity tests cover provider and model preferences |
| Downgrade behavior parsed human-readable reason text | `RouteDecision.preferenceResolution` is the structured source for applied and unavailable preferences and the user-facing downgrade message |
| A model preference could escape its selected provider | Provider and model are finalized as one pair; a stale or duplicate model id is resolved only within the selected provider and otherwise reported unavailable |

A fifth independent architecture and UX review rejected the gate-passing patch
because its visible promise could still diverge from real dispatch.

| Fifth critique | Correction |
| --- | --- |
| Generic conversation readiness did not prove the advertised campaign work | Each service declares a validated representative task type, prompt, and tool-use requirement; readiness evaluates that exact task through task-specific requirements and overrides |
| Strict lifecycle certification could reject a coworker still shown as Available | Roster and record include the canonical lifecycle gate verdict; draft, retired, or strict failed-certification coworkers lose Ask and receive typed recovery |
| Area, job, interaction, availability, and actions could come from different sibling services | One deterministic winning service now owns every first-view claim; all sibling services remain available under progressive disclosure |
| Recovery destinations were inferred from English reason text | Readiness emits a closed recovery kind mapped centrally to business type, catalog, capabilities, capability needs, lifecycle, or routing |
| The roster would evaluate lifecycle once per coworker | A batch lifecycle projection reads agents, strict mode, and certification evidence once for the roster |
| The seed test recorded calls without proving repeatability or preservation | A stateful test runs the seed twice, proves the empty Marketing declaration backfills once, and proves an operator-authored declaration survives |

A sixth UX review rejected the remaining first-view and recovery behavior. The
correction keeps every visible promise tied to an action the destination can
actually complete.

| Sixth critique | Correction |
| --- | --- |
| Area filtering matched hidden sibling services while the card stayed grouped under its winning service | The area facet now filters on the same winning area shown on the card |
| Catalog and lifecycle recovery links did not reach owner-capable repair controls | Lifecycle opens the runnable certification job; platform-owned catalog defects fail closed without a misleading operator action |
| The catalog clipped its fixed-width offer grid on mobile | Mobile renders a compact fact list; the dense grid is desktop-only |
| The exact snapshot exposed an ambiguous multi-card test query | The assertion is scoped to the Marketing card and remains explicit about primary versus secondary action styling |

A seventh architecture review rejected role-blind recovery and duplicated
responsive interpretation. Both corrections move into shared typed
projections.

| Seventh critique | Correction |
| --- | --- |
| Workforce roles without Admin access received a lifecycle action that resolved to a 404 | Recovery targets carry their required capability and render only when the signed-in operator holds it |
| Mobile and desktop catalog layouts interpreted offer metadata separately and exposed different facts | One offer-presentation projection supplies both layouts, including version, provider organization, authority, and product anchor, with parity-focused tests |

An eighth architecture pass applied the same truth test to every recovery route
and to nullable provider metadata.

| Eighth critique | Correction |
| --- | --- |
| Capability-need recovery could still send workforce-only roles to an Operations 404 | Every recovery destination now declares its route capability, and one generic authorization check suppresses inaccessible actions |
| A missing provider organization made mobile label the provider kind as an organization | The shared projection preserves the secondary provider fact's semantic label and tests both organization and provider-type cases |

A ninth UX pass checked whether every discovery cue and recovery command still
described the same actionable work.

| Ninth critique | Correction |
| --- | --- |
| `Review capabilities` appeared for read-only platform roles | Capability recovery now requires `manage_platform`, the same authority that enables the destination editor |
| Desktop showed a provider kind without identifying what the secondary value meant | Desktop and mobile both render the projection-owned provider organization/type label |
| Search indexed hidden unavailable sibling services while the card advertised only its winning service | Searchable work text now comes from the same winning service as area, job, interaction, availability, and actions |

## Phase 1: Test-Drive Service-Scoped Readiness

Add failing unit tests before implementation.

### Behavior

Create a pure service-readiness projection that receives one advertised
service plus already-loaded evidence:

- registered tool names;
- enabled assigned skill ids;
- effective held grants;
- representative service-task route readiness;
- canonical lifecycle and certification readiness;
- active blocking capability-need count.

Return the existing `CoworkerAvailabilityReadiness` shape:

- blockers for unavailable canonical routing or active governed blockers;
- missing prerequisites for missing skills, unregistered tools, missing declared
  grants, or tool-specific grant denial;
- evaluated and clear only when all declared backing is real and usable.

`projectRosterAvailability` must resolve readiness per service. One ready,
applicable service may make a coworker available; unresolved sibling services
must retain their own evidence and must not be represented as ready.

### Files

- Add:
  `apps/web/lib/coworker-service-catalog/service-readiness.ts`
- Add:
  `apps/web/lib/coworker-service-catalog/service-readiness.test.ts`
- Update:
  `apps/web/lib/coworker-record/roster-presentation.ts`
- Update:
  `apps/web/lib/coworker-record/roster-presentation.test.ts`
- Update:
  `apps/web/lib/coworker-service-catalog/availability-projection.ts`

### TDD Cases

- A service with registered tools and sufficient grants is evaluated clear.
- A missing declared skill returns setup-needed evidence.
- An unregistered tool returns setup-needed evidence.
- A registered tool denied by effective grants returns setup-needed evidence.
- A missing declared grant returns setup-needed evidence.
- No endpoint satisfying the coworker's canonical routing contract returns
  needs-attention evidence.
- A blocking capability need returns needs-attention evidence.
- Marketing can be available from one ready applicable service while an
  unresolved sibling service remains non-ready.
- Customer Advisor remains non-available while its missing backing persists.

## Phase 2: Load Governed Evidence Once

Extend the existing roster and record loaders rather than issuing per-card
queries.

- Include backing skill, tool, and grant declarations in discovery-service
  reads.
- Load enabled skill assignments and persisted tool grants for selectable
  coworkers in bulk.
- Resolve slug and canonical coworker identities into one effective evidence
  set.
- Load endpoint manifests, policy, overrides, capacity, local-only mode,
  DB-backed conversation requirements, and effective Golden Triangle postures
  once; project each coworker through the shared canonical request-contract
  builder and routing pipeline without per-card database calls.
- Use the lightweight verified service-tool list, with test-only parity against
  `PLATFORM_TOOLS`.
- Pass service-id-keyed readiness into the shared discovery projection.
- Make the service that wins availability also own the first-view interaction
  label; preserve every sibling under Availability evidence.

### Files

- Update:
  `apps/web/lib/coworker-service-catalog/catalog.ts`
- Update:
  `apps/web/lib/coworker-record/roster.ts`
- Update:
  `apps/web/lib/coworker-record/load-record.ts`
- Update relevant loader and route tests.

## Phase 3: Declare the First Truthful Service

Set only `svc-marketing-campaign-execution` to the governed
`food-hospitality` category. Preserve all other unresolved services as empty
declarations.

Seed updates must preserve valid install-specific declarations on ordinary
updates and apply the new category only through an explicit, idempotent narrow
backfill for this canonical service.

Add invariants that:

- every non-empty declaration resolves to a canonical category or leaf;
- the Marketing campaign service includes `food-hospitality`;
- Customer Advisor does not become applicable or ready by implication;
- advertised backing tool names for the first slice exist in the registered
  platform tool catalog.

### Files

- Update:
  `packages/db/src/coworker-service-catalog-seed.ts`
- Update:
  `packages/db/src/coworker-service-catalog-seed.test.ts`
- Add a web-side catalog/tool parity test if importing the web tool registry
  into the DB package would violate package ownership.

No schema migration is planned.

## Phase 4: Named Work Entry and Progressive Evidence

- Change the roster action from generic `Ask this coworker` to
  `Ask <display name>`.
- Keep the current no-auto-send boundary: opening the panel does not send.
- Include service id and service name in availability evidence so the advanced
  disclosure explains which work is ready.
- On the record, show the named Ask action only when at least one applicable
  service is conversation-ready.
- Do not move skills, grants, routing, or provider administration into the first
  viewport.

### Files

- Update:
  `apps/web/components/platform/coworker-record/RosterView.tsx`
- Update:
  `apps/web/components/platform/coworker-record/RosterView.test.tsx`
- Update:
  `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx`
- Update:
  `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx`

## Refactoring Allowance

Reserve roughly one fifth of the implementation effort for direct convergence:

- one pure service-readiness evaluator;
- one canonical identity-folding helper for skills and grants;
- one service-id-keyed readiness contract shared by roster and record;
- one bulk canonical route-readiness snapshot shared by roster and record;
- one batched lifecycle projection for the roster;
- one typed availability-recovery mapper shared by roster and record;
- projection-owned readiness reasons and evidence, not page-owned wording.

This allowance excludes unrelated catalog cleanup and new administration UI.

## Documentation

Update `docs/user-guide/ai-workforce/index.md` to explain:

- availability is service-backed and business-type-specific;
- `Available` means at least one advertised service has verified backing;
- unresolved sibling work remains visible as setup evidence;
- opening Ask does not send until the operator submits a message.

## Risk and Rollback

| Risk | Control | Rollback |
| --- | --- | --- |
| One ready service incorrectly blesses every service | Service-id-keyed readiness and evidence tests | Revert consumer wiring; conservative unknown state returns |
| Alias/canonical grants diverge | Fold both identities before evaluation | Use canonical-only evidence and return setup-needed |
| Tool registry import creates a server bundle cycle | Keep evaluator pure and inject a tool-name set from the loader | Replace with a lightweight exported registry adapter |
| Seed overwrites operator-authored coverage | Narrow idempotent backfill and preservation tests | Revert the seed declaration independently |
| Ask routes to a generic coworker | Selected-route and browser assertions | Hide Ask while preserving the record |

## Completion Gate

1. Revalidate plan coverage receipt `cms3bszjf022w01p517qd84kj`.
2. Observe the focused tests fail before implementation and pass afterward.
3. Run affected web and DB Vitest suites.
4. Run web and DB typechecks where the source-only worktree permits; otherwise
   classify them as unrun and use the shared local-CI gate.
5. Run the production build, migration check, and merged-tree gate through
   `pnpm run pregate`.
6. Obtain independent architecture and UX `fit` verdicts on the exact patch.
7. Verify desktop and 390x844 mobile behavior in the shared sandbox.
8. After merge and governed self-upgrade, run canonical live acceptance:
   - Availability=Available returns Marketing.
   - the Customers and sales card says `Available for your business type`;
   - `Ask Marketing` opens Marketing;
   - a harmless campaign-planning message receives a Marketing response;
   - Customer Advisor remains fail-closed;
   - no horizontal overflow or browser errors occur.
9. Record evidence against `BI-C1943813` and only then mark it done.

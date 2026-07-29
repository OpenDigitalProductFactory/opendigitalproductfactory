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
- active `CoworkerCapabilityNeed` blockers and provider status already load with
  the roster.
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
| An unpinned coworker passed provider health without any provider | Readiness now requires positive evidence of an active provider with an active tool-capable model; a pin must identify that eligible provider |
| One ready service hid unresolved siblings while all services appeared as work offered now | Discovery retains every service projection; the first view shows only `Ready work`, while Work Offered and Availability preserve individual sibling states |
| Malformed or empty backing arrays passed as clear | Invalid or absent executable backing fails closed to owner-readable setup work |
| Raw skill/tool identifiers leaked into the lead explanation | First-view reasons use owner language; raw dependency facts appear only under Availability evidence |
| Page-load code imported the full MCP execution graph | A lightweight verified service-tool constant is shared with the seed and protected by a `PLATFORM_TOOLS` parity test |

## Phase 1: Test-Drive Service-Scoped Readiness

Add failing unit tests before implementation.

### Behavior

Create a pure service-readiness projection that receives one advertised
service plus already-loaded evidence:

- registered tool names;
- enabled assigned skill ids;
- effective held grants;
- provider health;
- active blocking capability-need count.

Return the existing `CoworkerAvailabilityReadiness` shape:

- blockers for unhealthy provider state or active governed blockers;
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
- An unhealthy provider returns needs-attention evidence.
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
- Use the existing provider and blocker reads.
- Use the lightweight verified service-tool list, with test-only parity against
  `PLATFORM_TOOLS`.
- Pass service-id-keyed readiness into the shared discovery projection.

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
- projection-owned readiness reasons and evidence, not page-owned wording.

This allowance excludes route consolidation, unrelated catalog cleanup, and new
administration UI.

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
6. Verify desktop and 390x844 mobile behavior in the shared sandbox.
7. After merge and governed self-upgrade, run canonical live acceptance:
   - Availability=Available returns Marketing.
   - the Customers and sales card says `Available for your business type`;
   - `Ask Marketing` opens Marketing;
   - a harmless campaign-planning message receives a Marketing response;
   - Customer Advisor remains fail-closed;
   - no horizontal overflow or browser errors occur.
8. Record evidence against `BI-C1943813` and only then mark it done.

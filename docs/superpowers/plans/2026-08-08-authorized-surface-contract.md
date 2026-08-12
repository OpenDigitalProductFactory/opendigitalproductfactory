# Authorized Surface Contract — Implementation Plan

> **For agentic workers:** execute this plan as one integrated platform change on the existing Authorized Surface Contract branch and PR. Preserve independent tests, evidence, and completion accounting for every mapped BI inside that PR. This delivery shape is the founder/operator direction recorded on 2026-08-08 and supersedes the earlier one-BI-per-PR sequencing. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Umbrella BI:** BI-3E872DFB

**Epic:** EP-F7E35344

**Design:** `docs/superpowers/specs/2026-08-08-authorized-surface-contract-design.md`

**Architecture decision:** DI-204400DDA2A5 (`live-semantic-page-graph`, extended here as render-independent ASC)

**Coverage receipt:** `cmsl4bb400ik501o2arpsw3ru`

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-08-08-authorized-surface-contract-design.md`
  - `docs/superpowers/specs/2026-05-31-pseudo-user-contract-design.md`
  - `docs/superpowers/specs/2026-08-05-headless-employee-external-agent-wwwd-exposure-design.md`
  - `docs/superpowers/plans/2026-07-09-unified-coworker-parity-formassist-buildcontext-plan.md`
  - `docs/superpowers/plans/2026-07-20-coworker-interaction-surface-gap-followup.md`
- Current code substrate reviewed:
  - `apps/web/lib/actions/agent-coworker.ts` and the TAK prompt, grant, autonomous-run, and tool-budget paths
  - `apps/web/lib/tak/route-context/`, `apps/web/lib/tak/discovery-operations-route-context.ts`, and the Discovery operations view model/components
  - `apps/web/lib/mcp-governed-execute.ts`, `apps/web/lib/mcp/pack-registry.ts`, the MCP tool packs, and governed-surface annotations
  - `apps/web/lib/coworker/screen-manifest-types.ts`, `apps/web/lib/mcp/packs/screen-pack.ts`, and existing browser/mobile/workroom execution seams
- Source of truth:
  - Shared feature loaders/view models own application state and UX meaning; existing MCP/domain actions plus `AuthorityBinding` and coworker grants own authorization and persistent effects. The Authorized Surface Contract compiles and projects those sources for every renderer and agent mode without becoming a second state, policy, or action system.
- Decision:
  - Extend the existing coworker, route-context, MCP execution, and Discovery feature substrate with one render-independent ASC catalog/session/query/action protocol. Treat `PageContext`, `ScreenManifest`, DOM/accessibility inspection, and `screen_*` tools as compatibility or conformance projections, and automatically inject relevant authorized surfaces into coworker runs instead of creating page-specific coworker fixes.

## Outcome

Ship a versioned, render-independent Authorized Surface Contract so every AI coworker can perceive and operate its authorized product surfaces in browser, mobile, workroom, scheduled, background, and external/headless modes. The UX and coworker contract derive from the same application semantics, and CI prevents either from drifting.

## Backlog coverage

Coverage decision: **decomposed for scope and evidence; integrated for delivery**. The live backlog receipt `cmsl4bb400ik501o2arpsw3ru` validates six independently testable mappings for umbrella BI-3E872DFB. All mappings land together in one PR because they form one platform primitive whose security, compatibility, and conformance guarantees are only complete when evaluated end to end.

| Key | Backlog item | Deliverable | Depends on |
|---|---|---|---|
| `governed-read-act-parity` | BI-F9204A97 | Existing guard: governed data surfaces ship matching read/act MCP tools | — |
| `core-contract` | BI-3A70F86B | Versioned semantic contract, compiler, session, and query runtime | — |
| `action-security` | BI-E9018F3B | Authority intersection, provenance, redaction, and governed execution | `core-contract` |
| `browser-mobile-projections` | BI-8B15C210 | Browser, accessibility, mobile, and legacy screen projections | `core-contract` |
| `headless-workroom-runtime` | BI-1BEF3F52 | Workroom, scheduled, background, and external surface sessions | `core-contract`, `action-security` |
| `conformance-migration` | BI-008E7969 | Automated UX parity, migration, telemetry, and release gates | all preceding deliverables |

Before starting or resuming implementation, call `check_plan_backlog_coverage` with the umbrella BI, this plan path, and the receipt. A stale or invalid receipt stops implementation until live coverage is repaired.

## Substrate constraints

- Reuse the dual-principal pseudo-user contract, existing MCP tool registry/envelopes, `AuthorityBinding`, tool grants, route/work context, shared loaders/read models, and audit/evidence stores.
- `ScreenManifest`, `PageContext`, route providers, and `screen_*` tools are migration inputs/adapters, not new parallel sources.
- Do not add a database model for static definitions or ephemeral sessions without a fresh schema/substrate decision.
- Do not add an external protocol/library until the tool-evaluation pipeline covers security, self-hosting, license, deployment, and architecture fit.
- Runtime-bound verification uses the canonical runtime/shared lease; a worktree-local server is not evidence.

## Delivery 0 — Existing governed read/act parity

**BI:** BI-F9204A97 · independently evidenced in the integrated PR

Complete the existing plan for the invariant that a governed data surface has matching authorized read/act MCP operations. Extend its output so the later ASC compiler can consume stable tool/action annotations rather than rebuilding a second registry.

Expected seams:

- MCP tool registry and annotations
- governed surface/action metadata
- CI registry/coverage tests
- existing plan attached to BI-F9204A97

Verification:

- A fixture surface without its declared read or domain action fails the guard.
- Existing tools continue to list/call under unchanged authorization.
- Registry output is deterministic and consumable by the ASC compiler.

Rollback: keep the metadata additive until consumers land; disabling the new guard must not remove existing tool authorization.

## Delivery 1 — Core semantic contract and runtime

**BI:** BI-3A70F86B · independently evidenced in the integrated PR

### 1.1 Define schemas and stable identity

Introduce a focused shared module (final package location chosen after code-graph verification) for `SurfaceDefinition`, entry points, semantic node/action definitions, presentation hints, session context, graph snapshots/deltas, cursors, provenance, errors, and contract compatibility. Use generated TypeScript/JSON Schema where existing generators support it.

Tests first:

- stable ID uniqueness and deterministic compilation
- schema compatibility/additive-change fixtures
- rejection of unknown node kinds, unbound actions, missing accessible names, invalid sensitivity/provenance, and route-as-identity misuse
- no password/secret-readable node shape

### 1.2 Build the compiler/catalog

Extend existing route-manifest/build tooling rather than adding a parallel scanner. Compile definitions from shared feature primitives and explicit feature metadata into deterministic artifacts carrying source/contract digests. Build catalog entry-point indexes for route, mobile view, workroom type, resource type, and task intent.

Verification: one reference surface compiles once and resolves through at least route and task-intent entry points; duplicate/stale artifacts fail loudly.

### 1.3 Implement principal-bound sessions and query

Resolve the shared loader/view model using organization, delegating user, acting agent, work context, locale/timezone, and current authority. Project bounded snapshots, subtree queries, cursors, revisions, deltas, and typed failure results. Keep sessions ephemeral/cacheable and invalidate on state or authority changes.

Likely integration seams after re-verification:

- `apps/web/lib/tak/route-context/types.ts` and route context resolution
- coworker route/work context and prompt arbitration
- shared loader/read-model modules
- MCP registry packaging and context-budget logic

Verification:

- same fixture/principal yields deterministic graph/revision
- row/field/tenant differences alter projection before serialization
- stale and authority-invalidated sessions refuse use
- large collections paginate without DOM dependence
- compact open/summary fits the bundled-local-model budget

Rollback: the core is additive and read-only for its first reference surface; old PageContext remains the fallback until projection parity passes.

## Delivery 2 — Governed action security

**BI:** BI-E9018F3B · depends on BI-3A70F86B · independently evidenced in the integrated PR

### 2.1 Bind actions to existing execution

Add `SurfaceActionBinding` compilation against the MCP/domain registry. Split UI-local reversible state transitions from persistent/external domain effects. Dispatch domain actions through existing tool authority and evidence envelopes; never invoke implementation callbacks supplied by surface content.

### 2.2 Enforce one authority intersection

Apply user role/row/field scope, coworker grants, `AuthorityBinding`, token scope/grants, clearance, work context, and action risk identically to list/snapshot and act. Coordinate—not duplicate—BI-56E9CEC2 and EP-31815F97.

### 2.3 Add provenance, redaction, and injection boundaries

Tag source/trust/sensitivity, exclude hidden/secret data, separate trusted definitions from untrusted values, generate confirmations from trusted metadata, and audit subject+actor+surface+revision+action+tool+evidence.

Tests first:

- list/call authority parity across roles, grants, bindings, scopes, clearance, tenants, and work contexts
- prompt-injection strings remain values and cannot register actions/instructions
- secret/password fields are never returned
- stale revision and duplicate idempotency key behave deterministically
- high-risk action cannot bypass confirmation/evidence
- UI-local action cannot cross sessions or cause a domain mutation

Functional verification: use the reference surface to complete one read, draft, validation failure, confirmed mutation, refresh, and audit lookup under two roles.

Rollback: action bindings are feature-flagged per compiled surface during rollout; server domain authorization is never weakened or bypassed.

## Delivery 3 — Browser, accessibility, mobile, and legacy projections

**BI:** BI-8B15C210 · depends on BI-3A70F86B · independently evidenced in the integrated PR

### 3.1 Drive the reference UI from shared semantics

Refactor the reference surface so React/RSC/client components and ASC projector consume the same loader/view model and action definitions. Shared UI primitives emit stable semantic IDs, accessible names/state, validation, and bindings automatically.

### 3.2 Carry co-present client state

Add a typed, sequenced adapter for drafts, selection, open panels, viewport/virtualization, streaming/live state, and reconnect snapshots. Client state may enrich the session but cannot redefine domain authorization or trusted action metadata.

### 3.3 Adapt legacy screen/page perception

Refactor:

- `apps/web/lib/coworker/screen-manifest-types.ts`
- `apps/web/lib/coworker/manifests/index.ts`
- `apps/web/lib/mcp/packs/screen-pack.ts`
- `apps/web/lib/tak/route-context.ts`, `route-context-map.ts`, and route-specific providers

Make `screen_*` tools aliases over surface sessions. Compile existing PageContext/ScreenManifest declarations as compatibility inputs. Add DOM/accessibility inventory only to find and diagnose unmapped legacy controls; do not grant it canonical status.

Verification:

- browser and server/headless semantic digests match except declared presentation-only state
- accessibility role/name/state and chart/table text alternatives are complete
- virtualized rows are queryable even when not mounted
- draft/selection deltas reconnect without losing ordering
- existing screen consumers retain compatible behavior through aliases
- light/dark/org branding remains correct because no new hardcoded UI styling is introduced

Rollback: switch individual surfaces back to legacy projection while preserving compiled artifacts and telemetry; aliases keep consumer compatibility.

## Delivery 4 — Headless, workroom, scheduled, and external sessions

**BI:** BI-1BEF3F52 · depends on BI-3A70F86B and BI-E9018F3B · independently evidenced in the integrated PR

### 4.1 Expose the generic surface protocol

Implement `surface_list`, `surface_open`, `surface_snapshot`, `surface_query`, `surface_act`, and `surface_close` through the existing MCP registry, grants, token, context-budget, and tool-annotation substrate. Load the compact protocol by default/on demand; do not attach per-page tools to every prompt.

### 4.2 Resolve surfaces from work, not URLs

Integrate catalog discovery with workroom/workspace/resource context, work capsules, scheduled/background delegation, coworker runtime mode, and external employee sessions. Preserve organization, subject, actor, and work-context provenance on every call.

### 4.3 Model virtual UI-local state

Support form drafts, selection, navigation, panels, and pagination without rendering. Ensure the same validation and submit binding drives both browser and headless flows.

Verification:

- complete the reference journey with no browser process or DOM
- workroom catalog exposes relevant authorized surfaces and excludes unrelated/unauthorized ones
- scheduled execution respects expiry, confirmation, and human escalation
- external MCP list/call results match in-platform authority
- route rename does not break stable surface discovery
- tool count and context size remain within local-model constraints

Rollback: disable headless entry points by mode while leaving browser projection intact; revoke sessions/tokens through existing authority controls.

## Delivery 5 — Conformance, migration, telemetry, and enforcement

**BI:** BI-008E7969 · depends on all preceding deliverables · independently evidenced in the integrated PR

### 5.1 Add parity and security harnesses

Create fixtures that render and project the same principal/data/locale/surface, compare normalized semantic digests, exercise every available action, and verify resulting state. Add role/tenant/clearance/binding matrices, injection/redaction cases, stale revisions, i18n, accessibility, chart/canvas, virtualized collections, streaming, iframe/embedded boundaries, mobile form factor, and local-model context budgets.

### 5.2 Migrate incident and high-value surfaces

First migrate the Discovery **SNMP** setup journey end to end. The originating user called it “SMTP discovery”; the product surface actually offers SNMP. Conformance therefore proves that the coworker corrects the protocol distinction, knows the real Discovery Method, Target IP or Hostname, Community String, validation, current gateway/connection state, and Save & Test outcome, and can populate/test/save when authorized. It must not invent a gateway panel or conflate outbound-email SMTP with network discovery SNMP. Then migrate high-value workroom/operational surfaces based on observed usage and risk. Convert old route providers/manifests; do not preserve duplicate fetch/context logic.

### 5.3 Instrument the fleet

Measure contract coverage, unmapped controls/actions, compatibility fallbacks, projection latency/size, stale conflicts, authority filtering, graph parity, action outcomes/evidence, and coworker answers produced without a relevant surface lookup. Dashboards must distinguish missing semantics from missing authority.

### 5.4 Ratchet enforcement

Sequence: inventory → warning for legacy surfaces → required for new/changed governed UX → migrate remaining surfaces → forbid new independent PageContext/ScreenManifest truth → retire compatibility paths after coverage and consumer thresholds. Once the CI guard is operative, add the concise code invariant to root `AGENTS.md` in the same PR so every development surface learns that human-visible governed UX must project through ASC and every persistent action must have a governed binding. Update route/architecture/coworker/install/user documentation in the owning PRs.

Verification:

- a new unbound control, missing accessible name, data view without read projection, or browser/headless mismatch fails CI
- canonical-runtime golden journeys pass browser and headless Discovery SMTP flows
- release evidence includes contract digest, parity result, authority matrix, and action audit
- no route inherits unrelated page data; no coworker guesses when the surface lookup fails
- old adapters can be disabled without losing covered functionality

Rollback: ratchets advance independently and can return one stage while a defect is fixed; compiled contract versions and adapters remain backward compatible through the declared support window.

## Cross-cutting risks

| Risk | Control |
|---|---|
| A second metadata system drifts from React/domain code | Generate from shared loaders/primitives; parity test rendered and headless projections |
| Contract leaks more than the human is authorized to see | Project after row/field/clearance/tenant checks; redaction tests and authority digest invalidation |
| `surface_act` becomes an authority bypass | Resolve only compiled bindings; call ordinary MCP/domain authorization; trusted metadata; evidence envelope |
| Prompt injection enters through visible content | Typed untrusted values/provenance; no raw DOM/HTML; action/instruction namespaces are trusted-only |
| Tool/context explosion harms local models | Six generic tools, summary-first, cursors, deltas, on-demand surface/action resolution |
| Legacy browser behavior blocks headless parity | DOM/AX inventory plus explicit typed client deltas; unmapped behavior is telemetry/CI debt |
| Fleet migration is endless | New-change ratchet first, usage/risk migration order, coverage dashboard, compatibility retirement threshold |
| External precedent becomes vendor lock-in | No dependency selected; tool evaluation before adoption; DPF-owned schema boundary |

## Completion gate

Each BI completes through explicit tests, evidence, and documentation-impact accounting within the single integrated branch/PR. The umbrella completes when:

1. affected unit/contract/render/security tests pass;
2. `pnpm --filter web build` passes with zero errors;
3. browser and headless golden journeys pass in the governed local-integration/pregate environment before merge, including the Discovery SNMP setup and SMTP/SNMP disambiguation case; the live-install journey is post-merge release validation because an unmerged worktree is not canonical runtime truth;
4. any migration applies cleanly against existing data states (none is assumed by this design);
5. plan backlog coverage revalidates against receipt `cmsl4bb400ik501o2arpsw3ru`;
6. all six mapped BIs are done with canonical evidence;
7. user, coworker, architecture, route, operations/install, and external-agent documentation is current;
8. independent semantic/security review approves the stable commits and PR health is mechanically green.

No implementation success claim is valid from a DOM demo, a worktree-local server, unit tests alone, or a page-specific coworker prompt.

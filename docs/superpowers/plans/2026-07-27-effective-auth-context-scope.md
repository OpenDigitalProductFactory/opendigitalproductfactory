# Effective Auth Context Scope Implementation Plan

> For agentic workers: execute this plan in the named Work Capsule, use `dpf-tdd`
> for behavior changes, and keep the migration, context contract, hydration, and
> consumers atomic. Do not infer authorization attributes that an authority did
> not assert.

**Status:** Approved backlog work; implementation in progress.

**Backlog item:** `BI-749EB750`

**Work Capsule:** `WC-1872F636`

**Branch / worktree:** `feat/effective-auth-context-scope` /
`D:\DPF-worktrees\effective-auth-context-scope`

**Plan backlog coverage:** atomic receipt `cms35mgcp0b3101l75ssc51zn`

**Architecture decision:** `DI-72C4B9C1E6D3` selects canonical
`Principal`-owned sensitivity clearance over role-derived or caller-supplied
clearance. The kernel returned high confidence, a 15.4119 composite score, a
7.2927 margin, and no governance flags.

## Outcome

Every authenticated request receives one normalized, population-aware
`EffectiveAuthContext` built from authoritative identity data. The context
contains the canonical principal and aliases, workforce hierarchy, team scope,
account scope, explicit sensitivity clearance, authentication assurance
evidence, and active delegation grants. Missing authority remains empty or
unknown rather than being inferred.

The existing enterprise identity design remains authoritative:
`docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`.
This plan completes the richer-context increment that its original narrow helper
left intentionally open. It also supplies the authorization substrate required
by the response-rehydration slice of
`docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md`.
The broader AI-coworker authority/HITL outcome in `BI-62BFAA95` remains separate
and blocked on its own prerequisite BIs; this plan must not create a local
bypass for them.

## Standards and authority contract

- `Principal` is the authority for identity and sensitivity clearance.
- `PrincipalAlias` is the authority for external and population-specific
  identifiers; aliases are evidence, not a second principal.
- `EmployeeProfile` is the authority for direct and indirect reporting scope.
- `TeamMembership` is the authority for team scope.
- The authenticated customer session is the authority for customer account
  scope until a canonical principal alias links that population.
- `DelegationGrant` is the authority for active human-to-agent delegation.
- RFC 8176 authentication-method references (`amr`) and an optional asserted
  authentication-context reference (`acr`) are carried as evidence. The code
  must not manufacture a NIST authentication assurance level from the mere
  presence of a cookie or bearer token.

References:

- https://www.rfc-editor.org/info/rfc8176/
- https://pages.nist.gov/800-63-4/sp800-63.html

## Backlog coverage

- Decision: atomic
- Parent: `BI-749EB750`
- Receipt: `cms35mgcp0b3101l75ssc51zn`
- Dependency order: principal clearance -> normalized context -> shared loader
  -> authorization consumers.
- Rationale: persisted clearance without a context is dormant authorization
  truth; a context without authoritative hydration invites caller fabrication;
  hydration without wiring protects no requests; and wiring before the other
  three pieces creates inconsistent or weakened authorization.

| Deliverable | Dependency | Independently shippable |
|---|---|---:|
| Fleet-safe canonical Principal sensitivity clearance | None | No |
| Population-aware context contract and normalization | Principal clearance | No |
| Shared authoritative context loader | Clearance and contract | No |
| Middleware and manager-scope consumers | Shared loader | No |

## Effort budget

Use 20% of implementation effort for bounded structural refactoring:

- Extract duplicated bearer/session database hydration from
  `auth-middleware.ts` into one identity-owned loader.
- Keep normalization and hierarchy traversal pure so authorization behavior is
  testable without request or database fixtures.
- Reuse the existing principal-context vocabulary for teams, acting agents, and
  delegation identifiers instead of creating a competing authorization model.

The remaining 80% implements and verifies the requested authorization behavior.

## Phase 1: Canonical sensitivity clearance

**Files**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_principal_sensitivity_clearance/migration.sql`
- Modify or create: canonical identity enum/type module and tests under
  `packages/db/src/`

**TDD and implementation**

- [ ] Add a canonical closed sensitivity vocabulary:
  `public`, `internal`, `confidential`, `restricted`.
- [ ] Add a `Principal` clearance attribute whose existing-row default is
  public-only.
- [ ] Make the migration fleet-safe with a non-null default and an in-file
  migration-safety attestation; do not mutate committed migrations.
- [ ] Add an invariant test that keeps the database and TypeScript vocabularies
  aligned and rejects unknown clearance values.
- [ ] Run the targeted database tests and Prisma validation.

## Phase 2: Normalize the effective context

**Files**

- Modify: `apps/web/lib/identity/effective-auth-context.ts`
- Modify: `apps/web/lib/identity/effective-auth-context.test.ts`

**TDD and implementation**

- [ ] First write fixtures for workforce administrator, manager, employee,
  customer, partner, service principal, and AI coworker acting with a human.
- [ ] Add explicit population, canonical aliases, sensitivity clearance, team
  identifiers, direct/indirect report identifiers, account scope,
  authentication evidence, acting-human/agent identity, and active delegation
  identifiers to the context contract.
- [ ] Normalize every list by removing empty values, deduplicating, and sorting
  deterministically.
- [ ] Default missing clearance to public-only, missing assurance to
  unasserted, and every unsupported scope to empty.
- [ ] Reject unknown closed-enum values at the boundary rather than widening
  authority.
- [ ] Preserve the existing principal, role, capability, employee, and
  superuser fields so current consumers migrate without an authorization gap.

## Phase 3: Add one authoritative loader

**Files**

- Create: `apps/web/lib/identity/load-effective-auth-context.ts`
- Create: `apps/web/lib/identity/load-effective-auth-context.test.ts`
- Modify: `apps/web/lib/identity/principal-linking.ts` only if a reusable
  principal-plus-alias lookup is required

**TDD and implementation**

- [ ] Load the canonical principal, aliases, and clearance once.
- [ ] Load active team memberships and employee hierarchy. Compute the
  transitive indirect-report closure with cycle protection and deterministic
  output; a malformed hierarchy must not grant extra scope.
- [ ] Carry customer account/contact scope only from the authenticated customer
  session or a verified canonical alias. Do not infer partner scope from
  similarly named rows.
- [ ] Select delegation grants only when active, within validity bounds,
  unexhausted, and applicable to the acting human/agent relationship.
- [ ] Carry explicit `amr` and asserted `acr` when the authentication surface
  provides them. Record source-only method evidence such as `session` or
  `bearer` separately from assurance.
- [ ] Return public-only/empty scopes when the principal or optional population
  relation is absent.

## Phase 4: Bind request and authorization consumers

**Files**

- Modify: `apps/web/lib/api/auth-middleware.ts`
- Modify: `apps/web/lib/api/auth-middleware.test.ts`
- Modify: `apps/web/lib/api/jwt.ts` and its tests only if optional `amr`/`acr`
  claims need preserving
- Modify: `apps/web/lib/govern/manager-scope.ts`
- Modify: `apps/web/lib/govern/manager-scope.test.ts`

**TDD and implementation**

- [ ] Route bearer and session authentication through the same loader.
- [ ] Preserve optional, issuer-asserted JWT `amr`/`acr` claims without
  converting them into a stronger locally invented assurance level.
- [ ] Allow manager access to direct and indirect reports while keeping peer,
  sibling-team, unrelated-account, and shared-surface access denied.
- [ ] Verify inactive users, invalid principals, malformed hierarchy cycles,
  expired delegations, and unknown clearance values fail closed.
- [ ] Verify existing capability and employee/customer route guards retain
  their current behavior.

## Phase 5: Documentation and verification

- [ ] Update the enterprise auth design where its old narrow context shape is
  now stale; point to the canonical implementation rather than copying rules.
- [ ] Update the sensitive-routing plan to mark the richer auth substrate as
  available while leaving response rehydration and `BI-62BFAA95` honestly open.
- [ ] Run affected Vitest suites and package typechecks.
- [ ] Apply the migration in the governed local-integration sandbox.
- [ ] Run the exact-head merged-code gate, including production build.
- [ ] Record test, build, migration, spec-review, and no-UX-needed evidence
  against `BI-749EB750` and `WC-1872F636`.
- [ ] Open a ready, non-draft PR only after the exact-head gate passes; run
  `pnpm pr:health`, enter the merge queue, and verify the merge-group checks.

## Risks and rollback

- **Privilege widening from absent data:** all optional authorization scopes are
  empty and clearance is public-only unless canonical evidence says otherwise.
- **Hierarchy cycles:** traversal uses a visited set, excludes self, and never
  grants a node reached only through malformed repeated edges.
- **Stale delegation:** validity, status, target, and use limits are evaluated
  at load time; cached context is request-scoped.
- **Assurance overstatement:** source method and asserted assurance remain
  separate fields.
- **Migration rollback:** the change is additive. Application rollback leaves
  the defaulted column unused; a later forward migration may remove it only
  after all consumers are removed.
- **Runtime regression:** retain the old context fields during the atomic
  transition and compare existing authorization fixtures before enabling
  response rehydration.

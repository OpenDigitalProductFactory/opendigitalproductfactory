# Work Case Wave 2: Accountability, Staging, and Stop Conditions

Status: in progress
Backlog: BI-WC-WAVE2
Epic: EP-2984B02B
Work Capsule: WC-C3544F60

## Objective

Implement the Work Case accountability invariants that unlock operator surfaces: acting agent principals carry a sponsor/authority-mode contract, consequential transitions can be staged before commit, and stop conditions deterministically block unsafe progress before any UI or federation work depends on the model.

## Scope

- Persist the sponsor and authority-mode fields on the acting-principal substrate (`Principal`) because the design spec identifies them as accountability invariants, not derivable projection data.
- Add a typed Work Case authority-mode vocabulary shared by the Work Case policy envelope and TAK playbook bindings: `autonomous`, `on-behalf-of`, `authenticated-inbound`.
- Add pure accountability validation for agent actors. Autonomous and on-behalf-of agent actions require a sponsor; on-behalf-of also requires a delegating principal; authenticated-inbound must carry a verified inbound principal.
- Add pure staged-transition projection for proposed, awaiting-approval, edited, approved, rejected, responded, and cancelled transition states.
- Add pure stop-condition evaluation for max iterations, budget ceiling, timebox, required approval, terminal sealing, receipt completeness, and policy completeness.
- Thread accountability validation into the existing Work Case policy evaluator without requiring old callers to construct a Work Case context when no actor is known.
- Update EA/SysML grounding so REQ-WC-3 and the Wave 2 verification cases are allocated to code.

## Out Of Scope

- Operator Workspace UI and Case Detail screens.
- AgentCard routing and external A2A federation.
- Domain workflow adoption.
- Replacing `DecisionInteraction`, `WorkItem`, `WorkCapsule`, `AuthorityBinding`, or existing receipt records.

## Implementation Tasks

1. Add failing tests for the Wave 2 invariants:
   - `accountability.test.ts`: authority-mode vocabulary, sponsor requirement, on-behalf-of delegator, authenticated-inbound verifier.
   - `staged-transition.test.ts`: proposal states project deterministically and explainably.
   - `stop-conditions.test.ts`: stop conditions trip with stable reasons and convert to policy guard inputs.
   - `policy-envelope.test.ts`: consequential agent actions are denied when accountability context is invalid.
   - `architecture-grounding.test.ts`: Wave 2 files and VC-WC-3 are grounded.
2. Implement Work Case accountability types/helpers in `apps/web/lib/work-management/accountability.ts`.
3. Implement staged transition projection in `apps/web/lib/work-management/staged-transition.ts`.
4. Implement stop-condition evaluation in `apps/web/lib/work-management/stop-conditions.ts`.
5. Extend `policy-envelope.ts`, `case-types.ts`, and exports to use the shared authority-mode/accountability contract.
6. Add a Prisma migration for `Principal.sponsorPrincipalId` and `Principal.authorityMode`, with self-relation/indexes and nullable fields for backwards compatibility.
7. Update the Work Case spec and architecture manifest to mark Wave 2 accountability/staging/stop-condition foundation as implemented or partially implemented.

## Verification Plan

- `pnpm --filter web exec vitest run apps/web/lib/work-management/accountability.test.ts apps/web/lib/work-management/staged-transition.test.ts apps/web/lib/work-management/stop-conditions.test.ts apps/web/lib/work-management/policy-envelope.test.ts apps/web/lib/work-management/architecture-grounding.test.ts`
- Existing Wave 0/1 focused tests for source registry, status projection, read model, receipt envelope/coverage, telemetry, governance hook, and MCP governed execution receipt behavior.
- `pnpm --filter web typecheck`
- `pnpm --filter web build`
- `pnpm --filter @dpf/db exec prisma migrate dev --name work_case_principal_accountability` or equivalent migration apply evidence against the canonical local-CI/runtime surface if the worktree cannot host Postgres.

## Rollback

This slice is additive. Rollback removes the new Work Case domain modules, policy-accountability checks, spec/architecture updates, and the nullable `Principal` fields before any production data depends on them.

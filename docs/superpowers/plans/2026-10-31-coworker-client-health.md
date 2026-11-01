# Share connected-client facts with the Self-upgrade coworker

Backlog: BI-7CE02DE9. Parent: BI-81AB897A. Workroom: WC-1443F68A.
Delivery: medium reliability repair. Operator direction on October 31: "Finish the full repair" supersedes the intake's earlier planning-only boundary within this bounded item.

## Design grounding
Extend the existing connected-clients read model and authorized-surface registry. No new schema, tool, grant, queue or repair dispatcher.
Reviewed contracts: docs/superpowers/specs/2026-10-28-portal-outcome-convergence-design.md (OBJ-FACTS / AC-FACTS), docs/superpowers/specs/2026-08-05-coworker-page-perception-context-contract-design.md and the existing authorized-surface compiler/runtime/prompt grounding.
Source of truth: apps/web/lib/agent-toolchain/connected-clients.ts, also consumed by the rendered /ops/self-upgrade page. Current code omits these facts from self-upgrade-route-context.ts; only the discovery surface is registered for trusted prompt grounding.
Reuse the existing surface contract, rather than treating arbitrary PAGE DATA as a tool success or changing the evidence guard.

## Acceptance
- AC-CLIENT-CONTEXT: The self-upgrade coworker receives the same authorized connected-client projection as the page, including current/stale/unknown status, release identity and reason, without credential identifiers or secrets.
- AC-CLIENT-UNAVAILABLE: A read failure is explicitly unavailable; the response does not fabricate current client state or silently substitute upgrade/job-engine facts.
- AC-CLIENT-BOUNDARY: The existing view authority and bounded read contract apply; no added administration grant, implicit client update or repair dispatch.
- AC-CLIENT-LIVE: On the served repair, the client-help question obtains the visible facts or explicit unavailable result and its existing authorized next route.

## Ordered atomic implementation
1. Add first-failing regression tests for the exact self-upgrade route, shared safe client projection, current versus unknown counts, stale reasons, bounded/truncated results, unavailable release/read and revoked view permission. Test authorized-surface grounding of this section without granting writes. Tests are internal sequencing, not separate deliveries.
2. Add an explicit allowlisted projection beside the shared loader, omitting credentialRef and unneeded host metadata. Check current active user view_operations before loading for model use. Isolate client read failure so existing upgrade/job facts remain available while client state is explicitly unavailable. Pass the current user through the route-context provider.
3. Register a read-only Self-upgrade connected-client section in the existing authorized-surface registry. Recheck current permission at every open/snapshot through authorizeSurface, use the same safe projection, and provide an existing page navigation next route. Do not add update actions or change grounding policy.
4. Run source tests and web typecheck, preflight and canonical integration gate. Verify rendered nonprod question against seeded current/stale/unknown/unavailable states. Obtain independent review, protected PR/queue publication, then canonical upgrade and signed-in live question. AC-CLIENT-LIVE remains unrun until exact served bytes are verified.

## Verification and impact contract
Graph lookup found connected-clients.test.ts, converge-status.test.ts, ConnectedAgentClients.test.tsx, self-upgrade/page.test.tsx, route-context.test.ts and authorized-surface-registry.test.ts. No graph links for new files or self-upgrade-route-context.ts: expand with direct import search and new focused tests. Also run authorized-surface runtime/compiler/prompt-grounding and autonomous-grounding-seam tests.
Run node scripts/check-style-drift.mjs (guard obligation), pnpm gate:context, pnpm pregate:preflight, governed pnpm pregate and pnpm pr:health. Generate docs index with node scripts/gen-doc-index.mjs. No migrations or runtime data edits.

Traceability: requirement OBJ-FACTS; contract authorized-surface-v1; flow /ops/self-upgrade -> connected-client question -> authorized read -> answer or explicit unavailable; verification client-health-regression-and-served-question.

## Risk and rollback
Risk: adding a surface could make unrelated upgrade questions appear grounded in client-only evidence. Label the section and limits explicitly; never claim background engine or upgrade health from client status. Permission revocation must close sessions before further reads. Shared read limits and truncation must survive projection. Roll back this one source change through a protected PR; no persistent state is changed.

## Backlog coverage
One atomic deliverable maps to BI-7CE02DE9. Projection, permission, route context and trusted surface form one user-visible read contract and cannot independently satisfy it. No dependencies on the separate provider-status/foreground-recovery/grounding-failure implementations. Receipt will be recorded against the immutable committed plan before source implementation.


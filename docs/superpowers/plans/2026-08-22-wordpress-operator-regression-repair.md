---
title: WordPress operator regression repair implementation plan
status: active
date: 2026-08-22
backlog_item: BI-A45D744A
design: docs/superpowers/specs/2026-08-22-wordpress-operator-regression-repair-design.md
---

# WordPress operator regression repair implementation plan

## Scope and delivery shape

This is one atomic small repair. The four symptoms cross the connector store, WordPress probe, adapter boundary, and page copy, but none is independently useful to operators: shipping only one would leave the WordPress surface internally contradictory. No child BacklogItems are warranted.

## Phase 1: Pin regressions red

1. Add connector-store tests proving persisted failed health derives `degraded`, successful health clears it, safe capability patches merge atomically, publication policy survives, and unsafe projection input is rejected.
2. Add WordPress connection-operation tests proving successful recheck refreshes discovery projection and failed recheck does not mutate it.
3. Add registry/adapter tests proving `wordpress` and `wordpress-self-hosted` both publish through one adapter while unknown ids remain unsupported.
4. Add page/component assertions for the degraded state and the three operator command labels.
5. Run only the focused tests and retain the expected failures as Red evidence.

## Phase 2: Repair kernel and WordPress probe

1. Centralize persisted latest-probe-failure derivation in the connector credential store.
2. Extend successful health-probe recording with an optional redacted safe-projection patch.
3. Validate, merge, encrypt, and persist the patch inside the existing health transaction.
4. Map successful WordPress discovery into that patch; leave failure behavior unchanged.
5. Run focused connector and WordPress tests to Green, then refactor duplicated projection assembly without changing behavior.

## Phase 3: Repair routing and operator language

1. Add the legacy WordPress alias to the adapter registry.
2. Make adapter validation accept the same closed alias set while retaining approval/content validation.
3. Change the initial connection submit label to `Connect WordPress` and preserve the existing health and replacement labels.
4. Run focused adapter, registry, action, and component tests to Green.

## Phase 4: Verify blast radius and UX fit

1. Run the connector-kernel, WordPress channel, marketing adapter registry, and marketing publication test suites identified by the change-impact contract and caller search.
2. Run repository typecheck and production compile.
3. Verify the WordPress route in a governed shared nonproduction lease at desktop and narrow viewport: degraded status, recovery action, initial connection label, and no first-viewport overflow.
4. Run pregate preflight, obtain independent semantic review for the stable commit, then run exact-tree local integration CI.
5. Publish a DCO-signed ready PR linked to BI-A45D744A and read both check results and review findings before merge.

## Traceability

| Deliverable | Objectives | Acceptance | Owning BacklogItem |
| --- | --- | --- | --- |
| Truthful health projection | OBJ-WPOR-001 | AC-WPOR-001, AC-WPOR-005 | BI-A45D744A |
| Atomic capability refresh | OBJ-WPOR-002 | AC-WPOR-002, AC-WPOR-005 | BI-A45D744A |
| Canonical/legacy draft routing | OBJ-WPOR-003 | AC-WPOR-003, AC-WPOR-005 | BI-A45D744A |
| Accurate operator commands | OBJ-WPOR-004 | AC-WPOR-004, AC-WPOR-005 | BI-A45D744A |

## Stop conditions

- Stop before implementation if the canonical design, objective baseline, plan review, or plan-coverage receipt is unavailable.
- Stop before publication if any claimed path overlaps another active Workroom.
- Stop before merge if exact-tree local CI, UX fit, DCO, or PR health is not green.

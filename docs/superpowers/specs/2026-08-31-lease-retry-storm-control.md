---
status: draft
---

# Bounded nonproduction lease retry contract

**Backlog:** BI-MCP-EFF-CD5F744B  
**Epic:** EP-56AE0F69  
**Scope:** platform operations guidance and the existing nonproduction lease MCP contract

## Problem

The efficiency scan recorded 102 `claim_nonprod_environment_lease` fail→retry pairs in 120-second windows. A lease failure is often a terminal input or evidence problem, but callers receive too little guidance and repeatedly submit the same claim. This consumes provider, database, and operator capacity without changing state.

The platform already has a durable FIFO lease, claim-key idempotency, and event/reconciliation substrate. This change makes that substrate the explicit caller contract; it does not add a second queue or ledger.

## Objectives

- **OBJ-LEASE-01:** Every lease response clearly classifies the outcome as admitted, queued/waiting, reusable evidence, or terminal/non-retryable.
- **OBJ-LEASE-02:** A non-retryable failure tells the caller what must change and prevents blind same-argument retries.
- **OBJ-LEASE-03:** A queued caller waits on one durable claim identity and an event/reconciliation wakeup instead of a tight polling loop.
- **OBJ-LEASE-04:** Duplicate claims with the same immutable claim key remain idempotent and do not create additional leases.
- **OBJ-LEASE-05:** Retry-storm telemetry exposes suppressed duplicates and the terminal reason for later process improvement.

## Acceptance criteria

- **AC-LEASE-01:** Missing/invalid evidence, owner mismatch, terminal lease state, and invalid contract inputs return `retryable: false`, a typed reason, and a concrete remediation; repeating unchanged arguments is explicitly prohibited.
- **AC-LEASE-02:** A `queued` response returns the durable lease/claim identity, queue position, and a wait/reconciliation instruction. The caller does not issue periodic claim calls while waiting.
- **AC-LEASE-03:** A repeated request with the same claim key returns the existing lease or terminal evidence and never creates a sibling lease.
- **AC-LEASE-04:** The shared-environment skill teaches event-first waiting, one bounded reconciliation fallback, and stop-on-terminal-error behavior in plain language.
- **AC-LEASE-05:** Tests cover the 102-retry fixture, unchanged retry suppression, queued wait behavior, idempotent reuse, owner mismatch, and terminal evidence errors.
- **AC-LEASE-06:** Existing synchronous verification flows and the lease admission safety/pressure checks remain unchanged.

## Scope and non-goals

Reuse `NonProductionEnvironmentLease`, its claim key, FIFO admission, `QueueTelemetryEvent`, Inngest/event delivery, and existing MCP response shape. The likely edits are the existing lease MCP contract/messages, its tests, and the shared-environment skill. Do not create a parallel task bus, lease table, or client-side retry daemon. Do not weaken pressure admission or turn a queued response into runtime ownership.

## Failure and recovery posture

Invalid inputs and terminal evidence failures stop immediately. Capacity waits become dormant durable state and resume only on an authoritative event or one bounded reconciliation read. A lost event is observable and repaired by reconciliation; it is not repaired by a rapid retry loop. All transitions remain auditable by lease/claim identity.

## Research and standards

The design follows the MCP transport guidance to respect server-provided retry signals and the project’s existing durable-wait model. DPF adopts event-first waiting and immutable claim keys; it rejects unbounded caller polling because it produces the measured retry storm and duplicates work.

## Rollback

The response metadata and skill wording are backward-compatible. If the new response contract causes a client regression, revert the message/skill change while preserving the existing database lease and admission code. No data migration is required.


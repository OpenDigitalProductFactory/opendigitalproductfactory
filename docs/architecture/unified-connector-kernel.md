# Unified Connector Kernel

The unified connector kernel is the shared lifecycle boundary for external integrations. It centralizes the invariants that must be identical across providers while keeping vendor protocol knowledge in small adapters. Microsoft 365 Communications and Postmark are the first proof providers: one uses OAuth 2.0 client credentials with no callback, while the other uses an API key and a signed inbound webhook.

## Ownership boundary

The kernel under `apps/web/lib/integrations/kernel/` owns:

- validated, immutable connector definitions and the closed auth, callback, and error taxonomies;
- encrypted credential persistence and the safe setup/health projection;
- lifecycle transaction boundaries, audit records, retry policy, refresh single-flight, sync checkpoints, and callback idempotency;
- immutable registry DTOs and adapter facades; and
- the rules that prevent production providers from writing `IntegrationCredential` directly.

Adapters under `apps/web/lib/integrations/connectors/` own vendor-specific validation, credential partitioning, authentication and token exchange, probes, payload mapping, signature verification, delivery-key extraction, and typed translation of upstream failures. Existing routes and actions remain compatibility facades: they preserve their public result unions, response bodies, and status codes while delegating shared behavior to the registered adapter and kernel.

`apps/web/lib/integrations/connectors/index.ts` is the composition root. It imports providers and registers them. Kernel modules never import provider modules, and this slice intentionally does not introduce a dynamic plugin loader.

## Connector definition

Every connector parses a schema-version-1 definition. Parsing rejects duplicate or empty identifiers, undeclared operation capabilities, invalid retry bounds, broken sync references, duplicate authority resources, and incompatible auth/callback combinations. Successful definitions and their nested values are deeply frozen.

The closed authentication kinds are:

- `api-key`
- `oauth2-client-credentials`
- `oauth2-authorization-code`
- `none`

The closed callback kinds are `none`, `oauth`, and `webhook`. Authorization-code authentication requires an OAuth callback, and an OAuth callback requires authorization-code authentication.

The closed safe error kinds are `configuration`, `authentication`, `authorization`, `rate_limited`, `upstream_unavailable`, `invalid_payload`, `not_connected`, and `internal`. Only `rate_limited` and `upstream_unavailable` are retryable, and only when the operation supplies an idempotency key.

A definition also declares unique capabilities, operations, bounded retry policies, health cadence, optional full or incremental sync, and data authority (`source`, `platform`, or `shared`). The registry rejects duplicate connector keys and duplicate capabilities, sorts lookup deterministically, and returns deeply immutable projections and facades without freezing an adapter's private runtime state.

## Credentials, state, and health

`credential-store.ts` is the sole production writer for `IntegrationCredential`. Adapters partition input into reconnect fields, secret fields, a token envelope, and a safe projection. Opaque envelopes are encrypted before persistence; production writes fail closed when credential encryption is unavailable. Reads return only adapter-declared safe metadata.

The persisted compatibility states remain `unconfigured`, `connected`, and `error`. `degraded` is derived at read time when a connected credential's latest health probe failed, avoiding a schema-only state fork. A successful replacement atomically swaps fields and tokens and clears prior errors. A failed replacement preserves a previously working credential; a first failed connection can retain only explicitly reusable encrypted reconnect data and never a rejected token or secret. Disconnect removes the credential by integration ID.

Lifecycle transitions use caller-owned transactions. Network calls occur outside the transaction, then credential state or sync checkpoint and the required audit row commit together. Audit failure therefore rolls back connect, disconnect, refresh rotation, and sync checkpoint changes. The lifecycle converts provider and persistence failures into typed, sanitized `ConnectorAttemptFailure` values before they reach stored state, audit input, or compatibility facades; raw upstream or database error text remains only as an internal cause. Refresh-token flows are single-flight per unique integration credential; client-credential connectors re-exchange expired tokens without changing Microsoft into a delegated-user flow. A failed refresh retains the last valid token.

Sync uses a cursor, an idempotency key, and optional cancellation signal. Retry is bounded exponential backoff with injectable jitter, respects a capped `Retry-After`, stops on cancellation, and never retries non-idempotent work.

## Durable audit and callback delivery

The kernel makes one audit write for every logical connect, disconnect, health, refresh, sync, and callback success or failure. When the audit store is available, that attempt maps to `IntegrationToolCallLog` with connector and actor identity, operation, a canonical hash of adapter-redacted input, stable response class, result count, duration, and a typed safe error. It never stores raw arguments, credentials, tokens, signatures, callback payloads, or unsanitized exception messages. Anonymous callbacks use the external-webhook actor.

Required lifecycle audit is fail-closed: if `IntegrationToolCallLog` cannot accept the record, the operation reports an operational failure and any coupled state mutation rolls back. This guarantees that a successful state transition is never committed without its audit row; it cannot guarantee a durable attempt row while the audit store itself is unavailable. A successful health probe whose success-audit write fails also throws the audit-store failure. It is not projected as `degraded`, because audit infrastructure availability is not evidence that the provider is unhealthy. Probe failures remain sanitized, audited health failures and project `degraded` when their audit transaction succeeds.

`IntegrationCallbackReceipt` provides callback idempotency through the unique `(connectorId, deliveryKey)` key. After vendor verification, the receipt claim, domain write, safe callback-audit outbox, dispatch marker, and exact provider acknowledgment commit in one Prisma transaction. A completed replay returns the stored response without repeating the domain write. Reusing a delivery key with a different redacted request hash is rejected.

Audit and responder delivery occur after the domain transaction. Their independent durable markers (`auditPending` and `dispatchPending`) preserve simultaneous failures. The returned acknowledgment remains the committed provider response and `operationalErrors` reports `callback_audit_pending` and/or `callback_dispatch_failed`; infrastructure failure does not rewrite a successful vendor response.

Responder execution is explicitly at least once, not exactly once. Workers acquire an atomic receipt lease and use the inbound ID as their idempotency key. Postmark schedules a bounded low-latency Inngest enqueue and a registered five-minute sweep drains stranded work. Draft and engagement writes commit together, and the partial unique `OutboundDraft_inbound_source_key` index enforces one inbound reply draft across processes. Terminal audit fallback is also secret-free and retryable.

## Enforcement

`scripts/check-no-provider-local-connector-lifecycle.mjs` scans all production TypeScript and TSX under `apps/web` with AST and import analysis. It rejects `IntegrationCredential` create, update, upsert, delete, bulk mutation, and raw-SQL mutation outside the credential store. It separately rejects provider-local connection-state unions and refresh orchestration, while ignoring tests, generated code, comments, and strings.

Existing unrelated debt is recorded by exact file, violation kind, and count in `scripts/provider-local-connector-lifecycle-baseline.json`. New debt, increased counts, and stale baseline entries fail the guard. Microsoft and Postmark paths may never be baselined. `pnpm check:guards` runs this ownership check with the platform guard suite.

## Adding or migrating a connector

1. Define the provider contract with `schemaVersion: 1`, a globally unique key and capabilities, auth/callback kinds, operations and retry bounds, health cadence, sync policy, and data authorities.
2. Implement a thin vendor adapter for input validation, credential partitioning, authentication or token exchange, probes, payload mapping, callback verification, and typed error translation. Do not write credentials or reproduce lifecycle state locally.
3. Use the kernel credential store and lifecycle APIs. Keep vendor network work outside database transactions, then atomically persist state or checkpoints with the required audit.
4. For callbacks, verify the raw request before parsing where the provider requires it, derive a stable delivery key, and use the callback transaction API. Persist no raw payload, signature, or secret. Make every post-commit responder idempotent and recoverable from its durable pending marker.
5. Register the adapter only in `apps/web/lib/integrations/connectors/index.ts`. Preserve existing route/action contracts through compatibility facades during migration.
6. Add contract tests for definition, safe projection, lifecycle transitions, exact compatibility responses, retry/cancellation, duplicate and concurrent delivery, rollback, replay, audit outage, dispatch outage, and recovery sweep.
7. If a schema change is required, add an immutable additive Prisma migration, include data movement in that migration, validate the schema, and prove `prisma migrate deploy` in the governed convergence runtime.
8. Run the focused connector suites, ownership guard and guard tests, `pnpm check:guards`, documentation link check, web typecheck, production build, and the required runtime UX paths. Record canonical evidence before opening a ready PR.

## Why this is not a mega-service

The kernel coordinates invariants; it does not understand Microsoft tenants, Graph probes, Postmark signatures, email payloads, or provider-specific UI semantics. Adapters remain independently testable and routes retain stable compatibility contracts. The composition root is explicit, registry output is immutable, and no generic runtime plugin protocol or universal provider data model was introduced. This keeps one lifecycle spine without turning every integration into branches inside one vendor-aware service.

## Delivery status

The source contract, proof-provider migrations, ownership guard, and this guide are implemented. Canonical Task 11 verification—including migration deploy evidence, the full production build, runtime path verification, independent final reviews, publication, and backlog closure—remains pending and must not be inferred from this document.

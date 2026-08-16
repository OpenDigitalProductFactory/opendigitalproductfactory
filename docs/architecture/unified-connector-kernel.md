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

### Capability identity and discovery

Connector capabilities are schema-validated strings in the immutable definition, not a second database enum. Kernel capability identifiers use lowercase dot-separated namespaces such as `communications.email.send`; an operation references one of the same definition's declared capabilities, and parsing rejects empty, duplicate, or undeclared references. The composition-root registry rejects a capability claimed by two connectors and `getByCapability` is the discovery boundary. Callers discover support through the registry projection rather than probing optional methods or maintaining a parallel switch statement.

Some domain adapters intentionally expose a narrower closed vocabulary. Marketing channels, for example, use the compiler-checked `ChannelCapability` union (`publish-post`, `send-email`, `fetch-engagement`, and peers) in `apps/web/lib/marketing/channels/contracts.ts`. That domain vocabulary is not silently interchangeable with kernel capability IDs: an integrating facade maps the two explicitly when a channel becomes a registered connector. This preserves type safety inside the domain and global uniqueness at the connector boundary.

## Credentials, state, and health

`credential-store.ts` is the sole production writer for `IntegrationCredential`. Adapters partition input into reconnect fields, secret fields, a token envelope, and a safe projection. Opaque envelopes are encrypted before persistence; production writes fail closed when credential encryption is unavailable. Reads return only adapter-declared safe metadata.

The persisted compatibility states remain `unconfigured`, `connected`, and `error`. `degraded` is derived at read time when a connected credential's latest health probe failed, avoiding a schema-only state fork. A successful replacement atomically swaps fields and tokens and clears prior errors. A failed replacement preserves a previously working credential; a first failed connection can retain only explicitly reusable encrypted reconnect data and never a rejected token or secret. Disconnect removes the credential by integration ID.

Lifecycle transitions use caller-owned transactions. Network calls occur outside the transaction, then credential state or sync checkpoint and the required audit row commit together. Audit failure therefore rolls back connect, disconnect, refresh rotation, and sync checkpoint changes. Every outward lifecycle failure is a `ConnectorAttemptFailedError` carrying a typed, sanitized `ConnectorAttemptFailure`; provider, database, and audit-store exceptions remain internal causes and their raw text never becomes the public message, stored state, or audit error. Refresh-token flows are single-flight per unique integration credential; client-credential connectors re-exchange expired tokens without changing Microsoft into a delegated-user flow. A failed refresh retains the last valid token.

Sync uses a cursor, an idempotency key, and optional cancellation signal. Retry is bounded exponential backoff with injectable jitter, respects a capped `Retry-After`, stops on cancellation, and never retries non-idempotent work.

### Safe failures across layers

There is no universal exception class spanning adapter, route, server action, and UI. Each layer preserves its established public contract while carrying the same safe facts: stable code/kind, human-safe message, retryability, and non-secret context. An adapter translates vendor failures to `ConnectorAttemptFailure` and keeps the raw exception only as an internal cause. Kernel orchestration throws `ConnectorAttemptFailedError` where transaction rollback is required. Compatibility routes and actions translate at their boundary rather than leaking either class.

Net-new JSON HTTP APIs should project safe failures as `application/problem+json` using [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html), including a stable DPF problem type and request correlation identifier; an existing endpoint keeps its response union and status codes until a versioned migration. Server actions use the shared `ActionResult<T>` union. UI consumers map retryable failures to explicit recovery and never infer an empty result from an exception. Logs and audit rows may correlate the internal cause, but public payloads, persisted health state, and operator copy never contain secrets or raw vendor text.

### Third-party reads, caches, and historical gaps

Choose execution shape from the work, not from provider convenience:

- A page-request read is only for a bounded, small, operator-requested lookup that can finish inside that surface's declared latency budget. It has a deadline and cancellation signal and may return a truthful stale projection rather than block the whole page.
- On-demand refresh starts durable work when the result outlives navigation, crosses several pages/cursors, or fans out to multiple providers. The page observes the durable operation.
- Periodic or event-driven sync owns continuing ingestion. It uses cursor/checkpoint state, idempotency keys, bounded pages and concurrency, and a provider-aware cadence; it never scans an unbounded history on every run.

A cache is a derived projection, never another authority. Its record includes provider/source identity, observation time, freshness policy, and checkpoint or cursor where applicable. TTL controls reuse, not deletion of authoritative facts. Retry remains bounded and idempotent, honors `Retry-After`, and stops at the caller's deadline; bulk sync isolates failures by source/page so one provider cannot erase successful results from another.

Before enabling an engagement or other time-series source, declare one historical-coverage mode: provider backfill to a supported cursor/date, bounded-window backfill, or immediate-only collection. Backfill upserts on the provider's stable observation identity, advances its checkpoint only with the same durable write, and records the covered interval and gaps. Unsupported or rate-limited history remains an explicit gap; it is never filled with zeroes or silently extrapolated. Aggregates retain source freshness/coverage and the UI follows the multi-source partial-data contract in `docs/platform-usability-standards.md`.

Connector-backed records follow the platform's normal-form relationship rule. Prefer an explicit Prisma `@relation` whenever the target model and cardinality are known. A polymorphic `sourceType` + `sourceId` pair is not an implicit relation; use it only at a deliberate cross-domain boundary where several source models share no canonical parent. Both values stay in typed columns, the source type is a closed enum or generated union, the pair is indexed in access order, and one shared resolver enforces authorization, supported type/id combinations, and target existence. Because a database foreign key cannot protect that shape, lifecycle cleanup and orphan reconciliation are explicit. Neither value belongs in JSON metadata. Repeated source-type branching or cross-target joins are the signal to introduce a canonical parent or explicit join model.

### Marketing channel domain contract

`apps/web/lib/marketing/channels/contracts.ts` is the source contract for outbound marketing adapters; the kernel owns the shared integration lifecycle around it. The actual contract deliberately differs from several older backlog proposals:

- `publish` returns `PublishResult` with provider `externalId`, optional `externalUrl`, and safe channel metadata. An outbound publication does **not** invent an `externalThreadId`.
- Optional `fetchEngagement(publication, credential)` returns an `EngagementSnapshot` (`channelId`, `externalId`, `polledAt`, numeric metrics, and raw provider value for adapter-local normalization), not a parallel `ChannelKpi` model. `pullChannelKpis` owns persistence and aggregation into the canonical reporting projection and retains per-publication failures.
- `externalThreadId` belongs to normalized inbound messages, where the provider adapter derives a stable conversation identity before persistence. Responders consume that typed field; they do not recover it from metadata.
- `trackedUrl` is the typed output of the UTM builder in `apps/web/lib/marketing/utm.ts`, not a required `metadata.trackedUrl` convention. If a provider needs a tracked destination in persisted channel metadata, its accessor schema owns and validates that provider-specific projection.

A stub-to-real transition replaces the adapter behind the same registry identity and capabilities, preserves route/result compatibility, and ships with contract tests plus an explicit deprecation/removal point for the stub. A stub or unsupported capability must be advertised truthfully; it never returns synthetic engagement. Cross-channel performance aggregation has one owner (`pullChannelKpis` and its reporting read model), consumes only normalized snapshots, and propagates source failures and coverage rather than flattening them into zero.

## Durable audit and callback delivery

The kernel makes one audit write for every logical connect, disconnect, health, refresh, sync, and callback success or failure. When the audit store is available, that attempt maps to `IntegrationToolCallLog` with connector and actor identity, operation, a canonical hash of adapter-redacted input, stable response class, result count, duration, and a typed safe error. It never stores raw arguments, credentials, tokens, signatures, callback payloads, or unsanitized exception messages. Anonymous callbacks use the external-webhook actor.

Required lifecycle audit is fail-closed: if `IntegrationToolCallLog` cannot accept the record, the operation reports an operational failure and any coupled state mutation rolls back. This guarantees that a successful state transition is never committed without its audit row; it cannot guarantee a durable attempt row while the audit store itself is unavailable. A successful health probe whose success-audit write fails also throws the audit-store failure. It is not projected as `degraded`, because audit infrastructure availability is not evidence that the provider is unhealthy. Probe failures remain sanitized, audited health failures and project `degraded` when their audit transaction succeeds.

`IntegrationCallbackReceipt` provides callback idempotency through the unique `(connectorId, deliveryKey)` key. After vendor verification, the receipt claim, domain write, safe callback-audit outbox, dispatch marker, and exact provider acknowledgment commit in one Prisma transaction. A completed replay returns the stored response without repeating the domain write. Reusing a delivery key with a different redacted request hash is rejected.

If the callback transaction rolls back for a reason other than the unique receipt race, the kernel writes exactly one separate external-webhook failure audit containing only the redacted request hash and typed safe failure. It then returns a typed retryable failure with the original exception retained only as its internal cause; no receipt, domain write, or acknowledgment survives. If that failure audit cannot be persisted, callback handling fails closed with a typed safe audit failure and still returns no acknowledgment. The unique-receipt race follows the replay/identity-conflict path instead of producing a second failure audit.

For a callback transaction that did commit, audit and responder delivery still occur after the transaction. Their independent durable markers (`auditPending` and `dispatchPending`) preserve simultaneous failures. The returned acknowledgment remains the committed provider response and `operationalErrors` reports `callback_audit_pending` and/or `callback_dispatch_failed`; post-commit infrastructure failure does not rewrite a successful vendor response or repeat its domain write.

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

Federated installation discovery and pairing are adjacent trust protocols, not connector adapters. Their canonical standards baseline lives in the [federated demand network design](../superpowers/specs/2026-07-19-federated-demand-network-design.md#research--benchmarking) and the [zero-shell discovery increment](../superpowers/specs/2026-08-06-federation-zero-shell-autodiscovery-increment.md): [RFC 6762 mDNS](https://www.rfc-editor.org/info/rfc6762/) and [RFC 6763 DNS-SD](https://www.rfc-editor.org/rfc/rfc6763.html) discover candidates but do not establish identity; authenticated key confirmation protects pairing; and version vectors/CRDT decisions represent concurrent revisions without treating wall-clock time as causal order. RFC 8766/9665 extend discovery/registration beyond one link without changing that trust boundary.

## Why this is not a mega-service

The kernel coordinates invariants; it does not understand Microsoft tenants, Graph probes, Postmark signatures, email payloads, or provider-specific UI semantics. Adapters remain independently testable and routes retain stable compatibility contracts. The composition root is explicit, registry output is immutable, and no generic runtime plugin protocol or universal provider data model was introduced. This keeps one lifecycle spine without turning every integration into branches inside one vendor-aware service.

## Delivery status

The source contract, proof-provider migrations, ownership guard, and this guide are implemented. Canonical Task 11 verification—including migration deploy evidence, the full production build, runtime path verification, independent final reviews, publication, and backlog closure—remains pending and must not be inferred from this document.

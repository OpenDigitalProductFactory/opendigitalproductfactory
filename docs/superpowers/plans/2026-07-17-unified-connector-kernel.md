# Unified Connector Kernel Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace proof-provider-local connection lifecycle code with one provider-neutral connector definition, credential/state projection, health, audit, error, retry, sync, and callback contract.

**Architecture:** Add a small kernel under `apps/web/lib/integrations/kernel/` that owns invariant lifecycle behavior while adapters retain vendor validation, authentication, probing, payload mapping, and webhook verification. Continue using `IntegrationCredential` and `IntegrationToolCallLog`, and add one narrow `IntegrationCallbackReceipt` idempotency record so at-least-once webhooks cannot create duplicate domain writes. Migrate Microsoft 365 Communications and Postmark as structurally different proofs, then add an import/AST source guard that makes the kernel credential store the sole production writer.

**Tech Stack:** TypeScript, Next.js 16, Prisma 7, Zod, Vitest, Node source guards.

---

## Chunk 1: Kernel contracts and durable state

### Task 1: Correct the proof-provider contract in the convergence spec

**Files:**
- Modify: `docs/superpowers/specs/2026-07-17-platform-substrate-convergence-design.md`
- Test: `apps/web/lib/integrations/kernel/definition.test.ts`

- [ ] **Step 1: Replace the inaccurate Microsoft authorization-code statement**

Document Microsoft 365 Communications as OAuth 2.0 client credentials, matching `token-client.ts` and its application-permission design. State that the kernel supports refresh-capable OAuth without changing this provider to delegated-user semantics.

- [ ] **Step 2: Add the deterministic proof-provider assertions**

Require Microsoft and Postmark definitions to expose distinct auth and callback kinds while sharing state, health, audit, retry, sync, and error contracts.

- [ ] **Step 3: Run the documentation gate**

Run: `pnpm check:doc-links`

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
git add docs/superpowers/specs/2026-07-17-platform-substrate-convergence-design.md
git commit -s -m "docs(architecture): correct connector proof auth contract"
```

### Task 2: Define the provider-neutral connector manifest

**Files:**
- Create: `apps/web/lib/integrations/kernel/definition.ts`
- Create: `apps/web/lib/integrations/kernel/definition.test.ts`
- Create: `apps/web/lib/integrations/kernel/error.ts`

- [ ] **Step 1: Write failing definition validation tests**

Cover unique nonempty IDs, positive stable schema version, closed auth kinds (`api-key`, `oauth2-client-credentials`, `oauth2-authorization-code`, `none`), callback kinds (`none`, `oauth`, `webhook`), nonempty unique capabilities, retry bounds, sync declaration, and callback/auth compatibility.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter web exec vitest run lib/integrations/kernel/definition.test.ts`

Expected: FAIL because the kernel does not exist.

- [ ] **Step 3: Implement `ConnectorDefinition` and typed errors**

Define narrow metadata and adapter interfaces for credential validation/serialization, authentication, refresh, probe, health, sync, and callback handling. Define error classes: `configuration`, `authentication`, `authorization`, `rate_limited`, `upstream_unavailable`, `invalid_payload`, `not_connected`, and `internal`.

- [ ] **Step 4: Verify GREEN**

Run the focused test.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrations/kernel/definition.ts apps/web/lib/integrations/kernel/definition.test.ts apps/web/lib/integrations/kernel/error.ts
git commit -s -m "feat(integrations): define connector kernel contract"
```

### Task 3: Centralize credential persistence and setup-state projection

**Files:**
- Create: `apps/web/lib/integrations/kernel/credential-store.ts`
- Create: `apps/web/lib/integrations/kernel/credential-store.test.ts`
- Create: `apps/web/lib/integrations/kernel/setup-state.ts`

- [ ] **Step 1: Write failing repository tests**

Inject a Prisma-shaped repository and crypto functions. Assert successful upsert atomically replaces fields/tokens and clears prior errors; a failed replacement leaves the prior connected credential untouched while recording a sanitized failure; a first-ever failed connect stores encrypted reconnect fields only when the adapter explicitly marks them reusable and never stores a rejected token; disconnect deletes by integration ID; reads project only `unconfigured | connected | error | degraded` plus adapter-declared safe metadata.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter web exec vitest run lib/integrations/kernel/credential-store.test.ts`

Expected: FAIL because the repository is absent.

- [ ] **Step 3: Implement the repository**

Make this the only production module allowed to create/update/upsert/delete `IntegrationCredential`. Encrypt opaque adapter-owned field/token envelopes. Require adapters to split `reconnectFields`, `secretFields`, `tokenEnvelope`, and `safeProjection`; only `safeProjection` may be returned. Derive `degraded` at read time for a connected row whose last health probe failed; persist only existing DB statuses to avoid a migration.

- [ ] **Step 4: Verify GREEN**

Run the focused test.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrations/kernel/credential-store.ts apps/web/lib/integrations/kernel/credential-store.test.ts apps/web/lib/integrations/kernel/setup-state.ts
git commit -s -m "refactor(integrations): centralize connector credential state"
```

### Task 4: Implement durable audit and callback idempotency

**Files:**
- Create: `apps/web/lib/integrations/kernel/audit.ts`
- Create: `apps/web/lib/integrations/kernel/audit.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_integration_callback_receipt/migration.sql`

- [ ] **Step 1: Write failing durable-audit tests**

Inject Prisma-shaped audit and callback repositories. For every `connect`, `disconnect`, `health`, `refresh`, `sync`, and `callback` attempt, assert an `IntegrationToolCallLog` write maps connector ID→`integration`, actor→`coworkerId/userId`, operation→`toolName`, canonical redacted input hash→`argsHash`, stable result class→`responseKind`, count/duration/typed-safe-error fields, and never contains raw arguments, tokens, signatures, or payloads. Anonymous callbacks use `coworkerId="external-webhook"` and null `userId`. Audit-write failure is fail-closed for connect/disconnect/sync. Callback availability takes precedence after the idempotent domain transaction: persist a safe pending-audit outbox projection on the receipt in the same transaction as the domain write and acknowledgment, deliver `IntegrationToolCallLog` after commit, and return the committed provider acknowledgment plus an operational pending-audit status if delivery fails. Replay drains pending audit without repeating the domain write.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter web exec vitest run lib/integrations/kernel/audit.test.ts`

Expected: FAIL because durable audit/callback receipt support is absent.

- [ ] **Step 3: Add callback receipt schema and create the migration canonically**

Add `IntegrationCallbackReceipt` with unique `[connectorId, deliveryKey]`, hashed request identity, status, response code, domain entity ID, stored acknowledgment JSON, timestamps, and no raw payload. Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_integration_callback_receipt
```

The generated migration must be additive and contain all SQL; do not modify prior migrations.

- [ ] **Step 4: Implement the audit sink and callback claim/complete API**

Use canonical JSON hashing after adapter-provided redaction. Expose `executeCallbackTransaction`, which supplies one Prisma transaction client to the receipt repository and the adapter's domain-write callback. In that single transaction: create/lock the unique connector+delivery receipt, return a completed stored acknowledgment on replay, perform the idempotent domain write, persist the safe callback-audit outbox projection, and mark the receipt completed with the exact acknowledgment. Any crash/error before commit rolls back all effects, so retry starts cleanly; concurrent duplicate fixtures must yield one domain entity and one completed receipt. After commit, atomically deliver the pending audit to `IntegrationToolCallLog` and clear its receipt marker; an outage preserves the marker, returns the committed acknowledgment with operational status, and replay retries delivery. Do not claim exactly-once external responder execution: persist `dispatchPending` on the receipt, invoke the responder after commit with `inboundId` as its idempotency key, and make replay drain pending dispatch. This is explicit at-least-once dispatch with idempotent responder handling.

- [ ] **Step 5: Verify GREEN**

Run the audit suite, `pnpm --filter @dpf/db exec prisma validate`, then apply the migration to the disposable local-CI Postgres with `pnpm --filter @dpf/db exec prisma migrate deploy` under the governed lease. Capture the migration name and output; a schema-only validation is insufficient.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/integrations/kernel/audit.ts apps/web/lib/integrations/kernel/audit.test.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(integrations): add durable connector receipts"
```

### Task 5: Implement lifecycle, health, refresh, retry, and sync contracts

**Files:**
- Create: `apps/web/lib/integrations/kernel/lifecycle.ts`
- Create: `apps/web/lib/integrations/kernel/lifecycle.test.ts`
- Create: `apps/web/lib/integrations/kernel/retry.ts`
- Create: `apps/web/lib/integrations/kernel/single-flight.ts`

- [ ] **Step 1: Write failing lifecycle transition-table tests**

Cover: missing→`unconfigured`; connected+fresh probe→`connected`; connected+probe failure→derived `degraded`; initial connect failure→`error`; successful recovery clears errors; Microsoft-style expired client-credential token triggers re-exchange; refresh-token auth uses per-connector single-flight, atomically rotates tokens, and retains the last valid token on refresh failure. Credential state mutation plus required audit insert must share one Prisma transaction; injected audit failure rolls back connect, disconnect, and refresh rotation.

- [ ] **Step 2: Write failing retry/sync fixture tests**

Use a synthetic adapter because neither proof provider has a bulk sync operation. Define `SyncRequest { cursor, idempotencyKey, signal }` and `SyncResult { nextCursor, resultCount, checkpoint }`. Retry only `rate_limited` and `upstream_unavailable`; honor Retry-After within the declared cap; use deterministic exponential backoff+jitter injection; stop on cancellation; never retry non-idempotent work without an idempotency key. Persist checkpoint plus audit in one Prisma transaction; audit failure rolls both back. External retry uses the same idempotency key, so an upstream that already committed returns the same result rather than repeating effects.

- [ ] **Step 3: Verify RED**

Run: `pnpm --filter web exec vitest run lib/integrations/kernel/lifecycle.test.ts`

- [ ] **Step 4: Implement orchestration**

Execute vendor network work outside database transactions, then atomically persist state/checkpoint and the required audit row inside one short Prisma transaction. Expose stable health/result unions and keep every vendor call behind adapters. Never return plain failure for a committed transition.

- [ ] **Step 5: Verify GREEN with fake clocks and cancellation**

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/integrations/kernel/lifecycle.ts apps/web/lib/integrations/kernel/lifecycle.test.ts apps/web/lib/integrations/kernel/retry.ts apps/web/lib/integrations/kernel/single-flight.ts
git commit -s -m "feat(integrations): add shared connector lifecycle"
```

## Chunk 2: Proof-provider migrations

### Task 6: Register and migrate Microsoft 365 Communications

**Files:**
- Create: `apps/web/lib/integrations/connectors/microsoft365-communications.ts`
- Create: `apps/web/lib/integrations/connectors/microsoft365-communications.test.ts`
- Modify: `apps/web/lib/integrate/microsoft365-communications/connect-action.ts`
- Modify: `apps/web/lib/integrate/microsoft365-communications/connect-action.test.ts`
- Modify: `apps/web/lib/integrate/microsoft365-communications/preview.ts`

- [ ] **Step 1: Write failing adapter contract tests**

Assert the definition declares `oauth2-client-credentials`, unique communications capabilities, schema version, no external callback, safe state metadata, token expiry, Graph probe behavior, and typed auth/upstream errors. Lock the existing connect result union and route bodies/status codes for validation, auth, probe, persistence, and success. Lock preview result unions, token-cache expiry/re-exchange, safe metadata updates, and exact `lastTestedAt/lastErrorAt/lastErrorMsg` transitions.

- [ ] **Step 2: Verify RED**

Run the new adapter test plus existing Microsoft token/client/connect/preview tests.

- [ ] **Step 3: Implement the thin adapter**

Reuse existing Zod validation, token exchange, and Graph probe functions. Move provider-specific field/token mapping into the adapter and delegate lifecycle/persistence/audit to the kernel. A failed replacement must not destroy a previously working credential; a first failed connect may retain encrypted tenant/client/mailbox identifiers but not the rejected client secret or token.

- [ ] **Step 4: Remove direct credential writes from the connect action**

Make the action a compatibility facade around the registered connector. Preserve its current HTTP/result contract and UI behavior.

- [ ] **Step 5: Verify Microsoft happy and degraded paths**

Run: `pnpm --filter web exec vitest run lib/integrations/connectors/microsoft365-communications.test.ts lib/integrate/microsoft365-communications app/api/integrations/microsoft365-communications`

Expected: PASS with no direct `integrationCredential.upsert` in the Microsoft directory.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/integrations/connectors/microsoft365-communications.ts apps/web/lib/integrations/connectors/microsoft365-communications.test.ts apps/web/lib/integrate/microsoft365-communications
git commit -s -m "refactor(integrations): migrate Microsoft communications to kernel"
```

### Task 7: Register and migrate Postmark

**Files:**
- Create: `apps/web/lib/integrations/connectors/email-postmark.ts`
- Create: `apps/web/lib/integrations/connectors/email-postmark.test.ts`
- Modify: `apps/web/lib/marketing/channels/email-postmark/config.ts`
- Create: `apps/web/lib/marketing/channels/email-postmark/config.test.ts`
- Modify: `apps/web/app/api/integrations/email-postmark/inbound/route.ts`
- Create: `apps/web/app/api/integrations/email-postmark/inbound/route.test.ts`

- [ ] **Step 1: Write failing Postmark contract tests**

Assert `api-key` auth, inbound webhook callback, unique email send/receive capabilities, schema version, safe setup projection, signature verification-before-JSON-parse, one raw-body read, stable callback errors, and durable audit without secrets. Route regression fixtures must lock every existing body/status: disconnected 503, missing secret 500, invalid signature 401, invalid JSON 400, malformed payload 400, missing organization 500, and success 200.

- [ ] **Step 2: Verify RED**

Run the new connector/config/route tests.

- [ ] **Step 3: Implement the Postmark adapter**

Keep server-token/signing-secret/from-address mapping and signature verification vendor-local. Delegate credential writes, reads, disconnect, callback envelope, health, and audit to the kernel. Invalid replacement input must retain the previous connected credential.

- [ ] **Step 4: Preserve route semantics**

Keep exact 503/500/401/400/200 bodies, earliest-created organization selection, and every `InboundChannelMessage` field mapping. Derive the delivery key from Postmark's external message ID after signature verification; call the kernel transaction API so receipt claim, domain message creation, callback audit, and completed acknowledgment commit or roll back together. A completed replay returns the stored 200/inbound ID without a second message. The responder remains nonblocking and becomes idempotent by `inboundId`; receipt `dispatchPending` supports crash recovery and at-least-once dispatch without claiming impossible exactly-once execution. Terminal verification/parse errors are audited outside a delivery claim; transient persistence failures remain retryable.

- [ ] **Step 5: Verify Postmark happy and degraded paths**

Run: `pnpm --filter web exec vitest run lib/integrations/connectors/email-postmark.test.ts lib/marketing/channels/email-postmark app/api/integrations/email-postmark/inbound/route.test.ts`

Expected: PASS with no direct credential writes in Postmark config, no domain writes on rejected callbacks, one domain write across concurrent/duplicate deliveries, identical replay acknowledgment, transaction rollback on injected crashes, and idempotent at-least-once responder dispatch.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/integrations/connectors/email-postmark.ts apps/web/lib/integrations/connectors/email-postmark.test.ts apps/web/lib/marketing/channels/email-postmark/config.ts apps/web/lib/marketing/channels/email-postmark/config.test.ts apps/web/app/api/integrations/email-postmark/inbound/route.ts apps/web/app/api/integrations/email-postmark/inbound/route.test.ts
git commit -s -m "refactor(integrations): migrate Postmark to connector kernel"
```

### Task 8: Add the canonical registry and projection API

**Files:**
- Create: `apps/web/lib/integrations/kernel/registry.ts`
- Create: `apps/web/lib/integrations/kernel/registry.test.ts`
- Create: `apps/web/lib/integrations/connectors/index.ts`

- [ ] **Step 1: Write failing registry tests**

Assert duplicate IDs and duplicate capabilities fail, lookup is deterministic, definitions carry stable schema versions, nested arrays/objects are deeply immutable, and both proof providers expose the shared state/health/capability projection.

- [ ] **Step 2: Implement composition-root registration**

Registration imports proof adapters; the kernel never imports vendor modules. Avoid a broad dynamic plugin loader in this slice.

- [ ] **Step 3: Verify GREEN**

Run registry and both adapter suites.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/lib/integrations/kernel/registry.ts apps/web/lib/integrations/kernel/registry.test.ts apps/web/lib/integrations/connectors/index.ts
git commit -s -m "feat(integrations): register canonical connector definitions"
```

## Chunk 3: Enforcement, documentation, and delivery

### Task 9: Prevent provider-local lifecycle duplication

**Files:**
- Create: `scripts/check-no-provider-local-connector-lifecycle.mjs`
- Create: `scripts/check-no-provider-local-connector-lifecycle.test.mjs`
- Create: `scripts/provider-local-connector-lifecycle-baseline.json`
- Modify: `scripts/check-guards.mjs`

- [ ] **Step 1: Write failing source-guard tests**

Fixtures must reject any production import/use of Prisma `IntegrationCredential` mutation methods (`create`, `createMany`, `update`, `updateMany`, `upsert`, `delete`, `deleteMany`, raw SQL against the table) outside `kernel/credential-store.ts`. Separately reject provider-local connection-state unions and refresh orchestration outside explicitly named low-level vendor token primitives; comments, strings, and test fixtures must not create false positives.

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/check-no-provider-local-connector-lifecycle.test.mjs`

- [ ] **Step 3: Implement the bounded guard**

Scan all production `.ts/.tsx` under `apps/web` with TypeScript AST/import analysis, skip tests/generated code, cap reads, and emit actionable paths. Record current unrelated debt in a deterministic baseline keyed by file+violation kind; migrated Microsoft/Postmark paths may not remain in the baseline. Adapters may call kernel APIs but are not exempt from credential mutations.

- [ ] **Step 4: Verify discovery and GREEN**

Run the guard test, `node scripts/check-no-provider-local-connector-lifecycle.mjs`, and `pnpm check:guards`.

- [ ] **Step 5: Commit**

```powershell
git add scripts/check-no-provider-local-connector-lifecycle.mjs scripts/check-no-provider-local-connector-lifecycle.test.mjs scripts/provider-local-connector-lifecycle-baseline.json scripts/check-guards.mjs
git commit -s -m "ci(integrations): guard connector lifecycle ownership"
```

### Task 10: Publish the connector-kernel contract

**Files:**
- Create: `docs/architecture/unified-connector-kernel.md`
- Modify: `docs/README.md`
- Modify: `apps/web/lib/docs/doc-index.generated.json`
- Modify: `docs/superpowers/plans/2026-07-17-unified-connector-kernel.md`

- [ ] **Step 1: Document ownership and extension procedure**

Explain kernel versus adapter responsibilities, auth/callback/error taxonomies, state and audit guarantees, migration steps, and why the kernel is not a connector mega-service.

- [ ] **Step 2: Generate and verify documentation artifacts**

Run: `pnpm docs:index` then `pnpm check:doc-links`.

- [ ] **Step 3: Commit**

```powershell
git add docs/architecture/unified-connector-kernel.md docs/README.md apps/web/lib/docs/doc-index.generated.json docs/superpowers/plans/2026-07-17-unified-connector-kernel.md
git commit -s -m "docs(architecture): publish unified connector kernel"
```

### Task 11: Verify, review, publish, and close BI-PSC-002

**Files:**
- Modify: `docs/superpowers/plans/2026-07-17-unified-connector-kernel.md`

- [ ] **Step 1: Run focused source verification**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrations/kernel lib/integrations/connectors lib/integrate/microsoft365-communications lib/marketing/channels/email-postmark app/api/integrations/microsoft365-communications app/api/integrations/email-postmark/inbound/route.test.ts
node --test scripts/check-no-provider-local-connector-lifecycle.test.mjs
node scripts/check-no-provider-local-connector-lifecycle.mjs
pnpm check:guards
pnpm check:doc-links
git diff --check
```

Expected: all PASS.

- [ ] **Step 2: Run web typecheck**

Run: `pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 3: Request independent implementation and spec reviews**

Resolve every Important/Critical finding and rerun focused checks.

- [ ] **Step 4: Run governed canonical gates**

Run `& 'C:\Program Files\Git\bin\bash.exe' scripts/gate-worktree.sh` from this worktree at the exact candidate SHA. Confirm the metadata explicitly contains `pnpm --filter @dpf/db exec prisma migrate deploy` and the `add_integration_callback_receipt` migration applied or was already current, plus full tests, Windows typecheck, and production build. For live-install UX/functional evidence, first run `pnpm verify:preflight -- --feature-sha <candidate-sha> --portal-url http://127.0.0.1:3000` and obey `CAN-TEST | MUST-ADVANCE | BLOCKED`; otherwise use the leased convergence runtime URL. Exercise Microsoft validation/auth/probe/success result contracts and Postmark connect plus disconnected/missing-secret/invalid-signature/invalid-JSON/malformed/no-org/success/concurrent-replay/crash-recovery paths. Record separate `test_pass`, `build_pass`, `ux_verified`, migration, and review evidence activities through DPF MCP before opening the ready PR.

- [ ] **Step 5: Push and open a ready PR**

Open a non-draft PR only after gates and reviews pass. Wait for all GitHub checks and merge queue completion.

- [ ] **Step 6: Record merge evidence and close BI-PSC-002**

Attach PR URL, merge SHA, source/canonical/UX evidence, then mark BI-PSC-002 done. Leave the epic open for BI-PSC-003.

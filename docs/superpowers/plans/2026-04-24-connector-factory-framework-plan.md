# Connector Factory Framework Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first implementation slice of DPF’s connector factory framework: a reusable shared connector substrate, ADP runtime retrofit for test-mode overrides, and a multi-vendor harness skeleton with ADP contract + scenario support.

**Architecture:** Keep vendor runtimes separate in `services/<vendor>/`, add `packages/integration-shared/` for cross-cutting connector primitives, and introduce `services/integration-test-harness/` as a test-only contract/mock utility. The first slice only covers ADP plus the structural seams needed for Prism-backed enforcement next.

**Tech Stack:** TypeScript, Node.js, Vitest, Docker Compose, standalone service containers, OpenAPI artifacts, existing Prisma-backed DB tables (`IntegrationCredential`, `IntegrationToolCallLog`)

---

## Scope Guardrails

- This plan covers **v1 plus the structural seams needed for v2** from the approved spec.
- Do **not** implement QuickBooks in this plan.
- Do **not** implement weekly contract-drift CI in this plan.
- Do **not** collapse `services/adp/` into a shared monolithic connector runtime.
- Do **not** introduce bilateral Pact or record/replay tooling.
- Portal-side ADP token client (`apps/web/lib/integrate/adp/token-client.ts`) stays as-is in v1; only the crypto/redact/audit primitives are extracted. Extending the shared package to cover token exchange is deferred to the next plan.

## File Structure

### Create

- `packages/integration-shared/package.json` — shared package manifest for connector primitives
- `packages/integration-shared/tsconfig.json` — shared package TS config
- `packages/integration-shared/src/index.ts` — public exports
- `packages/integration-shared/src/credential-crypto.ts` — connector-safe credential envelope helpers extracted from existing duplicates
- `packages/integration-shared/src/redact.ts` — suspicious-content and PII redaction helpers shared by portal and services
- `packages/integration-shared/src/tool-call-audit.ts` — common argument hashing + audit payload helpers
- `packages/integration-shared/src/*.test.ts` — focused tests for the shared primitives
- `services/integration-test-harness/package.json` — harness service manifest
- `services/integration-test-harness/tsconfig.json` — harness TS config
- `services/integration-test-harness/Dockerfile` — harness container image
- `services/integration-test-harness/src/harness.ts` — HTTP app entrypoint and request dispatch
- `services/integration-test-harness/src/control-api.ts` — `POST /__control/scenario/{vendor}/{scenario}` implementation
- `services/integration-test-harness/src/vendor-registry.ts` — vendor discovery, route loading, and contract file loading
- `services/integration-test-harness/src/session-state.ts` — per-vendor, per-session scenario state
- `services/integration-test-harness/src/types.ts` — harness-local request/response types
- `services/integration-test-harness/src/*.test.ts` — harness unit tests
- `services/integration-test-harness/vendors/adp/openapi.yaml` — initial committed ADP contract artifact
- `services/integration-test-harness/vendors/adp/routes.ts` — ADP route and scenario mapping
- `services/integration-test-harness/vendors/adp/scenarios/happy-path.json`
- `services/integration-test-harness/vendors/adp/scenarios/rate-limited.json`
- `services/integration-test-harness/vendors/adp/scenarios/auth-failure.json`
- `services/integration-test-harness/vendors/adp/scenarios/token-expired.json`
- `services/integration-test-harness/vendors/adp/scenarios/empty-list.json`
- `services/integration-test-harness/vendors/adp/scenarios/malformed-response.json`
- `services/integration-test-harness/vendors/adp/scenarios/jailbreak-content.json`
- `services/integration-test-harness/README.md` — local usage and session-control documentation
- `services/adp/src/lib/runtime-config.ts` — centralize ADP endpoint/session/test-mode resolution
- `services/adp/src/lib/runtime-config.test.ts` — tests for override behavior
- `services/adp/src/integration/harness-smoke.test.ts` — ADP-to-harness integration smoke coverage

### Modify

- `apps/web/lib/integrate/adp/redact.ts` — adopt shared redaction helpers
- `apps/web/lib/integrate/adp/redact.test.ts` — update expectations to shared implementation
- `services/adp/package.json` — depend on `packages/integration-shared`
- `services/adp/src/lib/crypto.ts` — thin wrapper or replacement with shared package exports
- `services/adp/src/lib/redact.ts` — thin wrapper or replacement with shared package exports
- `services/adp/src/lib/token-client.ts` — support `ADP_TOKEN_ENDPOINT_URL`, test-mode transport relaxation, and harness session propagation
- `services/adp/src/lib/adp-client.ts` — support `ADP_API_BASE_URL` and harness session propagation
- `services/adp/src/tools/*.test.ts` — update mocks/imports where shared helpers or runtime config move
- `services/adp/README.md` — document override env vars and local harness usage
- `docker-compose.yml` — add harness service and test-only compose profile wiring
- `docker-compose.dev.yml` — mirror local test profile wiring if this file carries dev-specific overrides

### Reference

- `docs/superpowers/specs/2026-04-24-connector-factory-framework-design.md`
- `docs/superpowers/specs/2026-04-21-adp-mcp-integration-design.md`
- `docs/superpowers/specs/2026-04-06-browser-use-integration-design.md`
- `docs/superpowers/specs/2026-03-17-agent-test-harness-design.md`
- `services/adp/src/lib/db.ts`
- `packages/db/prisma/schema.prisma`

## Chunk 1: Shared Connector Substrate

### Task 1: Extract reusable connector primitives into `packages/integration-shared`

**Files:**
- Create: `packages/integration-shared/package.json`
- Create: `packages/integration-shared/tsconfig.json`
- Create: `packages/integration-shared/src/index.ts`
- Create: `packages/integration-shared/src/credential-crypto.ts`
- Create: `packages/integration-shared/src/redact.ts`
- Create: `packages/integration-shared/src/tool-call-audit.ts`
- Create: `packages/integration-shared/src/credential-crypto.test.ts`
- Create: `packages/integration-shared/src/redact.test.ts`
- Create: `packages/integration-shared/src/tool-call-audit.test.ts`
- Modify: `services/adp/package.json`
- Modify: `services/adp/src/lib/crypto.ts`
- Modify: `services/adp/src/lib/redact.ts`
- Modify: `apps/web/lib/integrate/adp/redact.ts`
- Modify: `apps/web/lib/integrate/adp/redact.test.ts`

- [ ] **Step 1: Scaffold the workspace shell, then write the failing shared-package tests**

Scaffold first so the test runner can resolve the workspace:
- `packages/integration-shared/package.json` with `"name": "@dpf/integration-shared"` (matches the `@dpf/db` workspace convention) and `vitest` as a devDep
- `packages/integration-shared/tsconfig.json`
- add the package to `pnpm-workspace.yaml` if not already covered by the existing `packages/*` glob
- run `pnpm install` once so the workspace link lands

Then add tests that prove:
- the encryption envelope remains compatible with the existing ADP ciphertext shape
- SSN/bank/DOB redaction stays unchanged
- suspicious-content scrubbing still flags jailbreak phrases
- audit argument hashing remains stable for canonical JSON input

Run:

```bash
pnpm --dir packages/integration-shared exec vitest run src/credential-crypto.test.ts src/redact.test.ts src/tool-call-audit.test.ts
```

Expected: FAIL because the `src/*.ts` implementation files do not exist yet. The failure mode must be "module not found: ./credential-crypto" (missing implementation), NOT "workspace not found" or "vitest not installed" (missing scaffolding).

- [ ] **Step 2: Create the shared package with minimal exports**

Implement the shared package by moving logic, not re-inventing it. Keep the first extraction narrow:
- `credential-crypto.ts` from the existing ADP/app crypto logic
- `redact.ts` from the existing ADP/app redaction logic
- `tool-call-audit.ts` for shared argument hashing / audit payload helpers
- `src/index.ts` re-exports the three modules so consumers import from `@dpf/integration-shared` (not deep paths)
- add `"@dpf/integration-shared": "workspace:*"` to `services/adp/package.json` dependencies, and to `apps/web/package.json` dependencies since the portal-side `redact.ts` also adopts it

- [ ] **Step 3: Repoint ADP and portal-side redaction wrappers**

Keep local vendor-facing file paths stable for now. Replace duplicated internals with thin wrappers or direct imports from `@dpf/integration-shared`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --dir packages/integration-shared exec vitest run src/credential-crypto.test.ts src/redact.test.ts src/tool-call-audit.test.ts
cd apps/web && pnpm exec vitest run lib/integrate/adp/redact.test.ts
cd ../../services/adp && pnpm test
```

Expected: PASS for the new shared package tests and no regression in ADP redaction behavior.

- [ ] **Step 5: Run typecheck gates**

Run:

```bash
pnpm --filter web typecheck
cd services/adp && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/integration-shared services/adp/package.json services/adp/src/lib/crypto.ts services/adp/src/lib/redact.ts apps/web/lib/integrate/adp/redact.ts apps/web/lib/integrate/adp/redact.test.ts
git commit -m "feat(integrations): extract shared connector primitives"
```

### Task 2: Centralize ADP test-mode runtime configuration

**Files:**
- Create: `services/adp/src/lib/runtime-config.ts`
- Create: `services/adp/src/lib/runtime-config.test.ts`
- Modify: `services/adp/src/lib/token-client.ts`
- Modify: `services/adp/src/lib/adp-client.ts`
- Modify: `services/adp/src/tools/get-pay-statements.test.ts`
- Modify: `services/adp/src/tools/get-time-cards.test.ts`
- Modify: `services/adp/src/tools/get-deductions.test.ts`
- Modify: `services/adp/src/tools/list-workers.test.ts`
- Modify: `services/adp/README.md`

- [ ] **Step 1: Write the failing runtime-config tests**

Cover:
- production default endpoint resolution
- `ADP_API_BASE_URL` override
- `ADP_TOKEN_ENDPOINT_URL` override
- test-mode detection when override URLs are `http://`
- propagation of `X-DPF-Harness-Session` when `DPF_INTEGRATION_TEST_SESSION_ID` is set
- **real-mode mTLS stays enforced** when the resolved URL is a production ADP host (invariant: the transport downgrade must not silently apply to real vendor endpoints — the resolver's "relaxed transport" decision must return `false` for every production hostname)

Run:

```bash
cd services/adp && pnpm exec vitest run src/lib/runtime-config.test.ts
```

Expected: FAIL because `runtime-config.ts` does not exist yet.

- [ ] **Step 2: Implement the runtime-config module**

Responsibilities:
- resolve real vs overridden ADP endpoints
- expose a single “should use relaxed test transport” decision
- expose the optional harness session header value

- [ ] **Step 3: Rewire ADP clients to use runtime-config**

Update `token-client.ts` and `adp-client.ts` so:
- endpoint URLs come from runtime config
- harness requests send `X-DPF-Harness-Session` when present
- mTLS is bypassed only when the resolved URL targets the local harness

- [ ] **Step 4: Update service tests**

Extend existing ADP tests so they assert:
- the override URLs are used when present
- the harness session header is present in test mode
- real-mode behavior still uses existing defaults

- [ ] **Step 5: Run focused ADP tests**

Run:

```bash
cd services/adp && pnpm exec vitest run src/lib/runtime-config.test.ts src/tools/list-workers.test.ts src/tools/get-pay-statements.test.ts src/tools/get-time-cards.test.ts src/tools/get-deductions.test.ts
cd services/adp && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/adp/src/lib/runtime-config.ts services/adp/src/lib/runtime-config.test.ts services/adp/src/lib/token-client.ts services/adp/src/lib/adp-client.ts services/adp/src/tools/get-pay-statements.test.ts services/adp/src/tools/get-time-cards.test.ts services/adp/src/tools/get-deductions.test.ts services/adp/src/tools/list-workers.test.ts services/adp/README.md
git commit -m "feat(adp): add test-mode endpoint and session override support"
```

## Chunk 2: Harness Skeleton and ADP Vendor Contract

### Task 3: Stand up the integration test harness service skeleton

**Files:**
- Create: `services/integration-test-harness/package.json`
- Create: `services/integration-test-harness/tsconfig.json`
- Create: `services/integration-test-harness/Dockerfile`
- Create: `services/integration-test-harness/src/harness.ts`
- Create: `services/integration-test-harness/src/control-api.ts`
- Create: `services/integration-test-harness/src/admin-event-log.ts`
- Create: `services/integration-test-harness/src/vendor-registry.ts`
- Create: `services/integration-test-harness/src/session-state.ts`
- Create: `services/integration-test-harness/src/types.ts`
- Create: `services/integration-test-harness/src/control-api.test.ts`
- Create: `services/integration-test-harness/src/admin-event-log.test.ts`
- Create: `services/integration-test-harness/src/vendor-registry.test.ts`
- Create: `services/integration-test-harness/README.md`

- [ ] **Step 1: Scaffold the harness workspace, then write failing harness tests**

Scaffold first:
- `services/integration-test-harness/package.json` with a scoped name (e.g. `@dpf/integration-test-harness`) and `vitest`, `typescript` as devDeps
- `services/integration-test-harness/tsconfig.json`
- ensure the service is included by the `services/*` workspace glob in `pnpm-workspace.yaml`
- run `pnpm install` once so workspace links resolve

Then cover:
- vendor directories are discovered from `vendors/*`
- control API rejects missing `sessionId`
- control API rejects missing or invalid shared secret
- control API rejects requests when the harness is not running in explicit test mode
- scenario state is isolated by vendor + session
- process-global default namespace is disallowed in CI mode
- scenario flips are recorded as harness-admin events outside `IntegrationToolCallLog`
- **conduit invariant**: the harness never reads real `IntegrationCredential` rows. A test must assert that, even when a DB URL is reachable, the harness either uses only seeded test-only credential records (tagged with a test-profile marker) or refuses to touch the credential table at all. This is the `feedback_dpf_as_integration_conduit.md` guardrail — customers bring their own vendor relationships; the harness must not accidentally exercise them.

Run:

```bash
cd services/integration-test-harness && pnpm exec vitest run src/control-api.test.ts src/admin-event-log.test.ts src/vendor-registry.test.ts
```

Expected: FAIL because the harness `src/*.ts` implementation files do not exist yet. Failures must read "module not found" for harness internals, NOT scaffolding errors.

- [ ] **Step 2: Create the minimal harness service**

Implement:
- lightweight HTTP app
- vendor registry loader
- in-memory session-scoped scenario state
- `POST /__control/scenario/{vendor}/{scenario}`
- control-API guard that requires explicit test mode plus a shared secret such as `HARNESS_CONTROL_TOKEN`
- fail-closed behavior when the service is started outside the integration-test profile
- minimal harness-admin event logging to a dedicated structured log sink via `HARNESS_ADMIN_LOG_PATH`, defaulting to `/tmp/harness-admin-events.ndjson`, outside `IntegrationToolCallLog`
- a simple health endpoint

Do **not** integrate Prism in this task. This is the structural skeleton only.

- [ ] **Step 3: Document how the harness is run locally**

Add README guidance for:
- service start
- scenario flips
- session ID usage
- control-token usage
- CI-safe vs single-user local behavior
- where harness-admin logs are written

- [ ] **Step 4: Run harness tests and typecheck**

Run:

```bash
cd services/integration-test-harness && pnpm exec vitest run src/control-api.test.ts src/admin-event-log.test.ts src/vendor-registry.test.ts
cd services/integration-test-harness && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Verify production-safe gating**

Run:

```bash
cd services/integration-test-harness && HARNESS_TEST_MODE=0 pnpm exec vitest run src/control-api.test.ts -t "rejects requests when not in test mode"
```

Expected: PASS, proving the scenario-flip endpoint is unavailable outside explicit test mode.

- [ ] **Step 6: Commit**

```bash
git add services/integration-test-harness
git commit -m "feat(harness): add integration test harness skeleton"
```

### Task 4: Commit the ADP contract artifact and scenario fixtures

**Files:**
- Create: `services/integration-test-harness/vendors/adp/openapi.yaml`
- Create: `services/integration-test-harness/vendors/adp/routes.ts`
- Create: `services/integration-test-harness/vendors/adp/scenarios/happy-path.json`
- Create: `services/integration-test-harness/vendors/adp/scenarios/rate-limited.json`
- Create: `services/integration-test-harness/vendors/adp/scenarios/auth-failure.json`
- Create: `services/integration-test-harness/vendors/adp/scenarios/token-expired.json`
- Create: `services/integration-test-harness/vendors/adp/scenarios/empty-list.json`
- Create: `services/integration-test-harness/vendors/adp/scenarios/malformed-response.json`
- Create: `services/integration-test-harness/vendors/adp/scenarios/jailbreak-content.json`
- Create: `services/integration-test-harness/src/adp-fixtures.test.ts`
- Reference: `apps/web/lib/integrate/adp/fixtures/*.json`

- [ ] **Step 1: Write the failing ADP fixture tests**

Cover:
- `routes.ts` resolves the correct scenario file per endpoint
- all required scenarios exist
- `jailbreak-content` includes suspicious free-text content for redaction testing
- the committed `openapi.yaml` is present and parseable

Run:

```bash
cd services/integration-test-harness && pnpm exec vitest run src/adp-fixtures.test.ts
```

Expected: FAIL because the ADP vendor contract and fixtures do not exist yet.

- [ ] **Step 2: Author the initial ADP OpenAPI contract**

Use the current ADP service tool surface and official ADP docs as the source. The file can be authored manually for v1, but it must exist now and cover:
- token exchange
- workers listing
- pay statements
- time cards
- deductions

- [ ] **Step 3: Add the ADP scenario fixtures**

Use the existing portal-side ADP JSON fixtures as seeds where appropriate, then add explicit failure/adversarial variants for:
- 429 rate limiting
- auth failures
- expired token behavior
- malformed response bodies
- prompt-injection/jailbreak content

- [ ] **Step 4: Implement `vendors/adp/routes.ts`**

Map incoming ADP paths to scenario files and define which response overrides remain fixture-driven in v1.

- [ ] **Step 5: Run fixture tests**

Run:

```bash
cd services/integration-test-harness && pnpm exec vitest run src/adp-fixtures.test.ts src/vendor-registry.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/integration-test-harness/vendors/adp services/integration-test-harness/src/adp-fixtures.test.ts
git commit -m "feat(harness): add ADP contract artifact and scenario fixtures"
```

## Chunk 3: Compose Wiring and End-to-End Local Verification

### Task 5: Wire the harness into compose and prove the ADP path locally

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `services/adp/README.md`
- Modify: `services/integration-test-harness/README.md`
- Create: `services/adp/src/integration/harness-smoke.test.ts`

- [ ] **Step 1: Write the failing ADP-to-harness smoke test**

Cover:
- ADP service respects the override URLs
- session ID propagates from env into `X-DPF-Harness-Session`
- ADP receives a happy-path harness response without live credentials

Run:

```bash
cd services/adp && pnpm exec vitest run src/integration/harness-smoke.test.ts
```

Expected: FAIL because the harness service is not wired and the smoke path does not exist yet.

- [ ] **Step 2: Add compose wiring**

Implement:
- new `integration-test-harness` service
- test-only profile
- env wiring for ADP overrides
- local documentation for how to bring the profile up

- [ ] **Step 3: Add the smoke test path**

Use a lightweight local server or harness test helper so the smoke test proves the end-to-end request path without requiring the whole Docker stack for every unit test run.

- [ ] **Step 4: Run focused service checks**

Run:

```bash
cd services/adp && pnpm exec vitest run src/integration/harness-smoke.test.ts src/lib/runtime-config.test.ts
cd services/integration-test-harness && pnpm exec vitest run
```

Expected: PASS.

- [ ] **Step 5: Run production gates for affected workspaces**

Run:

```bash
pnpm --filter web typecheck
cd services/adp && pnpm typecheck
cd services/integration-test-harness && pnpm exec tsc --noEmit
cd apps/web && npx next build
```

Expected: PASS. No soft-skips: if `apps/web` build fails, fix the root cause — or, if the failure is provably unrelated to this branch, open a concurrent fix PR and block this PR on it before merging. Do not "document and proceed." Deferring build errors or warnings contradicts the platform rule captured in `feedback_fix_all_warnings.md`.

- [ ] **Step 6: Run local docker verification**

Run:

```bash
docker compose --profile integration-test up -d integration-test-harness adp
docker compose --profile integration-test ps
```

Expected:
- both services healthy
- README steps are accurate

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml docker-compose.dev.yml services/adp/README.md services/integration-test-harness/README.md services/adp/src/integration/harness-smoke.test.ts
git commit -m "feat(harness): wire ADP runtime into local integration harness"
```

## Out of Scope for the Next Execution Branch

- Prism runtime enforcement inside the harness
- QuickBooks as the second-vendor proof
- weekly contract-drift CI
- a persistent DB-backed harness-admin event store

These should be queued as the next plan/spec follow-ons once this foundation lands.

## Verification Checklist

- Shared package tests pass
- ADP unit tests pass after extraction
- Harness tests pass
- ADP smoke test passes with harness overrides
- `pnpm --filter web typecheck` passes
- `cd apps/web && npx next build` passes
- `docker compose --profile integration-test up -d integration-test-harness adp` succeeds

## Execution Notes

- Keep commits small and aligned to the tasks above.
- Do not mix QuickBooks or CI drift work into this execution branch.
- Preserve `services/adp/` as the runtime owner of ADP-specific semantics.
- Update backlog item status as tasks land via the `update_backlog_item` MCP tool so `EP-INT-2E7C1A` stays trustworthy. Use the canonical enum values from `apps/web/lib/backlog.ts` — see `CLAUDE.md` § "Strongly-Typed String Enums — MANDATORY COMPLIANCE". Valid `Epic.status`: `"open"` / `"in-progress"` / `"done"`. Valid `BacklogItem.status`: `"open"` / `"in-progress"` / `"done"` / `"deferred"`. Hyphenated, never underscored.
- Concrete sequencing: flip `EP-INT-2E7C1A` to `"in-progress"` when Task 3 (harness skeleton) lands, and to `"done"` only when Task 5 (compose wiring + end-to-end smoke) merges. Flip `BI-INT-59E6B4`, `BI-INT-92C1F8`, `BI-LAB-72E4AB` individually as each task in its scope lands.

Plan complete and saved to `docs/superpowers/plans/2026-04-24-connector-factory-framework-plan.md`. Ready to execute?

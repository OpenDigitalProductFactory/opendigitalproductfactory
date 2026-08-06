# Greenhouse Bridge Adapter — Harvest client + import staging (BI-B65B8C11)

- **BI:** BI-B65B8C11 (Greenhouse bridge adapter — Harvest API client + import staging), epic EP-ECOSYSTEM-ABSORPTION-ARCH.
- **Design:** [docs/superpowers/specs/2026-08-05-greenhouse-ats-absorption-design.md](../specs/2026-08-05-greenhouse-ats-absorption-design.md) §2, §3, §4, §9.
- **Anchor initiative:** BI-E5561DC9. **Phase:** BRIDGE (this plan does not touch native recruiting models or the worker landing — those are BI-F3AEBF68 / BI-02F1F944).

**For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Goal & boundary

Read Greenhouse via the Harvest API and land jobs/openings/candidates/applications/stages/scorecards/offers as **read-only review records** in the existing import-staging pipeline. Nothing here writes a domain row: staged records are `readOnly`, awaiting operator review. The hire→worker landing (Seam B), the inbound webhook + crosswalk (Seam A), and the connect UI/credential are separate BIs.

## Substrate grounded (first-hand, this worktree)

- **Native-connector paved road:** `apps/web/lib/integrate/adp/` — `connect-action.ts`, `token-client.ts`, `cert-parse.ts`, `redact.ts` (re-exports `@dpf/integration-shared`), `fixtures/`, `*.test.ts`. Connect route: `apps/web/app/api/integrations/adp/connect/route.ts`.
- **Import-staging store already exists** — reuse, do not rebuild:
  - `apps/web/lib/integrate/import-staging.ts` — `IntegrationImportStagingRecord` (the shape a connector produces: `entityFamily`, `externalId`, `sourceProvider`, `sourceTimestamp`, `ownerSide`, `proposedLocalLink {entityType, localId, status, confidence, reason}`, `displayFields`).
  - `apps/web/lib/integrate/import-review.ts` — `buildIntegrationImportReviewBatch({batchId, sourceProvider, providerEnvironment, sourceTimestamp, stagedRecords})` sets `reviewStatus:"candidate"`, fingerprints (`fingerprintImportStagingRecord`), and **scrubs sensitive display fields** (token/secret/password/credential).
  - `apps/web/lib/integrate/import-review-store.ts` — `saveIntegrationImportReviewBatch(db, batch)` upserts `IntegrationImportBatch` + child `IntegrationImportStagedRecord` (schema.prisma:2748/2765).
- **Shared token/credential helpers:** `packages/integration-shared/src/client-credentials.ts`; redaction `packages/integration-shared/src/redact.ts`; credential crypto `@/lib/govern/credential-crypto` (`encryptJson`/decrypt); connection state `IntegrationCredential` (schema.prisma:2646, unique on `integrationId`).
- **Prior kernel plan (consult-specs-first):** `docs/superpowers/plans/2026-07-17-unified-connector-kernel.md`.

## Dependencies & build order

- **Depends on BI-AEE6136A** (catalog entry + connect panel/route) for the live `IntegrationCredential` (`integrationId="greenhouse"`, Harvest token in `fieldsEnc`). Build BI-AEE6136A first (it is `small`). This plan adds only a thin `readGreenhouseCredential(db)` decrypt helper; the write/UI is BI-AEE6136A.
- No dependency on the native recruiting models (BRIDGE stages into the generic review store, not native `Candidate`/`Application`).

## Phases

### Phase 1 — Harvest client (`apps/web/lib/integrate/greenhouse/harvest-client.ts`)
- HTTP Basic auth `Authorization: Basic base64(token:)`; base `https://harvest.greenhouse.io/v1/`.
- `Link`-header pagination (`rel="next"`); `per_page` up to 500.
- Rate-limit handling: on `429` honor `Retry-After`; respect `X-RateLimit-Remaining`. Bounded ret/backoff.
- Injectable `dispatcher`/`fetch` (mirror ADP `token-client.ts` test seam) so tests use a mock and production omits it.
- Typed readers: `listJobs`, `listOpenings` (from jobs), `listCandidates`, `listApplications`, `listJobStages`, `listScorecards`, `listOffers`. Redact response bodies via `@dpf/integration-shared` `redact` before any log/LLM path.
- **Attachments: metadata only in the bridge** (S3 URLs expire ~7 days) — binary download is deferred to the REPLACE extraction BI (BI-27456471). Note the constraint in code.
- **Version guard:** target the documented Harvest version; add a TODO gate for the v3 migration (design §8) — do not hardcode a version that the Aug-2026 deprecation removes without a doc check.
- **Verify:** `harvest-client.test.ts` with a mock dispatcher — pagination across two pages, `429`+`Retry-After` retry, Basic-auth header shape, redaction applied.

### Phase 2 — Harvest → staging mapping (`apps/web/lib/integrate/greenhouse/harvest-to-staging.ts`, pure)
- One pure mapper per family → `IntegrationImportStagingRecord`, `sourceProvider:"greenhouse"`, `ownerSide:"source"`, `proposedLocalLink.status:"candidate"`, `confidence:"low"`:
  - Job → `entityFamily:"recruiting-job"`, `proposedLocalEntityType:"JobRequisition"`
  - Opening → `"recruiting-opening"` / `"RequisitionOpening"`
  - Candidate → `"recruiting-candidate"` / `"Candidate"`
  - Application → `"recruiting-application"` / `"Application"`
  - Job Stage → `"recruiting-stage"` / `"PipelineStage"`
  - Scorecard → `"recruiting-scorecard"` / `"Scorecard"`
  - Offer → `"recruiting-offer"` / `"Offer"`
- `externalId` = Greenhouse object id. `displayFields` = human-readable summary (name, title, stage, status) — the store's `sanitizeDisplayFields` drops anything token/secret-shaped; still, never place SSN/comp raw values in display fields.
- Mapping mirrors design §3.1 (object mapping) and §3.2 (application status). Pure, no DB, no network — the same discipline as `mapRosterToEmployees`.
- **Verify:** `harvest-to-staging.test.ts` — fixture Harvest job/candidate/application/offer/scorecard → expected staging records; assert entityFamily/proposedLocalEntityType and no sensitive display fields.

### Phase 3 — Import orchestrator (`apps/web/lib/integrate/greenhouse/import-greenhouse.ts`)
- `importGreenhouse(db, { batchId, providerEnvironment })`: read credential (`readGreenhouseCredential`), page every family through the Harvest client (bounded, rate-limit-aware), map via Phase 2, then `buildIntegrationImportReviewBatch(...)` → `saveIntegrationImportReviewBatch(db, batch)`.
- Idempotent per `batchId` (the store upserts on `batchRef` and replaces records) — re-running a batch is safe.
- Exposed as a server action (or an authenticated route under `app/api/integrations/greenhouse/import/`) gated by `manage_provider_connections`, matching the ADP auth gate.
- **Verify:** `import-greenhouse.test.ts` with a mock Harvest client + in-memory `integrationImportBatch` delegate — asserts a batch with the expected family counts is saved, and re-run replaces (no duplicate records).

### Phase 4 — Fixtures & wiring
- `apps/web/lib/integrate/greenhouse/fixtures/` — `job.json`, `candidate.json`, `application.json`, `offer.json`, `scorecard.json` (sanitized sample Harvest payloads; mirror ADP fixtures pattern).
- README note in the greenhouse dir pointing at the design doc and the two seam BIs (webhook/crosswalk BI-7FBE28A6, landing BI-02F1F944) so the next builder wires them, not re-invents.

## Risks & rollback

- **Rate limits / large candidate volume** → bounded pagination + `429`/`Retry-After` backoff; batch size cap. Blast radius: read-only, never blocks a domain write.
- **Attachment URL expiry (7 days)** → out of scope here (metadata only); flagged for the extraction BI.
- **Harvest v1/v2 → v3 deprecation (Aug 2026, secondary-sourced)** → version gate + doc-verify TODO before pinning.
- **PII** → redaction via shared `redact` on client responses + `sanitizeDisplayFields` on staging; comp/SSN never in display fields.
- **Rollback:** this connector only writes `readOnly` review records into `IntegrationImportBatch`/`StagedRecord`. Backing out = delete the greenhouse batch rows + the `apps/web/lib/integrate/greenhouse/` dir + the `greenhouse` `IntegrationCredential`. Zero impact on `EmployeeProfile` or any native domain data.

## Completion gate

`dpf-local-merge-ci-before-push` green (typecheck + the four new vitest files) on the merged tree, then `dpf-pr-with-dco`. Functional check: run `importGreenhouse` against the Greenhouse **sandbox** with a real Harvest key and confirm staged review records render on the import-review surface (per BI acceptance).

## Backlog coverage

- **Decision:** `atomic` — one BI (BI-B65B8C11); phases ship together as one read-adapter slice.
- **Receipt:** `cmsgu690i01n501p811e8qpji` (recorded 2026-08-05 against BI-B65B8C11).
- **Umbrella BI:** BI-B65B8C11.
- **Deliverables (none independently shippable):** harvest-client → harvest-to-staging → import-orchestrator → fixtures-tests.
- **External build-order dependency:** BI-AEE6136A (catalog + connect UI writes the `greenhouse` `IntegrationCredential`) must land first.
- **Adjacent slices (separate BIs, not in this plan):** BI-7FBE28A6 (webhook + crosswalk), BI-02F1F944 (hire→worker landing), BI-F3AEBF68 (native recruiting models).

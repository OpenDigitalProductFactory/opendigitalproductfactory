---
status: draft
---

# DPF -> DPF2 Convergence: Production Tenant Record Export Contract & Cutover Readiness

**Date:** 2026-11-22  
**Scope:** Sister DPF repository readiness for converging live production-tenant operations and platform execution workloads onto DPF2 with zero data loss and zero unverified cutovers.

---

## 1. Operating Guardrails

1. **The live production tenant stays on DPF** as the production test bed until DPF2 proves every cutover gate (record-migration parity, verified restore rehearsal, workload equivalence, and rollback readiness).
2. **Read-only export posture:** Rehearsal exports MUST execute inside a PostgreSQL `REPEATABLE READ READ ONLY` transaction and read content-addressed blobs via read-only copies. No live production row, sequence, schedule, or blob is mutated.
3. **Zero committed tenant data or secrets:** No live DB dumps, private tenant customer records, credentials, password hashes, payment tokens, or API tokens may ever be committed to git. Export artifacts live strictly outside version control (e.g. `$DPF_BACKUP_ROOT/dpf2-rehearsal-<YYYY-MM-DD>/`) with owner-only filesystem permissions (`chmod 700`).
4. **Regenerable projections stay out of the authoritative export:** Postgres rows and content-addressed `DocumentBlob` files are the system of record. Derived `DocumentRendition` projections, Qdrant embeddings, and Neo4j graph projections are regenerated in DPF2 and validated during rehearsal.

---

## 2. Minimal Production-Tenant Record Export Contract (Rehearsal Scope)

The rehearsal bundle exports three bounded, FK-ordered slices from the DPF Postgres database (`packages/db/prisma/schema/`) plus paired content-addressed files from the document blob store (`apps/web/lib/documents/blob-storage.ts`).

### 2.1 Slice 1 — Organization & Principal Identity

Source schema: `packages/db/prisma/schema/core-identity.prisma`.

| Order | Prisma Model (Postgres Table) | Filter / Scope | Natural / Join Key | Explicitly Excluded Columns |
| --- | --- | --- | --- | --- |
| 1 | `Organization` (`"Organization"`) | `slug = :org_slug` | `orgId`, `slug`, `id` | None |
| 2 | `BusinessContext` (`"BusinessContext"`) | `organizationId = :org_id` | `organizationId` (1:1) | None |
| 3 | `OrgSettings` (`"OrgSettings"`) | Active install row(s) | `id` | None |
| 4 | `BusinessProfile` (`"BusinessProfile"`) | `isActive = true` | `profileKey` | None |
| 5 | `OrganizationCapabilityActivation` (`"OrganizationCapabilityActivation"`) | `organizationId = :org_id` | `id` | None |
| 6 | `Principal` (`"Principal"`) | `status = 'active'` AND referenced by org (`topAccountablePrincipalId`), Slice 2 profiles/versions, Slice 3 documents/ownership, or Slice 3 `createdById` users resolved through §2.3.3 (including `sponsorPrincipalId` closure) | `principalId`, `id` | None |
| 7 | `PrincipalAlias` (`"PrincipalAlias"`) | `principalId IN (:exported_principals)` | `(aliasType, aliasValue, issuer)` | None |
| 8 | `AuthorityBinding` + `AuthorityBindingSubject` + `AuthorityBindingGrant` | Active non-revoked bindings for `:exported_principals` | `id` | Never export raw tokens (`McpApiToken`, `ApiToken`, `OAuthClient`, `OAuthAuthorizationCode`, `OAuthRefreshToken`, `PasswordResetToken`) or `User.passwordHash` |

> **Credential hygiene rule:** Authentication secrets and OAuth/MCP bearer tokens are **never** migrated across platforms. DPF2 mints fresh credentials bound to imported `Principal` identities after identity parity is confirmed.

### 2.2 Slice 2 — Active Policies and Decision Ledger

Source schemas: `packages/db/prisma/schema/decision-governance.prisma`, `packages/db/prisma/schema/knowledge-docs.prisma`.

| Order | Prisma Model (Postgres Table) | Filter / Scope | Natural / Join Key | Notes |
| --- | --- | --- | --- | --- |
| 9 | `DecisionPerspectiveProfile` (`"DecisionPerspectiveProfile"`) | `status = 'active'` AND (`(kind = 'organization' AND "ownerOrganizationId" = :org_id)` [WWWD] OR `(kind = 'profession' AND ("ownerOrganizationId" IS NULL OR "ownerOrganizationId" = :org_id))` [WSID: shared or owned by the selected organization, never another tenant's]) | `profileId` | Preserves `scope`, `fallbackProfileId`, `defaultResolver`, `autonomyPolicy`, `currentVersionId` |
| 10 | `DecisionPerspectiveProfileVersion` (`"DecisionPerspectiveProfileVersion"`) | `profileId IN (:exported_profiles)` (full lineage or at minimum `currentVersionId`) | `versionId`, `(profileId, versionNumber)` | Preserves `materialFingerprint`, `changeSummary`, `promotedByPrincipalId` |
| 11 | `PerspectiveMaterial` (`"PerspectiveMaterial"`) | `profileId IN (:exported_profiles)` AND `freshness = 'current'` AND `reviewStatus <> 'rejected'` AND `promotionState IN ('promoted', 'candidate')` | `materialId` | Preserves `sourceType`, `sourceRef`, `domainClass`, `direction`, `domains`, `evidenceGrade`, `stalenessPolicy`, `confidenceWeight`, `summary` |
| 12 | `WikiPage` (`"WikiPage"`) | (`organizationId = :org_id` AND `status = 'published'` [WWWD overlays]) OR (`id IN (:material_referenced_page_ids)` [WSID profession pages carrying `metadata.professionJurisdiction` / `professionCompetencyLevel`]) | `(organizationId, slug)` / `id` | Base `isKernel = true` pages come from DPF2's kernel seed; org overrides retain `kernelPageId` + `derivedFromKernelVersion` |
| 13 | `WikiPageRevision` + `WikiPageLink` | Latest revision per exported `WikiPage`; links where both endpoints are in exported `WikiPage` set | `pageId` | Maintains citation graph for PPR / wiki backlinks |
| 14 | `RegulatoryAutonomyPolicy` + `JurisdictionCriteriaProfile` | Active policies matching `BusinessContext.operatesIn` / `sellsTo` / `employsIn` | `id` | Preserves org regulatory autonomy boundaries |
| 14a | `DecisionInteraction` (`"DecisionInteraction"`) | Rehearsal set defined in §2.2.1. Final transfer covers all in-scope retained history, not just active profiles or the latest version | `id`, `interactionId`, `profileId`, `profileVersionId` | Same schema in the successor relational plane. Include the WWMD ledger and the business/craft history admitted by scope. Never store the canonical ledger in OS state. |

#### 2.2.1 Decision ledger closure and parity

WWMD evaluation moves closer to the OS, while the [decision ledger stays relational](2026-11-24-wwmd-os-binding-design.md#2-migrate-the-ledger-in-the-same-relational-schema). This adds a requirement to Slice 2. The example export below does not yet include the decision ledger and cannot certify its parity.

- **Prove scope before export.** Organization-owned rows are candidates only for the selected organization. Shared platform/profession profiles and their versions are not tenant ownership evidence. Include their interactions only with proven source-install/tenant provenance. If attribution or a shared chain's scope cannot be established, hold the affected ledger export rather than guessing or exporting another tenant's history. Use a bounded selection of complete, closed chains and representative unsealed rows in rehearsal. Use cursor batches in the final snapshot, with no silent row cap.
- **Load parents and exact versions first.** Include referenced profile and version rows, including inactive/historical versions and fallback profiles, not only the active-policy slice above. Close populated FKs over `Agent`, `TaskRun`, `FeatureBuild`, `DeliberationRun` and `User` using authorized successor rows and verified identity mappings. Do not ship credential state or manufacture a user/agent to satisfy a FK. If a dependent record cannot be resolved, hold transfer for that set. Resolve child-record dependencies (outcomes, escalation/deferral captures, resolution proposals, voice outputs and evidence reverifications) in the restore inventory before calling the ledger complete.
- **Preserve records and verify continuity.** Copy stable interaction IDs, timestamps, options, sources, outcome payloads and seal fields (`chainId`, `prevHash`, `chainEntryHash`, `sealedAt`). Never silently drop history, reseal or synthesize missing links. Keep null seals null. Report source counts and heads per chain, unsealed counts, unresolved mappings and anomalies, then compare restored counts, FKs, IDs, preserved hashes and chain topology. A pre-existing anomaly is not a pass. Keep the manifest and payloads out of version control and apply the credential hygiene rule to nested payloads. If safe handling would require changing sealed data, hold rather than rewriting it.
- **Promote one writer.** Validate on a synthetic isolated restore first. At cutover quiesce legacy ledger writes, verify the final snapshot and chain heads, then enable the successor writer. A synthetic successor append must extend the restored head. After live successor writes, the predecessor remains read-only until those entries are reconciled for any rollback.

### 2.3 Slice 3 — One Recurring Customer Commitment & Document Workflow

Source schemas: `packages/db/prisma/schema/crm-commerce.prisma`, `packages/db/prisma/schema/finance.prisma`, `packages/db/prisma/schema/knowledge-docs.prisma`.

Select **one** representative active customer commitment chain (`CustomerAccount` -> `Subscription` -> `RecurringSchedule` -> `Invoice` -> `InvoiceDocument` -> `Document`/`DocumentVersion`/`DocumentBlob`). This single bounded graph exercises commercial party identity, recurring schedule state, regulated financial immutability (`minYears=7`), and content-addressed file custody without exporting the full customer ledger.

| Order | Prisma Model (Postgres Table) | Filter / Scope | Natural / Join Key | Redaction / Rehearsal Hygiene |
| --- | --- | --- | --- | --- |
| 15 | `CustomerAccount` (`"CustomerAccount"`) | `id = :rehearsal_account_id` AND `status = 'active'` AND `"mergedIntoId" IS NULL` | `accountId`, `id` | Never committed; stays in local rehearsal bundle only |
| 16 | `CustomerContact` + `ContactAccountRole` | `accountId = :rehearsal_account_id` AND `isActive = true` | `email`, `id` | **Exclude `passwordHash`** |
| 17 | `Subscription` (`"Subscription"`) | `accountId = :rehearsal_account_id` AND `status = 'active'` (1 chosen active contract) | `subscriptionRef`, `id` | Optional `SalesOrder`/`Quote` ref exported as metadata if linked |
| 18 | `RecurringSchedule` + `RecurringLineItem` | Schedule located by `"scheduleId" = :rehearsal_schedule_id` (the operator-facing reference) AND `"accountId" = :rehearsal_account_id` AND `status = 'active'` (linked via `subscriptionId` where present). Line items by `RecurringLineItem."scheduleId" = RecurringSchedule.id` (the internal id, despite the column name) | `scheduleId`, `id` | Preserves `frequency`, `nextInvoiceDate`, `lastInvoicedAt`, `autoSend`, `recurrenceScheduleId`. When `recurrenceScheduleId` is set, export the referenced `RecurrenceSchedule` row too |
| 19 | `Invoice` + `InvoiceLineItem` | `"sourceType" = 'recurring'` AND `"sourceId" = RecurringSchedule.id` of the row located in order 18 (most recent 1–3 cycles by `"issueDate"`). The writer stores the internal id (`apps/web/lib/actions/recurring.ts`, `generateDueInvoices`), never `scheduleId` | `invoiceRef`, `id` | **Exclude/null `payToken` and `signatureDataUrl` if unneeded for dry-run** so live customer payment URLs cannot collide |
| 20 | `InvoiceDocument` (`"InvoiceDocument"`) | `invoiceId IN (:exported_invoice_ids)` | `(invoiceId, role, revision)` | Write-once binding to `DocumentVersion.id` (`sent-copy` / `signed-copy`) |
| 21 | `Document` (`"Document"`) | `"organizationId" = :org_id` AND `id IN (SELECT "documentId" FROM "DocumentVersion" WHERE id IN (:exported_doc_version_ids))`. A referenced document owned by another organization is a hold, not a silent drop | `documentId`, `id` | Preserves `currentVersionId`, `currentState`, `accessScope`, `classification` |
| 22 | `DocumentVersion` (`"DocumentVersion"`) | All versions referenced by `InvoiceDocument` or `Document.currentVersionId` | `(documentId, version)`, `id` | Preserves `contentSha256`, `sizeBytes`, `contentBlobId` |
| 23 | `DocumentBlob` (`"DocumentBlob"`) | `id IN (:exported_blob_ids)` | `sha256`, `storageKey` | Paired with raw bytes copied read-only from `<BLOB_ROOT>/<storageKey>` (`documents/sha256/<aa>/<bb>/<sha256>`) |
| 24 | `DocumentLifecycleEvent`, `DocumentTag`, `DocumentReference`, `DocumentAccessGrant` | `documentId IN (:exported_document_ids)` | `id` | Preserves document audit & access metadata |

#### 2.3.1 Tenant scoping for the commerce slice

`CustomerAccount`, `CustomerContact`, `Subscription`, `RecurringSchedule`, `RecurringLineItem`, `Invoice` and `InvoiceLineItem` carry no organization key, so no filter can scope them to one tenant. For the first rehearsal the export asserts, inside the same snapshot transaction, that exactly one `Organization` row exists and that its `slug` equals `:org_slug`. The manifest records the assertion as `tenantScope: { mode: "single-organization-install", organizationCount, matchedSlug }`.

If the snapshot holds more than one organization, the export still writes Slices 1 and 2 but writes no Slice 3 rows and records `slice3: { status: "held", reason: "commerce-ownership-unverifiable" }`. The hold lifts only when a supported mapping proves which organization owns the commerce rows; the export never guesses from account names or contact emails.

Rows that do carry an organization key stay filtered by it: `Document."organizationId"` (order 21) and `DecisionPerspectiveProfile."ownerOrganizationId"` (order 9). A two-tenant fixture verifies the filters: the second tenant's documents and organization-owned profession profiles are absent, and Slice 3 is held.

#### 2.3.2 Value encoding

- `Decimal` columns (amounts, quantities, unit prices, tax and discount rates, totals) are emitted as JSON strings carrying the exact PostgreSQL `numeric` text (`"amount"::text`). Never as JSON numbers: a double cannot represent every `numeric` value, and a rounding drift fails the invoice-total parity gate (§2.5.4) for reasons unrelated to the successor.
- Timestamps are emitted as ISO-8601 strings with an explicit `+00:00` offset. Prisma `DateTime` columns are PostgreSQL `timestamp without time zone` holding UTC, so the export runs `SET LOCAL TIME ZONE 'UTC'` and casts each one `AT TIME ZONE 'UTC'`; a bare `timestamp` would serialize with no offset and could be read as local time.
- JSON columns are emitted as JSON values, not re-encoded strings.

#### 2.3.3 `User` references in the commerce slice

`RecurringSchedule."createdById"`, `Invoice."createdById"` and `InvoiceDocument."createdById"` reference `User`, which this contract never exports (it carries `passwordHash` and login state). Slice 1 exports `Principal`. The existing platform mapping is `PrincipalAlias` with `aliasType = 'user'`, `issuer = ''`, `aliasValue = User.id` (used by `packages/db/src/install-work-owner.ts` and the Workroom stage-decision lookup).

For each of the three columns the export:

1. resolves the user through that alias to an active `Principal` and adds the principal to the Slice 1 closure (order 6);
2. emits the resolved `createdByPrincipalId` and does not emit the raw `User.id`;
3. emits `null` when the column is null, the alias is missing, or the principal is not active, and counts each case in the manifest under `unresolvedReferences: [{ table, column, nullCount, unresolvedCount }]`.

The import treats an unresolved creator as unknown authorship, never as authorship by the importing principal. Creator attribution is not part of the recurring-invoice parity gate.

### 2.4 Read-Only Export Command & Manifest

Reuses DPF's verified backup posture (`scripts/backup-postgres.sh`, `scripts/postgres-trial-restore.sh`): point-in-time read-only snapshot, SHA-256 checksums, zero writes to production Postgres, and explicit secret-column exclusion.

```bash
#!/usr/bin/env bash
# Read-only rehearsal export (run locally; NEVER commit EXPORT_DIR).
set -euo pipefail

: "${DPF_PRODUCTION_DB_CONTAINER:=dpf-postgres-1}"
: "${POSTGRES_USER:=dpf}"
: "${POSTGRES_DB:=dpf}"
: "${ORG_SLUG:?Set ORG_SLUG (target organization slug)}"
: "${REHEARSAL_SCHEDULE_ID:?Set REHEARSAL_SCHEDULE_ID (RecurringSchedule.scheduleId)}"
: "${UPLOAD_STORAGE_PATH:=./data/uploads}"
: "${DPF_BACKUP_ROOT:?Set DPF_BACKUP_ROOT outside git tracking}"
: "${EXPORT_DIR:=$DPF_BACKUP_ROOT/dpf2-rehearsal-$(date -u +%Y-%m-%d)}"

umask 077
mkdir -p "$EXPORT_DIR/tables" "$EXPORT_DIR/blobs"

# Single REPEATABLE READ READ ONLY snapshot transaction exporting NDJSON summary
# and blob manifest. Every query omits secret columns (passwordHash, payToken,
# and API/OAuth tokens).
docker exec -i "$DPF_PRODUCTION_DB_CONTAINER" \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -v org_slug="$ORG_SLUG" -v schedule_id="$REHEARSAL_SCHEDULE_ID" \
  --quiet --tuples-only --no-align <<'SQL' > "$EXPORT_DIR/snapshot.ndjson"
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL TIME ZONE 'UTC';

WITH org_guard AS (
  -- §2.3.1: the commerce slice has no organization key, so it is exported
  -- only when the snapshot holds exactly one organization and it is the target.
  SELECT count(*) AS organization_count,
         count(*) FILTER (WHERE slug = :'org_slug') AS matched_count
  FROM "Organization"
),
target_org AS (
  SELECT id FROM "Organization" WHERE slug = :'org_slug'
),
slice3_allowed AS (
  SELECT (organization_count = 1 AND matched_count = 1) AS ok FROM org_guard
),
target_sched AS (
  -- Located by the operator-facing scheduleId; every FK uses the internal id.
  SELECT id, "scheduleId", "accountId", "subscriptionId", "createdById",
         amount::text AS amount, currency, frequency, "nextInvoiceDate"
  FROM "RecurringSchedule"
  WHERE "scheduleId" = :'schedule_id' AND status = 'active'
    AND (SELECT ok FROM slice3_allowed)
),
target_invoices AS (
  SELECT id, "createdById" FROM "Invoice"
  WHERE "sourceType" = 'recurring'
    AND "sourceId" IN (SELECT id FROM target_sched)
  ORDER BY "issueDate" DESC
  LIMIT 3
),
target_invoice_docs AS (
  SELECT "documentVersionId", "createdById"
  FROM "InvoiceDocument"
  WHERE "invoiceId" IN (SELECT id FROM target_invoices)
),
target_doc_versions AS (
  SELECT DISTINCT v.id, v."documentId", v."contentBlobId"
  FROM "DocumentVersion" v
  JOIN "Document" d ON d.id = v."documentId"
  WHERE v.id IN (SELECT "documentVersionId" FROM target_invoice_docs)
    AND d."organizationId" IN (SELECT id FROM target_org)
),
foreign_doc_versions AS (
  -- §2.3.1: a referenced document owned by another organization is a hold.
  SELECT "documentVersionId" FROM target_invoice_docs
  WHERE "documentVersionId" NOT IN (SELECT id FROM target_doc_versions)
),
target_docs AS (
  SELECT DISTINCT "documentId" AS id FROM target_doc_versions
),
target_profiles AS (
  SELECT "profileId"
  FROM "DecisionPerspectiveProfile"
  WHERE status = 'active'
    AND (
      (kind = 'organization' AND "ownerOrganizationId" IN (SELECT id FROM target_org))
      OR (kind = 'profession' AND ("ownerOrganizationId" IS NULL
                                   OR "ownerOrganizationId" IN (SELECT id FROM target_org)))
    )
),
creator_refs AS (
  -- §2.3.3: resolve User creators through the canonical PrincipalAlias mapping.
  SELECT 'RecurringSchedule' AS tbl, "createdById" AS user_id FROM target_sched
  UNION ALL SELECT 'Invoice', "createdById" FROM target_invoices
  UNION ALL SELECT 'InvoiceDocument', "createdById" FROM target_invoice_docs
),
creator_resolution AS (
  SELECT r.tbl, r.user_id, p.id AS principal_id
  FROM creator_refs r
  LEFT JOIN "PrincipalAlias" a
    ON a."aliasType" = 'user' AND a.issuer = '' AND a."aliasValue" = r.user_id
  LEFT JOIN "Principal" p ON p.id = a."principalId" AND p.status = 'active'
)
SELECT json_build_object(
  'contractVersion', '1.1',
  'exportedAt', now(),
  'schemaMigrationHead', (SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1),
  'tenantScope', (
    SELECT json_build_object('mode', 'single-organization-install',
                             'organizationCount', organization_count,
                             'matchedSlug', matched_count = 1)
    FROM org_guard
  ),
  'slice3', CASE
    WHEN NOT (SELECT ok FROM slice3_allowed)
      THEN json_build_object('status', 'held', 'reason', 'commerce-ownership-unverifiable')
    WHEN EXISTS (SELECT 1 FROM foreign_doc_versions)
      THEN json_build_object('status', 'held', 'reason', 'document-owned-by-another-organization')
    ELSE json_build_object('status', 'exported')
  END,
  'counts', json_build_object(
    'Organization', (SELECT count(*) FROM target_org),
    'DecisionPerspectiveProfile', (SELECT count(*) FROM target_profiles),
    'RecurringSchedule', (SELECT count(*) FROM target_sched),
    'Invoice', (SELECT count(*) FROM target_invoices),
    'Document', (SELECT count(*) FROM target_docs),
    'DocumentVersion', (SELECT count(*) FROM target_doc_versions)
  ),
  -- §2.3.2: Decimal values travel as exact strings.
  'schedule', (
    SELECT json_build_object('scheduleId', "scheduleId", 'amount', amount,
                             'currency', currency, 'frequency', frequency,
                             'nextInvoiceDate', "nextInvoiceDate" AT TIME ZONE 'UTC')
    FROM target_sched
  ),
  'unresolvedReferences', (
    SELECT coalesce(json_agg(json_build_object(
             'table', tbl, 'column', 'createdById',
             'nullCount', null_count, 'unresolvedCount', unresolved_count)), '[]'::json)
    FROM (
      SELECT tbl,
             count(*) FILTER (WHERE user_id IS NULL) AS null_count,
             count(*) FILTER (WHERE user_id IS NOT NULL AND principal_id IS NULL) AS unresolved_count
      FROM creator_resolution GROUP BY tbl
    ) per_table
  ),
  'blobStorageKeys', (
    SELECT coalesce(json_agg(json_build_object('id', b.id, 'sha256', b.sha256, 'storageKey', b."storageKey", 'sizeBytes', b."sizeBytes")), '[]'::json)
    FROM "DocumentBlob" b
    WHERE b.id IN (SELECT "contentBlobId" FROM target_doc_versions WHERE "contentBlobId" IS NOT NULL)
  )
);

COMMIT;
SQL

# Verify every exported blob byte-for-byte against DocumentBlob.sha256 (read-only copy).
# Storage root resolution matches apps/web/lib/documents/blob-storage.ts:
# PlatformConfig(key='upload_storage_path') -> UPLOAD_STORAGE_PATH -> ./data/uploads
sha256sum "$EXPORT_DIR/snapshot.ndjson" > "$EXPORT_DIR/snapshot.ndjson.sha256"
```

*(Full table-by-table `COPY (SELECT ...) TO STDOUT` / JSONL extraction uses the same `REPEATABLE READ READ ONLY` transaction boundary and CTEs above, writing one file per table under `$EXPORT_DIR/tables/<Model>.jsonl`, copying each referenced `documents/sha256/<aa>/<bb>/<sha256>` file read-only into `$EXPORT_DIR/blobs/`, verifying `sha256sum`, and emitting `$EXPORT_DIR/manifest.json`.)*

#### 2.4.1 Scratch-database verification of the example (2026-11-24)

On 2026-11-24 the SQL above was copied exactly from this file and run, with the flags shown, against a throwaway `pgvector/pgvector:pg16` container. All 666 migrations were applied in order, through `20261120180000_workroom_dispatch_build_effect`. The data was a synthetic fixture; no live tenant database was read. Each output was checked by parsing every line as JSON. (This record was meant to land with PR #7185 and is added here.)

- **One organization:** exit 0, one valid NDJSON line, `slice3.status = "exported"`. A decoy invoice whose `sourceId` held the operator `scheduleId` instead of the internal id was excluded: 2 invoices exported, not 3. The schedule amount came back as the exact string `"12345678901234567.890123456789000000000000000000"`. Prisma `Decimal` maps to `numeric(65,30)`, so trailing zeros are part of the exact value; the importer compares values numerically, not as text. `nextInvoiceDate` serialized as `2026-12-01T00:00:00+00:00`. Creator counts matched the fixture: the schedule creator resolved through `PrincipalAlias`, one invoice creator was unresolved, one invoice-document creator was null.
- **Two organizations:** exit 0, one valid line, `slice3 = { status: "held", reason: "commerce-ownership-unverifiable" }`, every Slice 3 count 0. The second tenant's organization and profession profiles were excluded (3 profiles exported).

Without `--quiet`, psql writes `BEGIN`, `SET` and `COMMIT` command tags into `snapshot.ndjson` and the file is no longer valid NDJSON. The `document-owned-by-another-organization` hold is defensive: it cannot trigger while the single-organization guard holds, and becomes reachable once a supported commerce ownership mapping lifts that guard.

#### 2.4.2 Synthetic restore artifact for the same-schema rehearsal

WWMD advisory `DI-520267766767` and the ratified install-is-the-tenant rule make the first Gate 3 rehearsal a same-schema cold restore of DPF's own database, not a translated export. [`scripts/convergence/build-synthetic-restore-artifact.sh`](../../../scripts/convergence/build-synthetic-restore-artifact.sh) builds its input from fictional data only (BI-3357F36E):

1. Start a throwaway `pgvector/pgvector:pg16` container. Apply every migration in order, each in one transaction as Prisma does, and record each in `_prisma_migrations` with the SHA-256 of its `migration.sql`.
2. Load [`synthetic-restore-fixture.sql`](../../../scripts/convergence/synthetic-restore-fixture.sql): one organization, a creator mapped through `PrincipalAlias(user)`, one with no alias, and one recurring customer chain through invoice documents, with amounts a double cannot carry.
3. Run the production `scripts/backup-postgres.sh` against that container. Its `pg_restore --list` check runs with the container's own PostgreSQL 16 client.

The output folder holds `backup/` (exactly `manifest.json`, `dpf.dump`, `dpf.dump.sha256`, `log.txt`, the shape DPF2's intake reads), `files/` (the synthetic document bytes at their storage keys) and `provenance.json` (source commit, migration head, fixture and dump digests, files manifest). Nothing is added to `backup/`, because DPF2's intake refuses any extra entry. The files manifest moves into the backup shape once BI-1C6BF6B6 agrees one with DPF2. The script writes outside any git checkout with owner-only permissions and refuses to overwrite an existing artifact.

### 2.5 Rehearsal Restore & Parity Verification Gates

Before ANY live tenant cutover is considered, DPF2 must pass all five rehearsal gates against an ephemeral staging database (`dpf2_rehearsal_<ts>`):

1. **FK & Schema Integrity Gate:** Every table in Slices 1–3 imports cleanly in topological order with zero dangling FKs, zero constraint violations, and exact row-count parity against `manifest.json`. Apply the ledger scope, chain and single-writer checks in §2.2.1. A held or omitted ledger is not cutover-ready.
2. **Blob Custody Gate:** Every `DocumentBlob` file restores to DPF2's content-addressed store and passes SHA-256 verification against `DocumentVersion.contentSha256` and `DocumentBlob.sha256`.
3. **Policy Evaluation Parity Gate:** Active WWWD (`kind = 'organization'`) and WSID (`kind = 'profession'`) profiles resolve identical `currentVersion.materialFingerprint`, `autonomyPolicy`, and `PerspectiveMaterial` sets, and sample `evaluate_org_business_decision` / `principle_decide` decisions produce equivalent outcomes against DPF.
4. **Recurring Workflow Dry-Run Parity Gate:** Running DPF2's equivalent of `generateDueInvoices()` (`apps/web/lib/actions/recurring.ts`) in dry-run / outbound-disabled mode on the restored `RecurringSchedule` computes the exact next invoice date, line-item totals, tax calculation, and immutable `InvoiceDocument` linkage without sending any external email or payment notice.
5. **Rollback Proof Gate:** DPF's own `scripts/backup-postgres.sh` + `scripts/postgres-trial-restore.sh` pass with exit code `0` within 24h prior to any stage transition.

### 2.6 Execution authority at the plane boundary (BI-122007A5)

**Status:** Proposed source-to-destination contract for data-owner review. Gate 3 restores the DPF database whole, including the source rows below, but restoring a row does not let it authorize a new OS execution. “Same schema” means that DPF keeps custody and behavior. “Plane-changing” means that the successor enforces a narrower translated record outside DPF's database. Source audit rows remain readable, never a second authority writer. The matrix uses Prisma model names; mapped PostgreSQL names are shown where they differ. The scope here is execution of a transferred workload, not every business authorization rule.

The November 13 placement decision in the DPF2 plan puts realized permits, epochs, revocations and execution evidence in the protected executor's custody. DPF keeps identity, job qualification, approval decisions, Workroom intent and acceptance. DPF2's `packages/core/src/permit-projection.ts` at `3b49f0c1` verifies scope, session, epoch and expiry, but identifies the current format as synthetic. These rules are import acceptance criteria, not a claim that a production importer or an equivalent OS right exists today. The source at `a8a4d264c06a` has no JSI qualification model. `coordinator-eligibility.ts` distinguishes an absent scheme from failed qualification. The receiver must use the DPF-composed qualification outcome, not invent a target qualification or grant on an unavailable read.

| Source PostgreSQL table / field | Classification and destination owner | Translation and inactive-state rule |
| --- | --- | --- |
| `GppPermit` | Plane-changing to the protected permit issuer and per-call monitor | Bind source permit, shape/stage/gate decision, GAID and principal, room, subject, capability/argument digest, parent and nonce to the current admitted session and launcher generation. Intersect with current DPF scope and qualified OS rights; preserve original not-before, expiry and remaining uses. Never import its MAC or signing key as destination authority. Retain revoked, expired, exhausted and invalid ancestor states as deny evidence; never reissue them. |
| `AgentToolGrant` | Plane-changing at enforcement, with DPF retaining the grant table and policy writer | At admission compile the effective tool ceiling for the GAID/job, binding and stage. Intersect with current user and session authority and with the launcher's declared rights. Do not turn a tool name into a filesystem or network right. No reload from seed defaults on an unavailable grant read. |
| `AgentToolGrantRevocation` | Plane-changing to the protected revocation/epoch owner | Translate the GAID and grant key to a durable negative fact and advance the affected policy or session fence before enabling work. Preserve revocation time and source evidence even if no current grant row exists. No restore, reconnect or regrant may reactivate an older session. |
| `ToolExecutionReceipt` | Plane-changing for execution evidence, to the protected effect-receipt owner | Retain the source execution/receipt IDs, subject/build binding, kind, input fingerprint, output digest, receipt status, execution status and expiry. Bind new receipts to the exact successor effect and attempt; use proven legacy outcomes only for dedupe/readback. Preserve failures and expired evidence; neither is permission or a successful destination execution. |
| `Workroom` (`WorkCapsule`): `leaseHolderPrincipalId`, `leaseExpiresAt`, executor/worktree refs and runtime state in `scopeClaims` / `workspaceState` | Plane-changing for the execution claim, to the Workroom receiver and protected executor. Other Workroom fields are same-schema | Cross-reference capsule, canonical principal/GAID, stage, source head and worktree to a qualified receiver, attempt and generation. A source lease is not a target lease. Prove stop or explicit handoff before a fresh claim, with no extension of source approval. Preserve release, expiry, terminal and unknown-liveness state; unknown is held. |
| `WorkroomParticipant` (`WorkCapsuleParticipant`), `WorkroomRelation`, `McpResourceSubscription` | Same-schema DPF membership authority; its active admission is projected into the protected session | Re-read member lifecycle and role at admission and fence sessions when membership narrows or ends. Never turn a room relation or subscription into a new room grant. Keep removed participants and their lifecycle evidence; restoring a participant does not admit it. |
| `WorkroomEffect` | Plane-changing for protected process effects, to the new effect owner; other outbox effects stay in DPF | Carry room + command key + ordinal, sequence, process-bound flag, session generation, attempts and disposition. Never adopt an old worker lease or replay a process-bound effect from a dead generation. Preserve succeeded, failed, retired, cancelled and uncertain dispositions without collapsing one into another. Reconcile dedupe and in-flight effects before permitting a new attempt. |
| `WorkroomActivity` (`WorkCapsuleActivity`) | Same-schema DPF journal, with plane-changing command/effect identity carried as evidence | Preserve sequence, command scope/key and receipt references. Use those identities to reconcile the successor's exact effect, not to republish audit entries as commands. |
| `McpApiToken` where `kind = 'workroom_session'` | Plane-changing to the qualified protected-session issuer | Revoke/retire the source session token and issue only for fresh admission. Bind principal, room, run, current stage/generation, capability, scopes and expiry. Never copy bearer bytes, hashes or encrypted secrets for use across the boundary. Preserve revoked, released and expired state as negative evidence. |
| `McpToolSession` | Same-schema tool-disclosure cache in DPF | Cache holds loaded names and expiry, not permission. Start the new session cache empty; do not restore cached discovery as a grant. |
| `TaskRun` and `TaskNode` | Same-schema DPF workflow history; the admitted attempt fields for transferred sessions are plane-changing | Preserve run/node IDs and application state. Project the verified request/authority digest, task and owner, reservation, dispatch claim and attempt fence to the protected attempt; do not accept caller-supplied replacements. Preserve expired, held, cancelled, terminal or execution-uncertain state. Settle recorded winners before retry, and never start solely from a restored JSON envelope. |
| `Sandbox`, `SandboxSlot`, `NonProductionEnvironmentLease` | Same-schema for DPF's retained build/CI infrastructure; live process handles do not transfer | Keep the source assignment and release history. Never translate a container ID, PID, URL, slot or lease into protected host access. End or reconcile the lease on its own substrate. |
| `AuthorityBinding`, `AuthorityBindingSubject`, `AuthorityBindingGrant` | Same-schema DPF policy. Only realized scope and versions change enforcement plane | Project the approved subject, scope, deny and current binding at admission. Keep inactive and negative bindings; never copy a policy row as a live permit. |
| `Principal`, `PrincipalAlias`, `User`, `PlatformRole`, `UserGroup`, `Team`, `TeamMembership`, `OrganizationCapabilityActivation` | Same-schema DPF identity, role and capability policy | Preserve identity, disabled or inactive state and grants in the original plane. Resolve the canonical principal and GAID without alias guessing. No copied user session or portal credential becomes OS identity. |
| `Agent`, `AgentOwnership`, `AgentGovernanceProfile`, `AgentCapabilityClass`, `DirectivePolicyClass`, `AgentExecutionConfig`, `AgentSkillAssignment`, `SkillAssignment`, `DelegationGrant`, `DelegationChain` | Same-schema DPF role, policy and delegation | Keep conditions, revocations, expiry, use counts and ownership. Only a verified authority result constrains the launch. Never grant in the launcher from an unqualified profile or expired delegation. |
| `PortfolioBudgetPeriod`, `BudgetReservation`, `AgentBudgetEvent`, `AgentModelConfig`, `PolicyRule`, `ModelProfile`, `CliPoolStatus`, `ProviderCapacityStatus` | Same-schema for DPF's budget, model policy and existing capacity records | Preserve spend, reservations and active holds. Re-read ceilings before start or redirect. Carry only the allowed run budget to the protected attempt. Capacity observations never grant tool authority. |
| `CoworkerActionEnvelope`, `AgentActionProposal`, `AuthorizationDecisionLog`, `DecisionInteraction` | Same-schema DPF approval and decision records | Keep the original approval binding/fingerprint, expiry and resolution. Verify any referenced approval at the source. No pending, spent or expired approval can become an executable permit. |
| `ToolExecution`, `GppPermitObservation`, `BuildDispatchAttempt`, `BuildPhaseRun`, `ArtifactReceiptUsage` | Same-schema DPF audit and provenance | Keep original links, errors and receipt references. Keep already-consumed receipts spent. New protected executions produce their own evidence; observation is not authority. |
| `FeatureBuild`, `BacklogItem`, `Epic`, `WorkItem`, `QuiescenceRun`, `BuildEngineState` (`build_engine_state`), `SelfUpgradeRun`, `RuntimeCapabilityTransition`, `RuntimeCapabilityTransitionEvent`, `PlatformCapability` | Same-schema DPF product, coordination and host-transition writers | Keep claims, inhibits, terminal and recovery records. Build Studio is not an OS store. Withdraw host-bound effects from the rehearsal instead of resuming them. |
| `AsyncInferenceOp`, `AsyncInferenceOperationTransition`, `JobEvent`, `JobRun`, `JobStep`, `JobWait`, `JobConcurrencySlot`, `JobCronState`, `ScheduledJob`, `ScheduledAgentTask`, `WorkSchedule`, `RecurrenceSchedule` | Same-schema DPF jobs and scheduler state | Keep business intent, progress, dedupe, deadlines and expiry. Match completed effects before starting a successor workload. Do not let a restored lease, wake, cron cursor or outbox act in an outbound-off portal. |
| Other `McpApiToken` kinds, `ApiToken`, `OAuthClient`, `OAuthAuthorizationCode`, `OAuthRefreshToken`, `SocialIdentity`, `AccountInvite`, `PasswordResetToken` | Same-schema DPF login and endpoint authority | Protected custody only for the dump. Preserve expiry and revocation; do not route to a live entry point or copy credentials to the executor. |
| `CredentialEntry`, `IntegrationCredential`, `McpServer`, `McpServerTool`, `McpIntegration`, `MailboxAccount`, `CommunicationChannelBinding`, `CommunicationChannelSession`, `IntegrationCallbackReceipt`, `BrowserSessionBinding`, `OAuthPendingFlow`, `DeviceCodeSession`, `AiProviderConnection` | Same-schema DPF connector and provider authority | Keep source identities, disabled/disconnected state and callback fences. Do not bring provider keys or activation state into launcher authority. No connector reconnect, callbacks or effects in the rehearsal. |
| `EdgeNode`, `EdgeNodeCapability`, `EdgeNodeCertificate`, `BootstrapToken`, `FederationLink`, `FederationBootstrapToken`, `FederationPairingSession`, `RemoteAction` | Same-schema for existing DPF edge and federation. OS installation membership custody is separate Gate 4 work | Preserve expiry, revocation and link audience; a DPF peer, credential or remote action is not a DPF2 installation membership grant. No automatic conversion. |
| `DocumentAccessGrant`, `PatientAuthority`, `PatientConsentDirective`, `CareIntakeAccessGrant`, `ControlledSubstanceHandlerAuthorization`, `ProviderClearanceOverride`, `BusinessModelRoleAssignment`, `VoiceConsentRecord`, `DriverLocationConsent`, `OutboundApprovalDecision`, `DataControlOperation`, `DataControlOperationStep` | Same-schema DPF resource, consent, publication and data-operation authorities | Keep domain authorization and denial with the owning DPF service. A protected process does not own or bypass those checks. Preserve rescinded approval, expiry, revocation, leases and effect history. |

Source checks: the named Prisma models and their relations under `packages/db/prisma/schema/`, plus `apps/web/lib/gpp/permit-{store,enforcement}.ts`, `apps/web/lib/tak/agent-grants.ts`, `apps/web/lib/build/build-artifact-provenance.ts`, `apps/web/lib/work-management/workroom-boundary-claim.ts`, `apps/web/lib/workroom-runtime/effect-worker.server.ts`, `apps/web/lib/auth/workroom-session-token.ts` and `apps/web/lib/mcp-task-persisted-request.ts`. Portal database readers remain the authorities for retained domains. A missing identity, outcome, revocation or fence mapping holds the affected execution. It does not prevent same-schema recovery of unrelated business data.

### 2.7 Outbound-off portal rehearsal

There is no single outbound-off portal flag. Build the boundary first: use a fresh internal-only bridge with no usable host gateway, no published ports, no live mounts (including Docker sockets), no live secrets, and no ingress except a local readiness probe. Bind only the scratch database, separate job stores and portal. Do not run webhook callbacks, mutating routes, manual dispatch, or recurring/payment actions. Do not apply this profile to the live install. An arbitrary restored snapshot with active credentials or pending jobs needs a separate isolation and custody check before any boot.

| Control | Rehearsal setting and source check |
| --- | --- |
| DPF database and Prisma | Restore the `pg_dump -Fc` into a fresh PostgreSQL 16 + pgvector database. Verify the dump digest and every completed `_prisma_migrations` checksum against the selected portal source, with no rolled-back or unfinished entry. Pin a portal build compatible with that exact head. The normal `scripts/portal-migrate-boot.sh` runs `prisma migrate deploy`; require no pending migrations for this first boot. A deliberate upgrade is a separate exercise. |
| Inngest database and Redis | Use fresh isolated stores for this portal boot. Set the Inngest server's `INNGEST_POSTGRES_URI` to a separate scratch `inngest` database and `INNGEST_REDIS_URI` to empty scratch Redis; see `docker-compose.yml` service `inngest`. On the portal use `INNGEST_DEV=0`, scratch `INNGEST_BASE_URL` and fresh matching keys. Do not register the app or submit events. If examining a restored job pair, keep its consumer stopped until existing app registrations, pending and uncertain work, and queue/history recovery point have been reconciled. Never start a restored scheduler to prove that it does nothing. |
| Cron, event workers and boot recovery | Set `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED=0`. The registry in `apps/web/lib/queue/functions/index.ts` still exposes event functions through the Inngest route, so also set `DPF_INNGEST_SELF_SYNC_ON_BOOT_ENABLED=0` and keep the engine unregistered. Set `DPF_JOBS_ENGINE=inngest` with `DPF_JOBS_POSTGRES_FUNCTIONS` unset/empty to avoid the Postgres worker (`lib/jobs/routing.ts`). Set `DPF_MEASUREMENT_RUNTIME=1`, `DPF_OPTIONAL_STARTUP_TASKS_ENABLED=0`, `DPF_STARTUP_MODEL_REVALIDATION_ENABLED=0` and `DPF_LDAP_ENABLED=0`. `instrumentation.ts` suppresses ordinary maintenance and build recovery in measurement mode, but still runs boot syncs and some reconcilers. The migration wrapper also reconciles local catalog data and tries wiki embedding. Isolation is the guarantee, not the measurement flag. |
| SMTP and mailroom | Unset `SMTP_HOST` and `DPF_EMAIL_RELAY_HOST` and verify no scratch `PlatformConfig.smtp_host`: `lib/shared/smtp-config.ts` resolves DB first, then environment, then relay. Production `sendEmail` refuses an unconfigured transport. Check no active mailbox connection or credential and submit no mailbox events; `lib/mailroom/runtime.server.ts` resolves the mailbox from Postgres. `EMAIL_MOCK_MODE=1` affects only the Postmark marketing adapter, not the SMTP sender or other integrations. |
| Payment notices and collection | There is no global payment-notice environment flag. With cron off, keep the recurring invoice job unregistered, never invoke `generateDueInvoices` or `runDunning`, and keep invoice-send and payment-token routes unreachable from outside. `lib/actions/recurring.ts` follows the persisted `RecurringSchedule.autoSend` and can change invoice state even without SMTP. `lib/actions/dunning.ts` and the finance invoice-send route call the SMTP sender. The Stripe connection writes a Postgres `IntegrationCredential` (`lib/integrations/stripe/connect-action.ts`), so do not supply a provider key or route; the fixture has no connector credentials. Do not change the preserved schedule to make this test pass. |
| Integrations and inference | No shared OAuth, SMTP, MCP, provider or webhook keys and no live endpoints. Verify the scratch credential and mailbox inventory without printing secrets. Do not re-use the production encryption key: use ephemeral bootstrap secrets appropriate to the synthetic DB. `lib/integrations/kernel/credential-store.ts` reads encrypted DB fields, so merely unsetting env variables is insufficient on a real copy. Keep egress fenced even when no credentials are present. |
| Evidence and closeout | Read `GET /api/health` from inside the container and require HTTP 200 with database ready. Compare migration and outbound effect counters before and after, compare Inngest run counts and Redis queue-partition cardinalities, and report observation duration and limitations. Remove the four scratch containers, their anonymous volumes and the isolated bridge. A boot probe is not permission to replay queues or cut over a writer. |

#### 2.7.1 Synthetic result (2026-11-24, UTC-06:00)

Used BI-3357F36E's `dpf.dump`, SHA-256 `f5d09550a54e207f20dd9e6806dd4a8f6e3130762478291725b855e1ebf794dc`. Restored it with `pg_restore --no-owner --no-privileges --exit-on-error` to a disposable PostgreSQL 16 + pgvector container. Started the existing DPF portal image with source `a8a4d264c06a3c222d2784154cb67abb63622e2d` and local image ID `sha256:7075807da825bd3152a18c2e1bad513a46bd07c336f2d468aca9aff9598f0285`. No image was rebuilt or advanced. The Docker bridge was internal, IPv6 disabled and IPv4 gateway mode `isolated`. The portal had no mounts or published ports. No live install service or data was touched.

- All 666 applied migration names and checksums matched the source through `20261120180000_workroom_dispatch_build_effect`. The normal boot reported no pending migrations and the ledger was identical afterward.
- Inngest v1.36.0 initialized 14 tables in its separate empty database. Fresh Redis initially held zero keys. Inngest recorded zero function runs. Redis reported one matching queue-partition key after boot. Key cardinality was not measured, so this is not evidence of a drained queue.
- The portal returned HTTP 200 with both database and event-loop checks OK at 18:46:35 and 18:47:05. Logs confirmed measurement mode, optional startup, self-registration and model revalidation settings. The stock entrypoint reconciled local provider-catalog data. Wiki embedding and host transition reconciliation were degraded without their services/inputs. Neither was exercised as an outbound feature.
- Before/after counts matched: one recurring schedule (still `autoSend=true`), two invoices, one invoice document and zero payments, payment reminder logs, SMTP config keys, mailbox accounts, integration credentials/calls/callbacks, outbound publications or channel delivery attempts. No external effect was observed. The probe did not call a send/collection endpoint, test queue replay or receipt translation, or prove parity on a real tenant.
- An initial setup attempt ended before portal start because the new Inngest signing key had a prefix rather than the required raw hex form. The completed portal rehearsal used a new raw hexadecimal key and fresh stores. Scratch containers and the bridge were removed.

AC-3 is separate. This entry records the proposed contract and the synthetic exercise, not agreement from the DPF data owner.

---

## 3. Live DPF Execution Seams & Concrete Cutover Preconditions

DPF executes autonomous and background work across four primary runtime seams. Each seam MUST retire independently in reverse-risk order and ONLY after its explicit preconditions are verified.

### 3.1 `runBuildOrchestrator` (Build Specialist Dispatch)

- **Code seam:** `apps/web/lib/build/build-orchestrator.ts` (`runBuildOrchestrator` at line 1156, `runGauntletRepairTask` at line 1166, wrapped in `withOrchestrationRunning` from `build-liveness.ts`).
- **Call sites:** `apps/web/lib/build/build-on-plan-approval.ts:136`, `apps/web/lib/actions/agent-coworker.ts:1729`.
- **State touched:** `FeatureBuild` (`buildPlan`, `sandboxId`, `sandboxPort`), `TaskRun`, `TaskNode`/`TaskNodeEdge`, `BuildActivity`, `agentEventBus`, sandbox container (`SANDBOX_CONTAINER_ID` / `SANDBOX_PORT`).
- **Cutover preconditions:**
  1. Zero in-flight orchestrations (`TaskRun` where `source = 'build'` and `status NOT IN ('completed','failed','canceled','rejected','archived')` = `0`).
  2. All open `FeatureBuild` records in `building` / `implementing` phase either completed, promoted, or explicitly parked with recorded handoff notes.
  3. DPF2 proves end-to-end plan -> specialist dispatch -> verification -> PR delivery parity on a non-production repo/branch.
  4. Build admission disabled on DPF before disabling the seam so no new plan approval triggers `runBuildOrchestrator` during cutover.

### 3.2 `drive_workroom_runtime` (Supervised Workroom Runtime & Standing Drive)

- **Code seams:**
  - MCP tool handler: `apps/web/lib/workroom-runtime/runtime-tools.ts` (`driveWorkroomRuntimeTool` at line 61, `approveRuntimePermissionTool` at line 101, `reattachSupervisedSessionsOnBoot` at line 47), registered in `apps/web/lib/mcp/packs/work-capsules-pack.ts:378`.
  - Process-local supervisor singleton: `globalThis.__dpfWorkroomRuntime` (`apps/web/lib/workroom-runtime/supervisor.ts`), driving `codex` / `claude` adapters with scoped `workroom_session` tokens (`McpApiToken.kind = 'workroom_session'`).
  - Transactional outbox & standing cron: `WorkroomEffect` (`packages/db/prisma/schema/work-coordination.prisma:552`, `effect-worker.server.ts`) and 15-minute standing drive (`apps/web/lib/queue/functions/workroom-drive.ts`).
- **Cutover preconditions:**
  1. Zero active supervised sessions (`drive_workroom_runtime action=status` reports no live sessions across all non-terminal `Workroom` rows).
  2. Zero unsettled `WorkroomEffect` rows (`status IN ('pending', 'running')` = `0`).
  3. Zero non-revoked `McpApiToken` rows with `kind = 'workroom_session'`.
  4. All active `Workroom` claims reconciled (either terminalized or migrated to DPF2) AND DPF2 proves fail-closed worktree liveness parity (worktree janitor never reaps claimed worktrees when liveness is unreadable).
  5. Standing drive cron (`workroomDriveScheduled`) disabled via per-job kill switch before shutting down the DPF supervisor.

### 3.3 `autoExecuteBuild` (Checkpoint Build Pipeline & Boot Reconciler)

- **Code seams:**
  - Launcher: `apps/web/lib/actions/build.ts:700` (`autoExecuteBuild`), called from server actions (`:673`, `:856`, `:886`, `:1120`) and the portal boot reconciler (`apps/web/instrumentation.ts:531-660`).
  - Durable path: gated by `DPF_BUILD_DURABLE_EXECUTION_ENABLED` (`apps/web/lib/build/build-execute-helpers.ts:21`) -> sends `build/execute.run` with deterministic idempotency key `buildExecuteSendId(buildId, state)` to `apps/web/lib/queue/functions/build-execute.ts:36` (`concurrency: [{ key: "event.data.buildId", limit: 1 }]`, `retries: 3`, quiescence via `gateBetweenSteps`).
  - Legacy in-process path: runs `runBuildPipeline` (`apps/web/lib/build/build-pipeline.ts`) when `DPF_BUILD_DURABLE_EXECUTION_ENABLED` is off.
- **Cutover preconditions:**
  1. Zero `FeatureBuild` rows with non-terminal `buildExecState.step` (i.e. `step NOT IN ('complete', 'failed')` = `0`).
  2. Zero active `SandboxSlot` leases and zero active `NonProductionEnvironmentLease` rows.
  3. Zero pending/running `build/execute` runs in Inngest / Postgres jobs queue.
  4. DPF2 proves durable step-checkpoint crash recovery (mid-build process restart resumes without duplicate dispatch or orphaned sandbox slot) AND upgrade quiescence (`defer-not-skip`) parity.
  5. Boot reconciler (`instrumentation.ts` build re-dispatch) confirmed idle (zero resumable rows) prior to retirement.

### 3.4 Inngest & Redis Queues (Durable Job Engine & Cron Fleet)

- **Code & infrastructure seams:**
  - Job facade & engine router: `apps/web/lib/jobs/routing.ts` (`DPF_JOBS_ENGINE=inngest|postgres`, `DPF_JOBS_POSTGRES_FUNCTIONS=<comma-list>`), `apps/web/lib/jobs/inngest-adapter.ts`, Postgres job tables (`packages/db/prisma/schema/jobs.prisma`: `JobEvent`, `JobRun`, `JobStep`, `JobWait`, `JobConcurrencySlot`, `JobCronState`).
  - Function registry: `apps/web/lib/queue/functions/index.ts` — 92 `scheduledFunctions` (master-gated by `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED`, line 348) and 65 `eventFunctions`, including business-critical jobs (`finance/recurring-invoice-dispatch`, `mailroom-poll`, `marketing-scheduler-dispatch`, `postgres-daily-backup`, `workroom-drive`, `worktree-janitor`, `inngest-retention-sweep`).
  - Runtime containers: `inngest/inngest:v1.36.0` backed by `INNGEST_POSTGRES_URI=.../inngest` (separate `db=inngest`) and `INNGEST_REDIS_URI=redis://redis:6379` (`redis:7-alpine`, `docker-compose.yml:1061-1145`), bounded by `apps/web/lib/operate/inngest-retention/`.
- **Cutover preconditions (staged per workload domain — never big-bang):**
  1. **Quiescence & Kill-Switch Proof:** Verify `quiescenceRun` / `gateAtEntry` pauses all DPF crons cleanly (`apps/web/lib/queue/quiescence-gates.ts`) without dropping in-flight `gateBetweenSteps` work.
  2. **Per-Domain Shadow & Idempotency Parity:** Every business-facing cron (`finance/recurring-invoice-dispatch`, `mailroom-poll`, `marketing-scheduler-dispatch`, `obligation-assurance-watch`, `postgres-daily-backup`) must have an explicit DPF2 owner that has passed shadow dry-run parity and idempotent dedupe verification before its DPF counterpart is disabled.
  3. **Queue Drain Verification:** Before stopping `inngest` and `redis` on DPF:
     - `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED=0` active on DPF portal.
     - Active/running `function_runs` in `db=inngest` = `0` and Postgres `JobRun` with `status IN ('pending','running')` = `0`.
     - Redis `{queue}:queue:sorted:*` pending partitions drained to `0` (verified via retention/poison-queue check).
     - `inngest-retention-sweep` confirms zero stuck Redis-TTL orphans.
  4. **Final Backup & Cold-Standby Rollback Window:** Execute a final verified `scripts/backup-postgres.sh` + `scripts/postgres-trial-restore.sh` immediately after quiescence and before promoting DPF2 to primary. Retain DPF Postgres + backup archive in cold read-only standby until DPF2 completes **two** clean recurring business cycles with zero incidents.

---

## 4. Phased Cutover Sequence (Go / No-Go Summary)

| Phase | Target | DPF Posture | DPF2 Gate Required to Advance |
| --- | --- | --- | --- |
| **Phase 0 (Now)** | Record Export & Restore Rehearsal | 100% live primary for production tenant | Slices 1–3 exported read-only; restored to ephemeral DPF2 DB; all 5 rehearsal gates (§2.5) pass |
| **Phase 1** | Shadow Policy & Dry-Run Workflow Parity | 100% live primary (outbound active) | WWWD/WSID decisions + dry-run recurring invoice/document generation match DPF on restored snapshot; zero external side effects from DPF2 |
| **Phase 2** | Dev / Build / Workroom Seams (`runBuildOrchestrator`, `autoExecuteBuild`, `drive_workroom_runtime`) | Live for business ops; dev seams drained | DPF2 proves build checkpoint recovery, supervised workroom runtime, and fail-closed worktree liveness; DPF dev seams drained to zero in-flight runs |
| **Phase 3** | Business Queues & Production Primary Promotion | Quiesced -> cold read-only standby | Final verified DPF backup + trial restore; `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED=0`; Inngest + Redis queues drained to 0; DPF2 assumes primary and passes 2 consecutive recurring cycles before DPF teardown |

# Data model stewardship runbook

**Status:** procedure reference. The *rules* — schema audit before large features, `Organization` as canonical identity, use the shared primitives — live in [`AGENTS.md`](../../AGENTS.md) §11 and stay always-on. This file holds the primitive inventory, helper boundaries and audit indicators. Relocated by BI-0020D511 Phase 1; no rule was dropped.

Before adding any large feature, audit the existing schema for refactoring opportunities. Indicators that refactoring is needed: a domain model being reused as a shared concept; the same logical data appearing in two+ existing models; a new feature needing meta-data with no canonical home. → [kernel principle](../professions/data-architect/wiki/schema-audit-before-features.md)

`Organization` is the canonical platform identity model. Any feature needing org name, slug, logo, address, or contact info reads from `Organization` — not from `BrandingConfig`, env vars, or bespoke fields elsewhere. → [kernel principle](../professions/data-architect/wiki/organization-canonical-identity.md)

The `Organization.address` JSON has one canonical shape + helpers in [`apps/web/lib/shared/org-address.ts`](../../apps/web/lib/shared/org-address.ts) (`OrgAddress`, `parseOrgAddress` / `serializeOrgAddress` / `formatOrgAddressLines`, `resolveTimezoneFromAddress`). Read and write the address through those — do **not** hand-roll a parallel address field or shape. It is captured at setup via the business-context step (`/storefront/settings/business`) and is the precise source for state-accurate timezone derivation (BI-AAAA0691).

**Shared micro-primitives (BET-6, BI-6A505BFF).** Cross-cutting helpers that were hand-inlined at hundreds of sites now have one home each — import them, do **not** re-copy:
- Server-action result: [`apps/web/lib/shared/action-result.ts`](../../apps/web/lib/shared/action-result.ts) — `ActionResult<T>` (`{ ok: true; data: T } | { ok: false; error: string }`) with `ok(data?)` / `err(message)` constructors. The canonical shape for a server action's return.
- JSON coercion: [`apps/web/lib/shared/coerce.ts`](../../apps/web/lib/shared/coerce.ts) — `isRecord(v)` (object guard), `asString(v, fallback?)`, `asNumber(v, fallback?)` for narrowing `Prisma.JsonValue` / `unknown`. A CI ratchet (`scripts/check-no-local-isrecord.mjs`) freezes the count of legacy local `isRecord` copies; new code must import this one.
- Route paths: [`apps/web/lib/routes.ts`](../../apps/web/lib/routes.ts) — `ROUTES.*` named constants for the high-frequency section roots passed to `revalidatePath` / `redirect` / `<Link>`, so a rename is a single compiler-checked edit.

**Route-segment helpers vs shared domain modules (BI-IMP-BC5AA87E).** Page-local helpers under a route segment (e.g. `apps/web/app/(shell)/…/_helpers.ts` or a colocated `*.ts` next to `page.tsx`) may format, adapt, or present **canonical** domain data for that surface only. They must **not** invent a second home for reusable agent/delegation policy, tool metadata, grant maps, persisted outcome contracts, or identifiers that other routes need — those live in shared modules under `apps/web/lib/` (or packages). If a helper is imported from a second route or encodes policy that would change coworker behavior platform-wide, promote it to a shared canonical module in the same PR.

**Metadata governance (BI-IMP-FA900452, BI-IMP-52761525).** JSON metadata columns (e.g., unstructured payload fields) are reserved for optional, unstructured, or rapidly-evolving context. They must not be used as primary query or reporting sources. Any property that becomes frequently filtered, queried, or joined must be promoted to a typed schema field (via a database migration). When reading or writing JSON metadata in code, use typed accessor helpers and centralized key constants rather than raw string indexing. A provider publication/thread/conversation id is normalized through the owning domain's canonical identity or relationship mapping before a report joins on it; an incidental metadata key is never an implicit foreign key. → [kernel principle](../professions/data-architect/wiki/schema-audit-before-features.md) · [reporting boundary](../founder-kernel/wiki/principles/reporting-read-model-boundaries.md)

**Principal convergence (2026-05-09).** Per the addendum on `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`, any new identity-bearing entity introduced after 2026-05-09 must be modeled as a `PrincipalAlias` linked to a single `Principal`, not as a parallel identity table. The convergence target covers `User`, `CustomerContact`, `Agent`, `EdgeNode`, `MobileDevice`, and `ServiceAccount`. Authorization decisions resolve on the `Principal`; alias kind tells the platform which surface authenticated the request. → [kernel principle](../professions/data-architect/wiki/principal-convergence.md)

## Record lifecycle convention

**The ONE "not active" convention (BI-C357FA5A, Simplify & Strengthen W20, architecture pass 2026-08-16 §3.2-d).** The pass measured "not active" said six ways across the schema — `archivedAt`, `supersededById`, `mergedIntoId`, `quarantinedAt`/`overlapQuarantinedAt`/`conflictQuarantinedAt`, `retiredAt`, and `status="quarantined"` — so every reader had to know which convention applies per table. The unified convention is:

- **`lifecycle RecordLifecycle @default(active)`** — the enum (declared in [`packages/db/prisma/schema/resource-scheduling.prisma`](../../packages/db/prisma/schema/resource-scheduling.prisma)) closes the state set: `active | archived | retired | superseded | merged | quarantined`. A record is `active` or it carries exactly one not-active state.
- **`lifecycleAt DateTime?`** — when the record left `active`. NULL while active.
- **`lifecycleReason String?`** (optional) — free-text operator/system context, including `legacy-*:` markers minted by convention migrations.
- **Successor pointers** (supersede/merge chains) are **declared self-relations with a leading index** in the owning family — never bare `*Id` columns (the FK-index ratchet enforces the declared+indexed half).

Semantics per state: `archived` = kept for reference, excluded from operational reads; `retired` = permanently withdrawn from service; `superseded` = replaced by a successor record (pointer required); `merged` = collapsed into a survivor record (pointer required); `quarantined` = excluded pending integrity review (the record is suspect, not the data subject).

**Enforcement.** `scripts/check-no-new-notactive-conventions.mjs` blocks NEW legacy-convention columns schema-wide; the 29 existing carriers live in the shrink-only owned baseline `scripts/notactive-conventions-baseline.json` (owner platform-architecture). New `String` status columns carrying quarantine vocabulary are already blocked by `scripts/check-no-new-closed-set-strings.mjs`.

**Pilot family.** The W19 unified resource-scheduling models (`Resource`, `ResourceAvailability`, `ResourceCapacityPool`, `ResourceCapacityAllocation`) are born on the convention — zero-data adoption. Existing carriers migrate per the operator-reviewed plan: [`docs/superpowers/plans/2026-08-18-w20-lifecycle-convention-migration-plan.md`](../superpowers/plans/2026-08-18-w20-lifecycle-convention-migration-plan.md). Business-state machines (e.g. an allocation's `reserved→confirmed→released` flow) remain domain enums — the record lifecycle says whether the ROW is live, not where the BUSINESS process stands.

## Model metadata lives in the schema and the catalog

**One declaration, one carrier, many readers (BI-D9F158AF, EP-A33A5C61 slice 4, founder direction 2026-09-08).** Governance metadata for a model is declared ONCE as a `/// @dpf` documentation line directly above the `model` block and converged into the Postgres catalog as `COMMENT ON TABLE "X" IS 'dpf:{...}'` at every portal boot ([`packages/db/scripts/apply-model-metadata-comments.ts`](../../packages/db/scripts/apply-model-metadata-comments.ts), called from `scripts/portal-migrate-boot.sh` right after `prisma migrate deploy`). The parser, vocabularies and carrier format are in [`packages/db/src/model-metadata.ts`](../../packages/db/src/model-metadata.ts).

```prisma
/// @dpf lifecycle=telemetry-bounded retention=365d sensitivity=internal categories=telemetry,security-audit owner=platform-architecture steward=data-steward timeAxis=createdAt
model ToolExecution { ... }
```

- **Keys (closed set).** `lifecycle` (operational · telemetry-bounded · business-record · regulated-record · security-audit · legal-evidence · ephemeral) and `retention` are required. `retention` is exactly one disposition: `<N>d` (auto-purge past N days on `timeAxis`), `retained` (statutory minimum, needs `basis=`), `domain` (rows follow their own lifecycle), `reference`, `config`, or `projection` (derived copy, reconciled not aged). Optional: `sensitivity`, `categories`, `scope` (pci-cardholder / phi-health), `owner`, `steward`.
- **The gate.** `scripts/check-model-metadata-tags.mjs` (source policy guards) fails the build on an invalid tag, a purge window on a non-purgeable class, or a NEW persistent model with no tag. Models that predate the convention sit in `scripts/model-metadata-baseline.txt`, which can only shrink — tag a model and run `--update`.
- **Reading it.** `SELECT relname, obj_description(oid, 'pg_class') FROM pg_class` answers lifecycle and sensitivity for every table; external catalog tools ingest the same comment. In code, `parseCatalogComment` turns the string back into the typed declaration.
- **What it replaced.** The tags were seeded once from `table-classification.ts`, the govern/data asset registry, the hand-typed lists in `operate/retention/policies.ts` and `scripts/stewardship-exemptions.txt`. The retention sweep now builds its policies from the catalog (`apps/web/lib/operate/retention/declarations.ts`); the hand lists, the name-suffix enrollment guard with its allowlist, and the exemptions file are gone. What remains in code is behaviour a table tag cannot express: partitions, extra predicates and cascade handlers in `RETENTION_OVERRIDES`, each of which must name a model the schema declares purgeable. Sensitivity is answered from the tag first (`getTableSensitivity` in `table-classification.ts`, whose registry now holds only untagged models and shrinks as tags land), and the ERD mirror projects the declaration as `governance.declared` on every tagged model element. What still lives beside the schema is the field-level asset registry, which the coverage gate depends on.
- **Adding a model?** Write the tag before the migration. A model whose disposition you cannot name is a design question, not a default.

## The steward watches growth, not only structure

**Nightly growth pass (BI-592F1E7E, EP-A33A5C61 slice 5).** After the structural drift detectors, the Data Architect steward samples every table from `pg_class` / `pg_stat_user_tables` into `TableGrowthSample` (heap, index, TOAST, live and dead tuples, rows in the last 24 h on the model's declared `timeAxis`) and runs two detectors ([`apps/web/lib/ea/table-growth.ts`](../../apps/web/lib/ea/table-growth.ts)):

- **`growth-without-disposition`** (error) — a table adding ≥ 1,000 rows/day or ≥ 5 MB/day whose declaration is missing, or whose disposition (`reference`, `config`, `domain`, `projection`) never removes rows. Carries bytes/day and a 12-month projection.
- **`payload-anatomy`** (warn) — TOAST is ≥ 50% of a relation of ≥ 50 MB: a JSON/text column is carrying blobs that belong in the content-addressed store.

Findings reconcile into `EaConformanceIssue` beside the structural ones (visible on `/ea/data-model`). A finding that stays open for three consecutive nightly samples is filed once as a fingerprinted backlog item with source `data-growth` (`captureCorrectiveFailureBI`), owned by AGT-BUILD-DA, and re-observed nightly until it clears. The sample table is itself tagged `telemetry-bounded retention=90d`, so the steward's telemetry is governed by the mechanism it enforces.

## Retention floors come from the obligations that bind this install

**Derived, not hardcoded (BI-69C29492, EP-A33A5C61 slice 6).** A retention window may only ever LENGTHEN: `effective = max(base, industry floor, obligation floor, processing-activity floor)`. The obligation floor is the one derived from the compliance plane:

1. `Obligation.retentionMinimumDays` and `Obligation.retentionFloorBuckets` carry the duration a regulator states. Before this, durations existed only as prose in `description` ("wage records ... for at least three years") and no engine could read them.
2. `apps/web/lib/operate/retention/obligation-floors.ts` reads the minimums of the obligations whose regulation **applies to this install**, using the existing classifier (`compliance-library.ts`), which already scopes by archetype **and** jurisdiction. There is one answer to "what binds us", not two.
3. The sweep max()es that against the base window. Each floor carries its citation, so a sweep can name the regulator behind a lengthened window.

- **Failure is always the safe direction.** An unreadable compliance plane, an unresolvable applicability, a null or zero minimum, an unknown bucket: each leaves the base window in place or considers more obligations, never fewer. A sweep never aborts because compliance is unreadable.
- **An obligation that names no bucket binds every bucket.** A records rule that does not distinguish audit trails from chat is making a claim about all of them; reading it narrowly would understate a regulator.
- **The legacy table is still in the max().** `INDUSTRY_RETENTION_FLOORS` (four hardcoded industry rows) stays until parity is proven. `obligation-floors.test.ts` is that proof: it fails if any hardcoded row lacks an obligation at least as long. When it passes with no gaps the table can be deleted without any install's window shortening — deleting it first would be the one thing floors must never do.
- **Adding a floor?** State it as an obligation on the regulation that already binds the archetype (`packages/db/src/seed-retention-floor-obligations.ts`); the seed invents no regulation and reports a floor it could not attach rather than pretending a regulator said something. The window then shows on `/compliance/obligations/<id>`.

## Evidence payloads never live inline

**The ceiling (BI-39AAE9B8, EP-A33A5C61 slice 2).** A ledger row records *that* something happened and what it carried, by digest. Any string leaf above `EVIDENCE_INLINE_CEILING_BYTES` (64 KB, [`apps/web/lib/evidence/bounded-output.ts`](../../apps/web/lib/evidence/bounded-output.ts)) leaves the JSON column:

- **Evidence writers** (`recordLocalIntegrationResult` and anything else that persists a console log or report body) call `offloadEvidenceOutput`: the bytes are written once to the content-addressed blob store (`lib/documents/blob-storage.ts`, tracked by a `DocumentBlob` row keyed on sha256) and the record keeps a head+tail excerpt — still a string, so readers that want the failing tail keep working — plus `outputBlob: {sha256, storageKey, sizeBytes}`.
- **The tool-execution ledger** (`lib/governed-tool-audit.ts`) applies `boundLargeStrings` to every parameter tree: an oversized leaf becomes `{__dpfBounded, sha256, byteLength, head}`. Two ledgers carrying the same log converge on one file and one row.
- **Why it matters.** Before the ceiling, one 16-day-old install held ~560 MB (32% of the database) of local-CI console text twice, inside `ExternalEvidenceRecord.details` and `ToolExecution.parameters`, growing ~6.5 GB/year per copy. Backfill for rows written before the ceiling: `apps/web/scripts/offload-evidence-output.ts` (dry-run by default, `--apply` to rewrite).
- **Adding a new evidence-bearing writer?** Route the body through `offloadEvidenceOutput` (or `boundLargeStrings` if the row is a pure ledger) before the insert. A JSON column is a place for structure and references, never for a log.

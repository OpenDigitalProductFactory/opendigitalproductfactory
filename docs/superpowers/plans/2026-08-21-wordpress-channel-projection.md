---
status: active
---

# WordPress channel projection implementation plan

> **For implementation agents:** Deliver the child BIs through the three dependency-coherent batches below: foundation, backend, and UX/docs. Do not implement the x-large umbrella `BI-F50B1E46` as an undifferentiated build. Revalidate the coverage receipt and re-run substrate/overlap checks before each batch. Use `dpf-tdd` for code changes, `dpf-data-architecture-steward` for the schema slice, `dpf-ux-fit-review` for UI, and the normal DPF finishing/PR path.

**Goal:** Let an internal DPF installation govern business content and publish approved posts, pages, media, and structured business projections to a customer-owned WordPress site without bundling a public CMS, hosting plane, CDN, or required inbound DPF URL.

**Architecture:** DPF owns typed business sources, draft/approval/schedule, projection identity, authority, audit, and operational follow-through. A `wordpress-self-hosted` connector owns per-site REST discovery, credentialed health, and bounded incremental reads. A WordPress outbound adapter creates or updates remote drafts/media and records publication receipts. WordPress owns public presentation, themes, layouts, permalink/SEO realization, hosting, CDN, and plugin behavior. One generic `ExternalChannelProjection` gives a stable source-to-remote identity and drift contract for WordPress and later channels.

**Design:** `docs/superpowers/specs/2026-08-21-wordpress-channel-projection-design.md`

**Epic:** `EP-31C5A6C8`

**Umbrella:** `BI-F50B1E46`

**Workroom:** `WC-53A7FA07`

**Kernel decision:** `DI-BC2255C06EC5` — `dpf-canonical-channel-projection` (5.108; high confidence; 1.706 margin; no commandment conflict)

## Delivery graph

| Order | Deliverable | Backlog item | Depends on | Indicative size |
| ---: | --- | --- | --- | --- |
| 1 | Deterministic multi-category absorption identity | `BI-AE8A5B76` | — | medium |
| 2 | Generic external-channel projection identity and drift contract | `BI-93507D83` | — | large |
| 3 | Secure read-only WordPress self-hosted connector | `BI-46AE0EBC` | `BI-AE8A5B76` | large |
| 4 | Approved/idempotent WordPress posts, pages, and media publication | `BI-D2AA1064` | `BI-93507D83`, `BI-46AE0EBC` | large |
| 5 | Structured DPF business-content projection and drift reconciliation | `BI-744F8083` | `BI-93507D83`, `BI-D2AA1064` | large |
| 6 | Connection, health, preview, publication, and drift UX | `BI-8D98C5E6` | `BI-46AE0EBC`, `BI-D2AA1064`, `BI-744F8083` | large |
| 7 | Architecture/claims/runbook/adoption evidence | `BI-28185C18` | evidence from 1–6; documentation skeleton may begin earlier | medium |

Parallelism is deliberately limited. Deliverables 1 and 2 may run in parallel. Deliverable 3 can start once the identity behavior in 1 is stable. Deliverables 4–6 are ordered because external writes cannot precede credential/network safety and the UX cannot promise states the source models do not yet own.

### Executed delivery batches

| Batch | Child BIs | Branch / PR | Status |
| --- | --- | --- | --- |
| Foundation | `BI-AE8A5B76`, `BI-93507D83` | `feat/external-channel-foundation` / #4442 | Published; refreshed exact-tree CI green |
| Backend | `BI-46AE0EBC`, `BI-D2AA1064`, `BI-744F8083` | `feat/wordpress-channel-backend` / #4450 | Published as ready stacked PR; exact-tree CI green |
| UX and adoption evidence | `BI-8D98C5E6`, `BI-28185C18` | `feat/deliver-wordpress-operator-ux-and-adoption-evide` | Implementing and verifying |

Across the graph, reserve approximately 20% of implementation capacity for the refactoring named in each phase. The allocation pays for canonical boundaries, duplicate removal, shared adapters/presentation, and invariant tests; it is not a generic cleanup allowance.

## Phase 1 — deterministic multi-category absorption identity (`BI-AE8A5B76`)

### Purpose

Make the existing absorption/coverage architecture capable of representing WordPress honestly before adding any WordPress posture row. This phase is independently valuable for every provider spanning more than one integration category.

### Likely files

- `packages/db/src/portfolio-sources/incumbent-coverage.ts`
- `packages/db/src/portfolio-sources/incumbent-coverage.test.ts`
- `packages/db/src/portfolio-sources/absorption-posture.ts`
- `packages/db/src/portfolio-sources/absorption-posture.test.ts`
- `packages/db/src/portfolio-sources/vertical-incumbents-manifest.ts`
- relevant identity/category parity tests and seed sources discovered at pickup

### Tasks

1. Re-run source graph, live backlog, open-PR, and recent-commit overlap sweeps.
2. Write failing tests proving provider-only `findFirst` is ambiguous when two postures share a provider name.
3. Define one typed `resolveAbsorptionPosture` contract accepting normalized catalog identity, normalized provider key/name, and optional explicit integration category/capability.
4. Apply resolution order: catalog identity; provider+category; provider-only when exactly one row; otherwise an evidenced ambiguous/gap proposal.
5. Reuse the resolver in both posture-matrix and deterministic rule stages. Preserve the rule that a confirmed human assessment is never clobbered.
6. Only after the invariant is green, add WordPress posture fixtures split by capability/category; do not compress CMS, commerce, forms, and plugin runtime into one verdict.
7. Refactor budget: remove duplicate provider normalization/slug/matching branches and strengthen the parity guard.

### Verification gate

- Targeted tests cover normalized identity, explicit category, unique provider fallback, multi-row ambiguity, case variation, missing posture, idempotency, and confirmed-assessment preservation.
- Seed/parity checks remain green.
- No Prisma migration is expected unless pickup evidence proves identity persistence is insufficient; a proposed migration triggers the data-steward workflow before proceeding.

## Phase 2 — generic projection identity and drift contract (`BI-93507D83`)

### Purpose

Create the smallest missing canonical substrate: a stable current binding between one DPF source/version and one external resource, distinct from publication events and import batches.

### Likely files

- `packages/db/prisma/schema/integrations.prisma`
- new expand-first migration under `packages/db/prisma/migrations/`
- integration projection store/service under `apps/web/lib/integrations/`
- `packages/db/src/table-classification.ts`
- `apps/web/lib/govern/data/assets.ts` and data-governance mirrors
- Prisma-derived ERD/EA artifacts located by `dpf-data-architecture-steward`
- new `docs/data-impact/<date>-external-channel-projection.data-impact.json`

### Tasks

1. Re-audit `OutboundPublication`, `IntegrationImportStagedRecord`, communication bindings, authority bindings, and any source/external identity models added since this plan.
2. Write failing contract tests for both uniqueness dimensions:
   - `(connectorKey, connectionId, sourceType, sourceId, resourceKind, locale)`;
   - `(connectorKey, connectionId, resourceKind, externalId)` when the remote ID is known.
3. Add `ExternalChannelProjection` expand-first with stable semantic ID, stable `IntegrationCredential.integrationId` connection identity, optional credential-row audit pointer, source/version, nullable remote identity/URL while reserved or ambiguous, local/remote fingerprints, remote timestamps, state, observation/projection times, and bounded metadata.
4. Implement pure normalization/fingerprinting plus bind, observe, drift, detach/retire, and lookup service operations.
5. Make state and resource kinds typed closed sets with exact source/DB/MCP parity; provider-declared custom types remain provider metadata until deliberately supported.
6. Define operation ordering with `OutboundPublication`: durable projection reservation -> remote call -> binding reconciliation -> receipt/audit persistence. A timeout/process/local-write loss after request transmission moves the reservation to `ambiguous`, stops automatic retry, and requires candidate reconciliation because WordPress core has no universal create idempotency key.
7. Complete migration apply/rollback reasoning, FK/index coverage, retention/classification, data-impact, ERD, architecture parity, and representative existing-data verification.
8. Refactor budget: converge repeated external-ID/fingerprint/authority concepts and add invariant guards; do not create WordPress fields in the generic table.

### Verification gate

- Red/green service and database constraint tests.
- Prisma generation, migration apply on representative data, FK/index checks, data-impact gate, architecture parity.
- Concurrent duplicate bind attempts resolve deterministically; credential rotation does not fork a target connection; ambiguous reservations cannot auto-retry.
- Metadata redaction/size tests prove secrets and full provider payloads cannot persist.

## Phase 3 — secure read-only WordPress connector (`BI-46AE0EBC`)

### Purpose

Connect and observe a self-hosted WordPress site safely using outbound HTTPS only. This phase performs no WordPress mutations.

### Likely files

- `apps/web/lib/integrations/kernel/definition.ts` only if a genuinely generic contract change is required
- `apps/web/lib/integrations/connectors/index.ts`
- new `apps/web/lib/integrations/connectors/wordpress-self-hosted.ts` and tests
- connector runtime/auth/health/checkpoint modules found during pickup
- `apps/web/lib/integrations/import-review-store.ts`
- `packages/db/prisma/schema/integrations.prisma` only for a proven generic checkpoint/connection gap

### Tasks

1. Register `wordpress-self-hosted` with capabilities for discover/read/observe and callback `none`.
2. Declare kernel authority defaults for `wordpress.managed-content=platform`, `wordpress.presentation=source`, `wordpress.discovery=source`, and `wordpress.taxonomy-slug=shared`. Keep these separate from user action grants and the connection’s audited draft-versus-live ceiling.
3. Reuse the existing `api-key` strategy behind a typed credential adapter: `siteUrl`, `username`, `applicationPassword`. Keep the UI language WordPress-specific; do not add an auth enum merely for display wording.
4. Build a common outbound URL safety utility or extend the existing one after exhaustive search. Enforce HTTPS, canonical origin, DNS/IP policy, re-resolution, bounded same-origin redirects, no cross-origin authorization forwarding, time/byte/page limits, and safe proxy behavior.
5. Probe `/wp-json` plus supported type/taxonomy/media/post/page schemas and authenticated capabilities. Record only bounded, sanitized evidence.
6. Implement paginated ascending reads with compound `(modified_gmt, id)` checkpoint, overlap window, and fingerprint dedupe. Persist a checkpoint only after staged records are durable.
7. Stage discovered posts/pages/media/types/taxonomies as read-only import candidates. Do not create/overwrite Documents, Products, CatalogItems, or operational records.
8. Classify 401/403, REST unavailable/404, 429, 5xx, timeout/TLS/DNS, pagination truncation, and unsupported plugins separately.
9. Implement disconnect/disable behavior for future scheduled sync and a revocation instruction contract.
10. Refactor budget: converge connector safe errors, credential parsing, URL validation, and checkpoint helpers; no WordPress-only parallel kernel.

### Verification gate

- Mock HTTP tests for valid connection and every trust-boundary failure, including redirect-to-private IP, DNS change, compression/oversize, origin change, and authorization redaction.
- Same-timestamp multi-page and interrupted-resume tests prove no loss/duplication.
- Connector definition/schema/registry tests and integration-import staging tests pass.
- A local disposable WordPress fixture may be used for functional evidence, but the implementation cannot make WordPress a DPF runtime dependency.

## Phase 4 — approved/idempotent post, page, and media publication (`BI-D2AA1064`)

### Purpose

Deliver the first end-to-end customer outcome: an approved DPF draft becomes one WordPress draft (by default), with stable external identity, URL, and auditable receipt.

### Likely files

- `apps/web/lib/marketing/channels/contracts.ts`
- `apps/web/lib/marketing/channels/` provider registry and new WordPress adapter
- `apps/web/lib/marketing/execution.ts`
- `apps/web/lib/queue/functions/marketing-scheduler-dispatch.ts`
- `packages/db/prisma/schema/marketing.prisma` only if a provider-neutral receipt gap remains after using the binding
- projection service from phase 2
- tool/authority/audit handlers located during pickup

### Tasks

1. Write failing tests proving an unapproved draft cannot invoke the adapter and a replay cannot create a second remote item.
2. Extend the generic channel capability vocabulary only as needed for page/media/upsert semantics, with closed-set and adapter-registry parity.
3. Build preview validation for target site, resource type, title/body/excerpt/status/slug/taxonomies/media, unsupported fields, and current drift state.
4. Upload media through fingerprinted projection binding; preserve attachment ID and alt/caption. Enforce MIME/size policy.
5. Upsert post/page using the binding. With no binding, persist a reservation first, create the WordPress draft, fill the remote identity, then record `OutboundPublication`/tool/audit evidence.
6. Separate “create/update remote draft” from “make public.” Direct `future`/`publish` requires explicit connection policy, user authority, approved snapshot, and consequence confirmation.
7. Implement the media-success/post-failure saga. For an ambiguous create outcome, quarantine and reconcile by bounded candidate evidence or operator selection before any retry; do not claim provider-level exactly-once behavior WordPress does not supply.
8. Exclude delete/unpublish. Return unsupported capability, not a partial-success claim, for custom types/fields the adapter cannot preserve.
9. Refactor budget: build one provider-neutral publication coordinator around existing adapter/credential/approval/audit substrate; retire duplicated provider-route workflow logic encountered in scope.

### Verification gate

- Approval, schedule, authority, preview, idempotency, concurrent replay, media saga, safe error, and receipt tests.
- Functional fixture proves draft creation, update of the same post, future/publish policy, media reuse, external URL, known-outcome replay idempotency, and that a forced ambiguous outcome is blocked from blind retry until reconciliation.
- Logs/receipts contain no credential or full content payload.

## Phase 5 — structured business-content projection and drift (`BI-744F8083`)

### Purpose

Project selected DPF domain facts without inventing a generic canonical CMS and make remote edits visible before overwrite.

### Likely files

- product/catalog/storefront projection/view-model modules discovered at pickup
- `apps/web/lib/marketing/channels/` projection serializers
- `apps/web/lib/media/media-storage.ts`
- managed document/knowledge read adapters
- projection binding/service from phase 2

### Tasks

1. Define eligible sources and immutable/versioned source reads: approved `OutboundDraft`, `DocumentVersion`, `KnowledgeArticleRevision`, Product/Offering/CatalogItem plus channel/storefront projection.
2. Build pure provider-neutral projection documents and WordPress serializers. The serialized approved snapshot—not a later live source query—is what execution publishes.
3. Map terms by stable WordPress ID after explicit resolution. Require operator selection for name collisions; create terms only with explicit capability/policy.
4. Define slug authority and media fingerprint behavior exactly as the design authority matrix states.
5. Observe remote normalized payload/fingerprint and set `drifted` when it differs after last projection. Pause automatic upsert.
6. Provide governed dispositions: re-project after diff/confirmation, detach and keep WordPress, or leave unresolved. Never import remote changes into operational facts automatically.
7. Keep comments, forms, WooCommerce, memberships, SEO plugins, custom post types/fields, and block-layout ownership outside slice one. Discovery may report them as unsupported evidence.
8. Refactor budget: converge source-version adapters, normalization, rendering, and authority checks across Marketing/Storefront/Knowledge seams.

### Verification gate

- Golden serialization tests for every supported source/resource pair.
- Authority tests prove WordPress cannot overwrite Product/Catalog/Storefront operational truth.
- Drift tests cover remote title/body/slug/term/media/status changes, stale reads, detached projections, and authorized re-projection.
- Locale/resource identity and fingerprint stability tests pass.

## Phase 6 — operator UX (`BI-8D98C5E6`)

### Purpose

Make connection and publication understandable to a non-technical operator without adding another navigation system or dashboard.

### Canonical surface

- Provider home: `/platform/tools/integrations/wordpress`
- Catalog entry: existing `/platform/tools/integrations`
- Secondary entry points: contextual “Publish to website” action in eligible Marketing/Storefront surfaces only
- Routes explicitly not created/promoted: `/wordpress`, `/cms`, a global Website area, a duplicate publication dashboard

### Likely files

- `apps/web/app/(shell)/platform/tools/integrations/page.tsx` and tests
- new `apps/web/app/(shell)/platform/tools/integrations/wordpress/page.tsx` and tests
- `apps/web/components/integrations/` shared connection components plus WordPress composition
- eligible Marketing/Storefront components/routes found during pickup
- `apps/web/components/ui/form/`, `apps/web/components/ui/report-kit/` reused, not forked
- `docs/ux-fit/<date>-wordpress-channel-projection.ux-fit.json`

### Tasks

1. Re-run the UX-fit component/route/source-truth sweep and inspect live Integrations/Marketing/Storefront behavior before changing IA.
2. Extract a shared connection state/presentation primitive from repeated provider panels where evidence supports convergence. Keep provider-specific fields/capability copy in composition.
3. Build the three-field connection form using shared form primitives, pending/success/failure states, secret replacement semantics, and “Check connection” first.
4. After probe, show site identity, supported actions, unsupported/plugin capabilities, and plain-language authority. Default policy is “Create WordPress drafts”; public publication requires consequence disclosure and confirmation.
5. First viewport: hostname/status/last check, short capability list, authority sentence, exactly one primary next action. Put namespaces/types/cursors/audits behind disclosure/table.
6. Add contextual preview for target, resource, title/body/excerpt/media/taxonomy/slug/status, drift warning, and consequence. Cards/status clicks navigate; none send an AI prompt.
7. Implement fresh install, permission, REST unavailable, invalid credential, rate limit, drift, queued action, disconnected, and unsupported states with one honest recovery action each.
8. Refactor budget: converge provider connection panels and status intent mapping; no hardcoded colors, hand-rolled form/status/table, or new visual dialect.

### Verification gate

- Route/component/action tests for every state and permission boundary.
- Measured `sweep-measurement` UX-fit manifest whose scope exactly matches UI files.
- Route budget, prose/style/token/theme, accessibility, ARIA structure, and no-hardcoded-color checks.
- Browser tasks at desktop and narrow widths: connect, failed connect/recovery, create draft preview/confirm, publication receipt, drift review, disconnect.
- No overlap, horizontal scroll, buried primary action, credential redisplay, dead CTA, or wall of zero metrics.

## Phase 7 — architecture, claims, runbook, and adoption evidence (`BI-28185C18`)

### Purpose

Make the supported boundary operable and prevent product claims from outrunning delivered evidence.

### Tasks

1. Update the user/admin guide with when to use native Storefront versus WordPress projection, connection, Application Password creation/revocation, authority, preview/publish, drift, and disconnect.
2. Publish a capability matrix separating core-supported, discovered-read-only, plugin-required future, and unsupported behaviors.
3. Add an operations runbook for 401/403/404/429/5xx/TLS/DNS/REST-disabled, checkpoint lag, media/post partial failure, drift, queued schedules, and remote-success/local-persistence recovery.
4. Update architecture orientation/history, connector documentation, SysML/EA interface/allocation/verification views, data model/ERD, and parity artifacts alongside the owning code changes.
5. Instrument connection success, probe/publication latency and result classes, duplicate prevention, drift, checkpoint age, and recovery time without content or secret labels.
6. Encode allowed/prohibited product claims from the design and remove/avoid duplicate connector/publication guidance.
7. Exercise one representative self-hosted WordPress install end to end and record receipts for connect, remote draft, update, media, drift, recovery, and disconnect.
8. Decide whether a thin signed-callback/custom-field WordPress plugin merits a new BI using adoption evidence. Do not file/build it merely to claim completeness.
9. Refactor budget: consolidate duplicate connector/publication docs and keep one supported-capability source.

### Verification gate

- Doc index/links/diagrams/impact and architecture parity pass.
- Runbook recovery steps are exercised, not only reviewed.
- Telemetry queries reconcile with publication/binding/audit source rows.
- Claim review finds no hosting, full CMS, universal plugin, or two-way-sync overclaim.

## Cross-cutting verification contract

Every child implementation must:

1. read the root `AGENTS.md`, create/claim a Workroom, and use one dedicated worktree from current `origin/main`;
2. query live backlog/specs/code graph/open PRs/recent commits before adding a model, enum, route, provider, tool, or scheduler;
3. write failing behavior/contract tests before code changes and never claim an unrun test passed;
4. consume the Workroom change-impact contract and run its tests/guards;
5. keep fixed states in typed closed registries with source/database/MCP/UI parity;
6. treat credentials, site URL, provider content, redirects, and provider errors as hostile input;
7. preserve approval, authority, idempotency, audit, and safe-error behavior on every external write;
8. run targeted tests and all change-sensitive repository guards, then exact-tree local CI before publication as required by AGENTS;
9. use the governed shared nonproduction environment for browser verification and record persona, route, viewport, fixture, and failure-mode evidence;
10. update data-impact/ERD/EA, user guide, runbook, and capability claims in the same slice that changes the contract;
11. record the slice’s approximate 20% refactoring allocation and the duplication/invariant it retired;
12. obtain independent semantic review of the stable committed tree before pregate/publication and open a ready, DCO-signed PR through the DPF PR workflow.

## SysML/EA implementation note

The authoritative requirement set is design §6 (`R1`–`R14`). Implementations allocate:

- `IWordPressRest` to the customer-owned WordPress site and the self-hosted connector;
- `IConnectorExecution` to the unified connector kernel and WordPress adapter;
- `IOutboundChannel` to outbound execution and the WordPress channel adapter;
- `IProjectionAuthority` to owning DPF domains, the generic projection service, and conflict UI;
- `IIntegrationOperationsView` to connector/projection read models and the existing Integrations route family.

Verification cases `VC-WP-01` through `VC-WP-10` are plan gates. Each child links the cases it satisfies to tests/runtime receipts and updates the EA current-state mirror in the same PR. Public hosting/theme/SEO/CDN/plugin runtime stays allocated to the external WordPress deployment.

## UX fit guardrails

- Decision: `fits-with-guardrails`.
- One canonical provider page under Platform Integrations; contextual publish actions are secondary shortcuts.
- No global navigation, WordPress dashboard, metric tiles, or new status/form/table primitives.
- Source truth: connector health/checkpoint/audit, projection binding/drift, outbound approval/publication, and the owning domain source.
- Fresh/unavailable/permission/drift states show one truthful next action; hidden diagnostics use progressive disclosure.
- No setup/status click starts AI work. Draft assistance remains in existing AI drafting workflow; external publish always previews and confirms.
- UI implementation must commit a measured UX-fit manifest and functional browser evidence, not screenshots alone.

**Captured in:** `/platform/tools/integrations/wordpress`, the existing integrations catalog, and the existing Customer Marketing approval/publish queue. The implementation reuses shared form and report-kit primitives and extracts one provider-neutral external publication confirmation control shared with LinkedIn. The measured manifest is `docs/ux-fit/2026-08-22-wordpress-channel.ux-fit.json`; its final values are recorded only from the governed served preview.

## Plan-to-backlog coverage

This plan is deliberately decomposed. Every independently shippable deliverable maps to the live, build-triaged child BI in the delivery graph. The governed coverage receipt is recorded against the immutable repository plan artifact and must be revalidated before implementation:

- **Coverage receipt:** pending immutable plan commit and governed recorder call
- **Validation:** pending

## Completion criteria

The epic may close only when:

- all seven child BIs are done with proportional test/runtime/review evidence;
- a founder/operator can connect a supported HTTPS self-hosted WordPress site using a dedicated Application Password without exposing DPF publicly;
- an approved source creates one remote draft, updates the same remote item on replay/change, publishes publicly only under explicit policy, and produces external URL/audit receipts;
- media/post partial failure resumes safely; an ambiguous create outcome cannot auto-retry and is reconciled before another create, so the system never knowingly manufactures a duplicate;
- equal-timestamp pagination and interrupted read sync lose no records;
- a remote edit becomes visible drift and cannot silently overwrite DPF facts or be silently overwritten;
- connection/disconnect, permission, REST-disabled, credential, rate/network, unsupported-plugin, and drift states are usable on desktop and narrow viewports;
- SSRF/DNS-rebinding/redirect/credential-forwarding, sanitization, size/rate, least-privilege, approval, and idempotency controls are verified;
- the data model, ERD, EA/SysML view, user guide, runbook, capability matrix, and claims match the live implementation;
- no bundled WordPress runtime, public hosting plane, CDN, required inbound callback, general-purpose CMS model, or universal plugin claim has entered DPF;
- the adoption/quality evidence supports a deliberate decision on whether a later thin WordPress plugin deserves separate work.

# Sovereign SOC — P0 normalization spine: implementation plan

- **Date:** 2026-06-24
- **Spec:** [docs/superpowers/specs/2026-06-24-sovereign-soc-siem-design.md](2026-06-24-sovereign-soc-siem-design.md)
- **Epic:** EP-SOVEREIGN-SOC
- **BIs:** BI-81FEC0AC (P0 keystone), BI-015F8995 (P0.5 invariants), BI-79B599BF (EA extractor)
- **Status:** P0 + the retention slice of P0.5 implemented directly (founder directed direct build, not Build Studio). Verified locally: db/validators/web typecheck clean; validators 5/5, security lib 16/16, retention guard 17/17, edge-events route 31/31.

## Goal

Land the `SecurityEvent` normalization spine — the keystone every later SOC plane (detection, AI SOC, response, console, compliance) sits on. Adopt OCSF as the schema authority (kernel decision §8: `version-pinned-ocsf`), keep the sovereignty boundary at the normalized event (raw stays on the edge), and prove the platform can monitor itself on day one.

## What shipped in this pass

### Data model (BI-81FEC0AC)
- `SecurityEvent` Prisma model — `packages/db/prisma/schema.prisma`. OCSF-aligned (classUid/categoryUid/activityId, severityId, time), `ocsfVersion` pinned per row, denormalized first-class scope (`scopeKey`/`customerAccountId`/`customerSiteId`/`edgeNodeId`), `rawRef` pointer (never the raw blob), `actorPrincipalId` (AGENTS.md §11). **No FK to EdgeNode** — security records outlive node deletion; internal sources have no node.
- Migration `packages/db/prisma/migrations/20260624120000_add_security_event/migration.sql` — hand-authored to Prisma conventions (field order, index names), incl. the ingest-time `createdAt` index the retention sweep needs.

### Ingestion path (BI-81FEC0AC)
- `securityEventWireSchema` + envelope union — `packages/validators/src/edge.ts`. Adds `eventType:"security"` to the existing `EdgeEventEnvelope` (the alert/change discriminator precedent); a security record fails the edge enum and routes unambiguously to the security branch. No new route.
- Route dispatch + `ingestSecurityEvent` — `apps/web/app/api/v1/edge/events/route.ts`. Upsert on `eventKey` (append-only; replay is a no-op). **Scope copied from the authenticated EdgeNode row, never the wire body** (the route's existing auth-boundary invariant).
- Scope helper — `apps/web/lib/security/scope.ts` (`deriveSecurityScopeKey`, mirrors `InventoryEntity.scopeKey`).

### Normalizers + enrichment (BI-81FEC0AC)
- OCSF constants + pinned version — `apps/web/lib/security/ocsf.ts` (`OCSF_VERSION = "1.8.0"`, class/category/activity/severity registry, syslog/CEF severity mappers).
- Reference normalizers — `apps/web/lib/security/normalizers.ts`: Windows Security Event Log (4624/4625 → Authentication, 4688 → Process Activity), AWS CloudTrail (→ API Activity, CRUD activity, errorCode→Low), ArcSight CEF (→ Security Finding). Pure `(raw) => NormalizedSecurityCore`.
- Internal self-monitoring projector — `apps/web/lib/security/internal-projector.ts`: `AuthorizationDecisionLog` + `ToolExecution` → OCSF API Activity under `organization:internal` scope. Pure mappers + `projectInternalSecurityEvents` (upsert injected, tested) + `runInternalSecurityProjection` (I/O caller for the P1 cron).
- Enrichment hook — `apps/web/lib/security/enrichment.ts`: injectable asset / threat-intel lookups (real InventoryEntity + ThreatIndicator wiring lands in P1).

### Invariants slice of P0.5 (BI-015F8995)
- Retention enrollment — `apps/web/lib/operate/retention/policies.ts`: `securityEvent` → `PURGE_POLICIES` under the **existing** `security-audit` category, 365d, industry-floor-lengthened. `SecurityCase` (later) goes to `RETAINED_DATASETS`, never purged.

### Tests
- `packages/validators/src/edge-security.test.ts` — wire schema + union routing.
- `apps/web/lib/security/security.test.ts` — normalizers, scope, OCSF mappers, internal projector, enrichment.
- `apps/web/app/api/v1/edge/events/route.test.ts` — security dispatch + scope-from-auth (3 new cases; full suite 31/31).

## Remaining P0.5 (BI-015F8995) — next pass
- Status/enum constants module for later Detection/SecurityCase status + verdict domains (feeds `statusColors.ts`); P0 needed only the confidence/source/OCSF enums already added.
- OCSF schema-version compatibility fixtures + a migration-policy test.
- EA extractor stub (`apps/web/lib/ea/security-posture-extract.ts`) + parity test — BI-79B599BF.
- Route-placement decision for the SOC surface (`/ops/security`).

## Then P1 (BI-6D9496F1) — detection engine
- `DetectionRule` / `Detection` / `ThreatIndicator` models; `siem/correlation-sweep` Inngest job (modeled on `log-signature-scanner`); wire `runInternalSecurityProjection` to a scheduled trigger; real enrichment lookups (InventoryEntity asset context, ThreatIndicator IOC match).

## Verification contract
- `pnpm --filter @dpf/db generate` after schema edits.
- typecheck: `@dpf/db`, `@dpf/validators`, `web` (all clean).
- tests: the four suites above.
- CI applies the migration (`migrate deploy`) against a fresh DB; the hand-authored SQL must match the schema (it does — verified by `prisma generate` parsing the model and the conventions matching the latest migrations).

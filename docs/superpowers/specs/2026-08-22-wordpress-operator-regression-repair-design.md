---
title: WordPress operator regression repair
status: active
date: 2026-08-22
backlog_item: BI-A45D744A
epic: EP-31C5A6C8
supersedes: null
---

# WordPress operator regression repair

## 1. Decision summary

Repair four regressions in the existing WordPress channel without adding a CMS, hosting, public URL, or CDN surface. The repair keeps WordPress as an external publication destination and restores truthful connection health, current capability projection, legacy draft compatibility, and accurate operator language.

The connector credential store remains the authority for connection lifecycle and safe projection. The publication adapter registry remains the authority for channel routing. The WordPress page remains a projection and command surface over those contracts.

## 2. Problem and evidence

PR #4478 merged the WordPress channel projection, but exact-path inspection and focused tests exposed four missing contracts:

1. A failed health probe records an error while preserving a usable credential, yet the page reads setup state without the persisted failure signal and renders `Connected` instead of `Degraded`.
2. A successful recheck records health but does not refresh the safe capability projection, so the UI can display stale WordPress version, site identity, taxonomy, and resource support.
3. The UI recognizes legacy channel id `wordpress`, while the adapter registry and adapter validation recognize only `wordpress-self-hosted`; an approved legacy draft can therefore reach a `no_adapter` outcome.
4. The first credential submission is labelled `Check connection`, even though it saves a new connection. That wording obscures the consequential action.

The existing tests prove the happy paths but do not cover these cross-layer regressions.

## 3. Objectives

**OBJ-WPOR-001:** Show a degraded WordPress connection whenever the latest persisted probe failed while a previously usable credential remains stored.

**OBJ-WPOR-002:** Refresh non-secret WordPress site and capability projection during the same successful probe transition that marks the connection healthy.

**OBJ-WPOR-003:** Route both canonical and legacy WordPress draft channel ids through one adapter contract without weakening approval or publication policy.

**OBJ-WPOR-004:** Label the initial credential command `Connect WordPress` and reserve `Check connection` for an already saved connection.

## 4. Existing substrate and constraints

- `docs/superpowers/specs/2026-08-21-wordpress-channel-projection-design.md` is the canonical WordPress channel design. This repair narrows to defects and does not replace it.
- `docs/architecture/unified-connector-kernel.md` defines persisted states as `unconfigured | connected | error` and derives `degraded` at read time when the latest probe failed but the credential remains usable.
- The connector credential envelope already stores a redacted `safeProjection`; no schema change is needed.
- Marketing publication remains draft-first and approval-gated. The repair must not broaden public publication authority.
- Secrets remain encrypted and must never enter capability projection, logs, receipts, or UI state.
- No DPF-native CMS, theme/plugin runtime, public website host, CDN, or inbound WordPress webhook is introduced.

## 5. Design

### 5.1 Persisted health derivation

`ConnectorCredentialStore.readSetupState` will derive a latest-probe failure from the persisted credential when no explicit health override is supplied. A connected credential is degraded when `lastErrorAt` exists and is not older than the most recent successful `lastTestedAt`; a successful probe clears `lastErrorAt` and returns the projection to connected.

The optional explicit health input remains for callers that hold fresher runtime health. Persisted derivation becomes the safe default so every read surface receives truthful state without reimplementing timestamp comparison.

### 5.2 Atomic health and safe projection refresh

The successful health-probe outcome will optionally carry a redacted safe-projection patch. The credential store will merge that patch into the existing safe projection, validate the result against the connector definition, encrypt the updated envelope, and persist it in the same transaction as the healthy status and timestamps.

The WordPress probe will provide only non-secret discovery fields: site URL/title, WordPress version, supported post types/taxonomies, unsupported resource types, and media-upload support. Existing publication-policy fields remain intact through a merge. Failed probes do not mutate capabilities.

### 5.3 Channel alias normalization

The adapter registry will map both `wordpress-self-hosted` and the legacy `wordpress` id to the same WordPress adapter. The adapter's draft validation will accept that same closed alias set and will continue to require an approved draft and valid WordPress publication content. Connector lookup and publication intent remain canonical as `wordpress-self-hosted`.

This follows the registry-boundary compatibility pattern already used for other marketing channel aliases. It does not create a second adapter or a second connector definition.

### 5.4 Operator language

The empty-state credential form submits with `Connect WordPress`. Once connected, the independent health command remains `Check connection`, while credential replacement remains `Replace connection`. Tests will pin all three labels to prevent semantic drift.

## 6. Failure and recovery behavior

- Probe failure with no previously usable credential remains `error`.
- Probe failure with a usable connected credential preserves the encrypted credential and renders `degraded` with a safe error summary.
- A later successful probe clears the error and refreshes capability projection atomically.
- Invalid or secret-bearing projection patches fail before persistence.
- Legacy draft routing uses identical approval and publication validation; unsupported ids still return `no_adapter`.
- Rollback is code-only. No migration or stored-data rollback is required.

## 7. Architecture, data, security, UX, and compliance review

- Architecture: pass. The change repairs existing kernel and registry boundaries instead of adding WordPress-specific state stores or publication paths.
- Data: not applicable for schema evolution. Existing encrypted envelope and timestamps are sufficient; no model, migration, retention, or backfill change is required.
- UX: pass. Status and command labels match actual system state and operator intent. Degraded state remains recoverable and preserves the primary recheck action.
- Security: pass with tests. Only redacted discovery fields may enter `safeProjection`; secret redaction and connector validation remain mandatory before encryption/persistence.
- Compliance: not applicable. The repair adds no new personal-data collection, external transfer, retention category, or publication authority.
- Domain: pass. WordPress remains an external self-hosted destination; DPF does not claim theme, plugin, hosting, CDN, or public-site parity.

## 8. Verification strategy

Use test-first changes at the owning boundaries:

- connector-store tests for persisted degraded derivation, success recovery, atomic projection merge, preservation of policy fields, and rejection of unsafe patches;
- WordPress connection-operation tests for capability refresh and failed-probe non-mutation;
- registry and WordPress adapter tests for canonical and legacy ids plus unsupported-id rejection;
- page/component tests for degraded rendering and command labels;
- focused Vitest runs, impacted package tests, typecheck, production build, UX fit review, pregate preflight, and exact-tree local integration CI.

## 9. Acceptance criteria

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-WPOR-001 | OBJ-WPOR-001 | Given a previously connected WordPress credential whose latest persisted probe failed, reading the page state returns and renders `degraded`; a later successful probe returns it to `connected`. |
| AC-WPOR-002 | OBJ-WPOR-002 | A successful WordPress recheck atomically persists the current redacted site/capability projection while preserving publication policy; a failed recheck changes no capability field. |
| AC-WPOR-003 | OBJ-WPOR-003 | Approved drafts with channel id `wordpress-self-hosted` or `wordpress` resolve to the same adapter and retain all existing validation and publication controls. |
| AC-WPOR-004 | OBJ-WPOR-004 | The initial submit action reads `Connect WordPress`; saved-connection health and replacement actions read `Check connection` and `Replace connection`. |
| AC-WPOR-005 | OBJ-WPOR-001, OBJ-WPOR-002, OBJ-WPOR-003, OBJ-WPOR-004 | Focused tests, typecheck, production build, UX review, policy preflight, and exact-tree local integration CI pass on the published commit. |

## 10. Review boundary

This repair does not reconcile historical initiative receipts from BI-8D98C5E6, replace the canonical WordPress design, or expand DPF into a WordPress-like public CMS. It repairs behavior already promised by the merged design and routes any broader product decision to a separate backlog item.

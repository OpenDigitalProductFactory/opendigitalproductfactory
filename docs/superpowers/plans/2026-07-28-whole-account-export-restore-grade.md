# Whole-Account Restore-Grade Export

Date: 2026-07-28

Backlog item: `BI-4C16947C`

Work Capsule: `WC-5DC8A1B1`

Branch: `feat/whole-account-export`


> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `feat/whole-account-export` @ `5b9ada9054930f46e329daf9aa9ac5094957cea8`, pinned at `refs/salvage/2026-08-15/feat/whole-account-export` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin 5b9ada9054930f46e329daf9aa9ac5094957cea8:refs/heads/feat/whole-account-export`.
> - Backlog ids cited below that do **not** resolve in this install: `BI-4C16947C`. Treat them as labels, not links.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

## Outcome

Create the first restore-grade whole-account export contract: a manifest shape and verifier that can prove an export package is complete enough to audit, transfer, and rehearse outside DPF. This is distinct from ad hoc table exports and intentionally stays aligned to `EP-DATA-GOVERNANCE`.

## Standards Grounding

- IETF RFC 8493 BagIt describes a directory package with payload files and metadata tags suitable for reliable storage and transfer: https://datatracker.ietf.org/doc/rfc8493/
- W3C DCAT 3 defines interoperable metadata for datasets and distributions: https://www.w3.org/TR/vocab-dcat-3/
- GDPR Article 20 frames data portability around structured, commonly used, machine-readable formats where technically feasible: https://gdpr-info.eu/art-20-gdpr/

## Existing Substrate Verified

- The data-control operation journal (`DataControlOperation` and `DataControlOperationStep`) governs consequential mutations and cross-store reconciliation.
- Data-processing activity rows already capture purposes, assets, fields, categories, recipients, residency and transfer constraints, retention/lifecycle classes, controls, evidence, and executable policies.
- Backup/restore substrate already records restorable database evidence, but it is not a scoped owner export package.
- The adequacy roadmap maps this gap to `EP-DATA-GOVERNANCE` and explicitly says not to bypass existing sensitive-data, retention, deletion, and subject-request work.

## Deliverables

1. Add a pure data-portability module for restore-grade export manifests and verification.
2. Define required export domains: relational source data, configuration, file/artifact references, audit/governance records, data-policy posture, schema/version identity, and restore instructions.
3. Verify that a manifest includes required domains, fixity entries, schema/version identity, organization scope, policy posture, dangling-reference checks, and restore rehearsal instructions.
4. Add focused tests for pass, missing domain, missing fixity, dangling file reference, non-restorable projection, and policy-bypass cases.
5. Add operator-facing documentation for what the export is good for and what it is not.

## Non-Goals

- No actual archive generation in this slice.
- No schema migration in this slice.
- No provider-specific importer into incumbent SaaS tools.
- No bypass around data-governance policy, retention, deletion propagation, or subject-request substrate.

## Backlog Coverage Decision

Decomposed to one deliverable mapped directly to `BI-4C16947C`. The manifest contract, verifier, tests, and operator doc form one independently reviewable first slice. Future repository adapters, export job orchestration, and restore-rehearsal UX should be filed as child BIs if they become independently shippable.

## Verification Plan

- `git diff --check`
- Targeted Vitest for `apps/web/lib/data-portability/restore-grade-export.test.ts` when dependencies are available.
- Direct TypeScript compile of the pure module from the root cached TypeScript installation if this source-only worktree lacks `node_modules`.
- Shared `local-integration-ci` pregate before opening a PR.

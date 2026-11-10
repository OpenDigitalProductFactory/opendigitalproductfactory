---
title: Managed install readiness continuity
status: active
backlog:
  - BI-98C268AA
---

# Managed install readiness continuity

Backlog: BI-98C268AA. Epic: EP-CLIENT-CONFIG. Workroom: WC-FEB194CE.

## Problem and research

On b338f06e581e6cc7886c334b519f098feb142865, the managed bootstrap reports
compile-ready after a successful install, but the next unchanged probe reports
build_record_unreadable. Actual dependency resolution, missing-artifact and
workspace-link checks pass; no unclassified packages are named. Both TS7 programs
and 77 affected tests ran successfully in the same checkout. Repeated preflight
and push invocations performed the managed install again. Missing artifacts,
stale lockfile and real unclassified builds were ruled out by those executed
probes. The current code forgives pnpm's absent build record with an option that
exists only inside the successful install call.

This extends delivered BI-5DF74F0D. BI-D5E18921 addresses prose being mistaken for
a package; this probe correctly names an unreadable record and zero packages.
BI-E45E92EB names actual unclassified scripts, absent from this reproduction.
Reuse the managed bootstrap and existing local stage receipt primitives; do not
modify these predecessor records or paired-installation work.

## Objectives and acceptance

**OBJ-READY-CONTINUITY:** Keep a qualified managed installation ready across unchanged probes without repeating installation.

**OBJ-READY-INVALIDATION:** Reject stale or unproven install evidence while retaining every current dependency and policy check.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-READY-01 | OBJ-READY-CONTINUITY | One successful managed install followed by repeated unchanged probes and bootstrap calls remains compile-ready with exactly one install invocation. |
| AC-READY-02 | OBJ-READY-INVALIDATION | Changed lockfile, manifest, workspace policy, relevant configuration, toolchain or installed metadata invalidates the qualified evidence. |
| AC-READY-03 | OBJ-READY-INVALIDATION | Failed installs, missing artifacts, stale workspace links and actual unclassified scripts never gain readiness from prior evidence. |
| AC-READY-04 | OBJ-READY-INVALIDATION | Missing, corrupt or mismatched evidence fails closed; no input grants build-script permission or replaces product verification. |

## Boundary and ordered fix

The source checkout owns this repair. It changes no runtime configuration,
database, coworker grant, credential, pnpm build decision or customer UI.
Funding is platform reliability under the operator's existing DEV authorization.

1. Add a first-failing cross-call regression against the current bootstrap/probe.
2. Retain a narrowly qualified successful managed-install receipt in this
   worktree's existing Git metadata. Reuse local stage receipt identity and atomic
   persistence, separate from canonical CI evidence and the cached readiness banner.
3. Bind it to read-stable source/dependency-policy inputs, pinned toolchain and
   actual installed metadata. Invalidate prior proof before a new install attempt;
   publish successful proof only after the current post-install checks pass.
   Rediscover and stamp the workspace manifest set on every probe, including newly
   added or removed manifests. Reuse the dependency-freshness workspace parser;
   conservatively include excluded packages. Unsupported workspace formats,
   external hooks and patches retain the ordinary managed-install path because
   this receipt cannot qualify their transitive inputs.
4. Only resolve an otherwise indeterminate, empty build record with matching
   successful install evidence. Always execute current artifact, resolution,
   workspace-link, staleness and unclassified-build checks. Never trust a cached
   compile-ready status or allow a named unclassified package.
5. Exercise invalidation, failed install and corrupt evidence cases; run affected
   Node suites and independent exact-source review. Preserve skipped native
   semantic/shared integration checks honestly and retain protected GitHub CI.
6. Verify repeated ordinary probes on the containing source release. Rollback
   restores strict source-only behavior; no migration or node_modules deletion is
   required. Old receipts that cannot be validated remain unusable.

At least one fifth of the work consolidates install provenance and persistence
in existing primitives rather than adding parallel cache or validation machinery.

## Traceability

Contract: docs/architecture/branch-and-worktree-runbook.md#verification-readiness-classification.
Flow: scripts/lib/bootstrap-worktree-deps.mjs.
Verification: scripts/lib/bootstrap-worktree-deps.test.mjs and scripts/lib/bootstrap-managed-install-proof.test.mjs.

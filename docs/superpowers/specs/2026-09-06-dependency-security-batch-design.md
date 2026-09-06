---
status: draft
---

# Dependency security remediation

Backlog: BI-830FC282. Workroom: WC-28DC3545.

## Scope and authority

Remediate GHSA-vcc3-ghjq-m6fr (Dependabot 156) in the existing mobile dependency graph. Changes ship through a DCO-signed PR; no installed runtime or peer-owned records are edited. This design follows the existing dependency-security runbook and fresh-store lockfile regeneration procedure. Additional dependency alerts may share the eventual PR only after their compatibility checks and live backlog coverage are established.

## Research and reproduction

Base: 092b5f4b1b1252f8786528260a8275bb200fc2fb. The lockfile resolves decode-uri-component 0.2.2 through query-string 7.1.3 and expo-router. No direct manifest dependency was found with git grep across tracked package.json files.

On 2026-09-06 the managed worktree bootstrap reported compile-ready with pnpm 10.33.2, no ignored builds, and no stale workspace links. Executing the installed query-string parser successfully decoded its normal input; resolving its decoder confirmed the vulnerable package is reachable.

A child Node process calling the installed decoder with `%FF` repeated 2,000 times exceeded a 2,000 ms timeout. The upstream v0.5.0 decoder processed the same input in approximately 0.91 ms, preserving the malformed bytes. It also decoded ASCII spaces and a four-byte UTF-8 character and preserved a truncated malformed sequence. These measurements demonstrate the algorithmic defect and upstream repair; they are not yet verification of a changed lockfile or mobile build.

Sources: https://github.com/advisories/GHSA-vcc3-ghjq-m6fr and https://github.com/SamVerschueren/decode-uri-component/releases/tag/v0.5.0. Registry metadata confirms 0.5.0 uses `type: module`. The current parent uses CommonJS. An unconditional override without an import-compatibility check is therefore insufficient.

## Objectives and acceptance

- OBJ-1: Remove the vulnerable decoder algorithm from the installed graph.
- AC-1: A frozen install resolves a patched decoder and the adversarial input completes within a bounded child-process timeout.
- OBJ-2: Preserve the existing mobile query parser contract.
- AC-2: Exercise the actual query-string consumer, including valid UTF-8, malformed bytes, plus signs, and repeated query keys.
- OBJ-3: Keep dependency changes reviewable and reproducible.
- AC-3: Fresh-store regeneration reports only the declared changed package set, a second resolution is stable, provenance and applicable security checks pass, and the PR reports exact verification limits.

## Ordered fix sequence

1. Verify CommonJS interoperability against the upstream patched release using the current parent. Prefer a supported upstream compatible release if available. Otherwise apply a minimal pnpm patch to the patched package's module export format, preserving its upstream decoding algorithm and license. Do not introduce a parallel application decoder.
2. Add the provenance-commented patched version floor and any required version-bound compatibility patch. Regenerate with scripts/regen-lockfile.mjs and the exact expected package set; investigate and reject unrelated drift.
3. Add a regression test at the dependency-consumer boundary, including the timeout reproduction and parsing compatibility. This is the refactoring boundary: reuse the existing security-test harness rather than add another dependency scanner.
4. Run the affected checks and required review/push gates. Open a single ready PR for the verified dependency changes. Confirm alert state after merge rather than dismissing the alert to make the count fall.

## Compatibility, rollback, and documentation

No schema migration, UI change, new runtime service, or change to authorization. Module-system compatibility is the principal risk. Rollback is the dependency floor, patch, lockfile, and regression test as one unit; rollback reopens the security exposure and must be explicit. No user-facing documentation changes are needed because user behavior is preserved. Security provenance belongs beside the override and patch.

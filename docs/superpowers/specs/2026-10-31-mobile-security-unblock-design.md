---
status: active
---

# Mobile security repair for the PR rescue

Implementation parent and coverage owner: **BI-9C90EE21**.
Reuse the dependency-sovereignty Tier 0 policy and existing mobile workspace.
BI-830FC282 covers the earlier decoder advisory; its 0.5.0 repair remains in
place except for this new upstream algorithm fix. Previous October alert
carriers excluded Forge when no patched release existed; 1.4.1 now exists.

## Observed defect and research

Main `adbea8f20f601e8e7d49693a1043c521b6d6c60d` resolves mobile decoder 0.5.0
and Forge 1.4.0. PR #6786 OSV run 41256757766 fails the new decoder advisory
and five Forge advisories. A bounded reproduction using the official decoder
releases and the same CommonJS-only wrapping timed out after 2 seconds on
0.5.0; 0.5.1 completed in 6 ms. Input: 30,000 distinct percent-encoded Unicode
runs, separated by x, followed by malformed %zz. The old repeated replacement
loop is quadratic. This is distinct from the earlier repeated %FF defect.

[Decoder advisory](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) fixes
versions through 0.5.0 in 0.5.1 (Dependabot #242).
Forge 1.4.1 fixes GHSA-5x38-2vff-x55p, GHSA-7wch-p9px-956x,
GHSA-8hrf-8g6f-7xwp, GHSA-hqq3-7jhf-c5jx and GHSA-jc66-7q78-782g.
[Forge release metadata](https://registry.npmjs.org/node-forge/1.4.1) retains
CommonJS, no dependencies, and Node >=6.13. Both Expo certificate consumers
allow ^1.3.3. Decoder 0.5.1 remains ESM; query-string 7 remains CommonJS, so
preserve the existing two-substitution packaging patch against new source.
Independent read-only research verified registry integrity and both releases
are older than the 24-hour floor. No attestation was exposed or claimed.

## Objectives and acceptance

**OBJ-1:** Remove applicable mobile vulnerable versions without accepting risk.

**OBJ-2:** Preserve actual Expo query parsing and certificate consumer behavior.

| Acceptance | Objective | Required result | Verification |
| --- | --- | --- | --- |
| AC-1 | OBJ-1 | Only decoder 0.5.1 and Forge 1.4.1 resolve. | Scoped stable lock regeneration and OSV |
| AC-2 | OBJ-2 | Real Expo Router query-string requires patched decoder and preserves decoding semantics with bounded malformed input. | Consumer regressions |
| AC-3 | OBJ-2 | Forge certificate generation, signing and parsing work and malformed input stays bounded. | Consumer tests and mobile typecheck |
| AC-4 | OBJ-1, OBJ-2 | Protected publication has current integration and independent review evidence. | Canonical gate and PR health |

## Ordered fix sequence

1. Record reproduction, primary-source applicability and declared compatibility.
2. Add provenance-tagged mobile floors for decoder 0.5.1 and Forge 1.4.1.
   Regenerate the decoder packaging patch against actual fixed source.
3. Regenerate the mobile lockfile with fresh metadata and only these expected
   packages; reject unrelated drift, prove the second resolution is stable,
   and bootstrap the actual mobile dependency tree.
4. Add failing-then-passing consumer regressions, run mobile typecheck,
   provenance, release-age, SBOM and OSV checks, then canonical integration.
5. Obtain independent read-only source review and publish a DCO-signed PR
   through the protected queue. Re-read the blocked PRs after the fix lands.

## Scope, rollback and coverage

One atomic mobile security repair; no Expo or React upgrade, UI change,
security exception, release-age exemption, budget increase, or new substrate.
Lockfile edits and packaging compatibility must travel together. Requirements
OBJ-1/OBJ-2, contracts AC-1 through AC-4 and this sequence map to BI-9C90EE21.
Rollback restores vulnerable versions, so use only for an observed regression
and repair forward immediately. Root dependency updates remain separate.

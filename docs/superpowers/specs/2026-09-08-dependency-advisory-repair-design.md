# September 8 dependency advisory repair

Implementation parent and coverage owner: **BI-7762A411**. This is a fix under
the existing dependency-sovereignty Tier 0 policy and dependency-reduction
routine. BI-830FC282 independently owns the decoder compatibility repair.

## Problem and evidence

GitHub reported 38 open Dependabot alerts on September 8. PRs #5225, #5226 and
#5227 each fail whole-tree OSV scanning, although their individual sharp,
nodemailer and Next upgrades have no identified compatibility defects.
GitHub code scanning and secret scanning returned zero open findings.
The immutable audit is recorded in the implementation parent's activity.

## Options and chosen repair

1. Merge the three existing upgrades separately: insufficient because each
   required OSV check sees the other vulnerable packages.
2. Adopt supported patched releases together, preserving supported major lines:
   chosen. Reuse existing workspace overrides, fresh-store lock regeneration,
   provenance guards and merge-queue verification.
3. Broad latest-version upgrades or local forks: unnecessary compatibility and
   maintenance risk where upstream has already published fixes.

Two applicability findings are recorded separately: #199's vulnerable adm-zip
filesystem extraction APIs are unused by pinned hyperframes; #159's vulnerable
Faker template evaluation is unused by Postman's fixed named generators.
Their GitHub dismissals are not claims that those upstream versions are patched.

## Objectives and acceptance

**OBJ-1:** Remove all applicable vulnerable versions from committed lockfiles.

**OBJ-2:** Preserve web, mobile and tooling consumer behavior.

**OBJ-3:** Recover the dependency PRs through protected delivery with reproducible evidence.

| Acceptance | Objective | Required result | Verification |
| --- | --- | --- | --- |
| AC-1 | OBJ-1 | Every applicable advisory has a patched resolved version and consumer verification. | Lockfile audit and consumer checks |
| AC-2 | OBJ-3 | Fresh-store regeneration is scoped and stable; provenance and SBOM guards pass. | Regeneration and guard receipts |
| AC-3 | OBJ-3 | Existing dependency PRs merge or are superseded by equivalent landed fixes. | GitHub merge state |
| AC-4 | OBJ-2 | Required runtime, test, typecheck and production-build checks pass on the candidate. | Local and cloud CI evidence |
| AC-5 | OBJ-1 | Re-read GitHub after merge; no applicable open findings remain. | GitHub security API |

## Ordered fix sequence

1. Preserve advisory applicability evidence on BI-7762A411 and confirm actual consumers.
2. Update direct Next 16.3.3, nodemailer 9.1.1, sharp 0.35.4 and Vitest family
   4.1.11 declarations. Raise branch-preserving floors for js-yaml 3.15.2/4.3.2,
   xmldom 0.8.15/0.9.12, hono 4.13.5 and qs 6.16.0 with GHSA provenance.
3. Regenerate pnpm-lock.yaml through the existing fresh-store helper with an
   explicit expected package set. Review companion changes; require a stable
   second regeneration and managed frozen dependency bootstrap.
4. Exercise actual consumers and existing relevant tests, then run provenance,
   SBOM, policy guards and the shared local-CI exhaustive suite. Cloud checks own
   the production build. Investigate the existing UX runtime retries from logs.
5. Obtain independent review, publish the verified batch, verify PR health and
   enter the merge queue. Close superseded PRs only after equivalent fixes land.
   Re-read all security alert surfaces and record final delivery evidence.

## Architecture, scope and rollback

No new dependency-management substrate or runtime/UI behavior is introduced.
Files are the existing package manifests, pnpm-workspace.yaml and pnpm-lock.yaml,
plus narrowly justified consumer verification. Approximately 20% of effort goes
to consolidating overlapping security floors and reusing existing safeguards.
The lockfile has unbounded test impact, so exhaustive verification is required.
Main risks are native sharp binaries, Next compiler companions, and Vitest
internal version alignment. Preserve matched families and test real consumers.
Rollback is one revert of this dependency batch; that restores vulnerability
exposure, so use only for a demonstrated regression and immediately repair forward.

## Backlog coverage

Atomic deliverable: the supported-version batch belongs to BI-7762A411. Its
intermediate package edits cannot individually satisfy the whole-tree security
gate. Requirements OBJ-1 through OBJ-3, contracts and verification AC-1 through
AC-5, and the Ordered fix sequence all map to that implementation parent.
Live immutable coverage must be recorded before implementation. The decoder
repair remains independently tracked under BI-830FC282 and is not reimplemented.

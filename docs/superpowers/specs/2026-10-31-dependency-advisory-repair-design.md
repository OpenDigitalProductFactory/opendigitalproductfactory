---
status: draft
---

# October 31 dependency advisory repair

Implementation owner: **BI-7F3E4389**, Workroom **WC-55048565**.
This is a supported-patch successor to the September 8 dependency advisory repair,
using the existing dependency-reduction routine and separate platform/mobile workspaces.

## Reproduction and scope

At source `568c0c1ad2b52c4c42c1493feeabe325b04a4cc7`, the repository OSV scanner
exits 1 with seven high-severity findings. PR #6791 run 41252646782 reports the
same package versions. Its packaging changes introduce no dependency version changes.
The platform lock resolves systeminformation 5.33.1; the mobile lock resolves
node-forge 1.4.0 and patched decode-uri-component 0.5.0.

Use upstream fixes: systeminformation 5.33.16 (GHSA-3f7j-7jwc-fxfj, Dependabot #241),
decode-uri-component 0.5.1 (GHSA-qr28-fpjm-wq7f, #242), and node-forge 1.4.1
(GHSA-5x38-2vff-x55p, GHSA-7wch-p9px-956x, GHSA-8hrf-8g6f-7xwp,
GHSA-hqq3-7jhf-c5jx, GHSA-jc66-7q78-782g; OSV findings).

PR #6785 already updates systeminformation alongside twelve general dependency
updates. Reconcile that equivalent resolution after either lands; this repair
introduces only the security floor and its scoped lockfile change. The older
BI-830FC282 decoder repair covers a different advisory fixed by 0.5.0. Preserve
its query-string 7 CommonJS contract while updating the upstream decoder algorithm.
The node-forge vendoring pilot BI-0BD24E54 is outside this patch repair.

## Objectives and acceptance

**OBJ-1:** Resolve patched versions for the seven findings without accepting them.

**OBJ-2:** Preserve existing mobile and platform consumer behavior.

**OBJ-3:** Restore protected release eligibility through the existing dependency workflow.

| Acceptance | Objective | Required result | Verification |
| --- | --- | --- | --- |
| AC-1 | OBJ-1 | Neither lockfile resolves the affected vulnerable versions; online OSV scanning has no unaccepted high findings from this batch. | Before/after scanner and resolved-version audit |
| AC-2 | OBJ-2 | Decoder CommonJS loading, query-string parsing and malformed-input behavior remain compatible. | Existing mobile decoder tests and bounded consumer probes |
| AC-3 | OBJ-2 | node-forge certificate operations and the platform systeminformation consumer work on patched versions. | Actual consumer tests/probes and protected CI |
| AC-4 | OBJ-3 | Lockfile regeneration changes only the declared packages and required shared-package closure and is stable on a second resolution. | Existing fresh-store regeneration helper |
| AC-5 | OBJ-3 | Provenance, SBOM, frozen dependency resolution and canonical integration checks pass before protected merge. | Guard, gate and PR evidence |

## Ordered fix and coverage

One atomic security batch belongs to BI-7F3E4389: the whole-tree OSV gate cannot
pass while any of the three package fixes is omitted.

1. Retain current-main RED scanner evidence and verify upstream package metadata.
2. Raise only the necessary security floors in their owning workspaces. Rebase
   the existing decoder module-format patch onto 0.5.1 without changing its algorithm.
3. Regenerate each lockfile with scripts/regen-lockfile.mjs from that workspace,
   declaring its exact expected changed-package set. Reject unrelated drift.
4. Run the existing decoder tests, actual node-forge/systeminformation consumer
   probes, online scanner, provenance/SBOM guards and canonical integration.
5. Independently review the frozen delta, publish via protected PR, reconcile the
   overlapping systeminformation resolution, and resume packaging PR #6791.

## Boundaries, compatibility and rollback

No new runtime substrate, grant, investment budget, schema or UI is introduced.
Release-age policy and installer build-script controls remain enforced. The decoder
patch changes module format only; upstream owns the security algorithm. Consolidate
its old patch reference when the replacement is verified. Do not edit the advisory
acceptance baseline to make this batch pass. The release coordinator alone publishes
the containing canonical image and advances DEV. Paired production remains read-only.
A demonstrated regression may require reverting the batch, which restores known
exposure and therefore requires prompt forward repair. Passing source checks do
not establish a published image or served-runtime acceptance.

## Observed mobile resolution prerequisite

Fresh resolution also exposed stale mobile closure on the same base: validators
now imports integration-shared through workspace:, and its zod dependency uses
catalog:. Neither protocol resolves from an external injected file: copy.
Retain the established isolated mobile file-copy boundary. Map only validators'
integration-shared edge to its local file: package and translate the two external
catalog edges (validators/zod and integration-shared/undici) to the owning catalog
ranges. These are compatibility mappings, not advisory waivers. Keep the guard's
exceptions exact and tested; unrelated untagged floors must still fail. Include
integration-shared changes in the existing mobile CI trigger. Frozen installation,
mobile typecheck/tests and scoped second resolution verify the repaired closure.
The expected mobile registry delta is decoder, node-forge, and the newly required
undici closure. This prerequisite remains in the atomic batch because the mobile
security lock cannot regenerate without resolving its first-party dependencies.
The existing SBOM mechanism records one additional mobile component (undici),
with no duplicate growth; this is the already-declared shared package closure,
not an advisory acceptance. The vulnerability acceptance baseline stays unchanged.

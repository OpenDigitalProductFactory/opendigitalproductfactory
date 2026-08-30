---
status: active
---

# Source-free consumer verification preflight implementation plan

- **Backlog item:** `BI-FFBDDD96`
- **Overlapping occurrence:** `BI-6AE39A07`
- **Workroom:** `WC-DAF911CD`
- **Design:** `docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md` §3.1.1
- **Trigger evidence:** `cmt8stt1k0sz901mgdydvozww`
- **Blocked release:** `v2026.08.25-consumer-self-upgrade.1` / `7557f95283eb5d67b1f12b6779dd684db45cb3ad`

## Research evidence

- The canonical consumer install serves immutable Git-stamped image bytes but,
  by contract, contains neither a source checkout nor `.git`. The live MCP
  preflight therefore returned `BLOCKED` even though the release publisher had
  already proven the target image manifests and a clean release-mode install.
- `apps/web/lib/verify/preflight-service.ts` currently treats every
  uncomputable Git ancestry result alike and supplies Git-repair guidance. Its
  pure verdict core has no validated install-provenance input and does not
  recognize exact served/feature identity before the ancestry result.
- `apps/web/lib/install/host-profile.ts` already owns the bounded host evidence:
  `.install-mode`, `.git` presence, and the release image tag. It projects the
  closed `source | consumer | unknown` classification and fails contradictory
  evidence closed. Reusing it avoids a second install-state reader.
- `apps/web/lib/contributor-change-lanes/github-rest-reader.ts` already owns the
  canonical GitHub repository identity and optional credential resolution.
  `canonical-artifact-discovery.ts` proves the existing bounded compare pattern.
  Reusing those resolvers avoids a second provider/configuration path.
- The parent design's research compares CI required checks, Kubernetes probes,
  Terraform plan/apply, and Make/Bazel staleness. The amendment preserves those
  precedents: the preflight remains side-effect-free, returns one verdict, and
  leaves the governed controller as the only mutation path.

## Objective and contract map

| Ref | Objective | Contract | Flow | Acceptance |
| --- | --- | --- | --- | --- |
| `OBJ-EXACT-IDENTITY` | Equal immutable served and feature SHAs are testable without a checkout. | `CONTRACT-EXACT-SHA` | `FLOW-PURE-VERDICT` | `AC-EXACT-IDENTITY` |
| `OBJ-CONSUMER-ADVANCE` | Uncomputable ancestry on a validated source-free release must use the governed advance. | `CONTRACT-HOST-PROFILE` | `FLOW-SERVICE-ADAPTER` | `AC-CONSUMER-ADVANCE` |
| `OBJ-PROVIDER-ANCESTRY` | A consumer without local Git can prove an older feature is present through one bounded canonical-provider comparison. | `CONTRACT-CANONICAL-REPOSITORY` | `FLOW-PROVIDER-FALLBACK` | `AC-PROVIDER-CONTAINED`, `AC-PROVIDER-NOT-CONTAINED`, `AC-PROVIDER-UNAVAILABLE` |
| `OBJ-FAIL-CLOSED` | Source-backed, contradictory, or unknown evidence must not infer containment. | `CONTRACT-UNKNOWN-BLOCKS` | `FLOW-SERVICE-ADAPTER` | `AC-FAIL-CLOSED` |
| `OBJ-SURFACE-PARITY` | CLI and MCP use the same verdict core and one advance path. | `CONTRACT-SINGLE-CORE` | `FLOW-ADAPTERS` | `AC-SURFACE-PARITY` |
| `OBJ-ACTIONABLE` | Consumer recovery must not recommend mounting Git or setting `DPF_REPO_ROOT`. | `CONTRACT-CONSUMER-GUIDANCE` | `FLOW-PURE-VERDICT` | `AC-ACTIONABLE` |

## Atomic delivery

The pure verdict input, server adapter, bounded provider fallback, and tests form one safety boundary.
Shipping only the host-profile read would leave the verdict unable to consume
it; shipping only exact-SHA equality would still block every behind consumer;
shipping only the consumer fallback without fail-closed counterexamples could
weaken source-backed verification. Shipping without provider containment would
still force an unnecessary upgrade whenever the served release is newer than
the feature. Deliver them together under `BI-FFBDDD96`, satisfying the
overlapping `BI-6AE39A07` occurrence in the same PR.

## Task 1: Pin the pure verdict red

**Files:**

- Modify `apps/web/lib/verify/preflight.test.ts`
- Modify `apps/web/lib/verify/preflight.ts`

Add failing truth-table cases proving:

1. exact full or unambiguous prefix-equal Git SHAs return `CAN-TEST` even when
   ancestry IO is unavailable;
2. an uncomputable ancestry result on a validated `consumer` host returns
   `MUST-ADVANCE` and points only to `/ops/self-upgrade`;
3. the same result on `source` or `unknown` remains `BLOCKED`; and
4. consumer guidance never mentions `DPF_REPO_ROOT`, mounting `.git`, or
   installing/fetching Git.

Retain the red output before implementation.

## Task 2: Implement the closed provenance input

**Files:**

- Modify `apps/web/lib/verify/preflight.ts`
- Modify `apps/web/lib/verify/preflight.test.ts`

Add the existing `InstallHostKind` to `PreflightInput`. Resolve exact identity
before consulting ancestry. On `featureContainedInServed === null`, map only
validated `consumer` to the existing `MUST-ADVANCE` action; keep `source` and
`unknown` on the existing blocker path. Do not add a verdict, data source, or
alternate deployment action.

## Task 3: Wire the server adapter red/green

**Files:**

- Modify `apps/web/lib/verify/preflight-service.test.ts`
- Modify `apps/web/lib/verify/preflight-service.ts`
- Verify `apps/web/lib/install/host-profile.ts`
- Verify `apps/web/lib/install/host-profile.test.ts`

Inject `readInstallHostProfile()` through `ReadinessDeps` and pass only its
closed `kind` into the pure core. Add service tests for consumer, source, and
contradictory/unknown hosts, exact identity, proven ancestry, and proven
non-ancestry. Assert that Git remains authoritative whenever it produces a
boolean result and that host evidence is server-derived rather than caller
supplied.

## Task 4: Prove adapter parity and blast radius

**Files:**

- Verify `scripts/dpf-verify-preflight.ts`
- Verify `apps/web/lib/mcp/packs/build-ops-pack.test.ts`

Run every caller of `computePreflightVerdict`. The CLI runs from a source
checkout and must retain source/unknown fail-closed behavior when Git cannot
answer; the MCP adapter supplies the validated host profile. Preserve the MCP
response schema and the single `verify_live_install_readiness` tool contract.

## Task 5: Add bounded canonical-provider ancestry

**Files:**

- Add `apps/web/lib/verify/provider-ancestry.ts`
- Add `apps/web/lib/verify/provider-ancestry.test.ts`
- Modify `apps/web/lib/verify/preflight-service.ts`
- Modify `apps/web/lib/verify/preflight-service.test.ts`

When local Git returns unknown on a validated consumer only, compare
`featureSha...servedSha` through the canonical GitHub repository identity. Reuse
the existing repository/token resolvers, encode every path component, use a
five-second deadline, and parse only the closed `ahead | identical | behind |
diverged` status set. `ahead`/`identical` mean contained; `behind`/`diverged`
mean not contained; every failure returns unknown. Prove local Git precedence,
exact-identity short circuiting, no provider call for source/unknown hosts, and
truthful consumer fallback when the provider is unavailable.

## Task 6: Govern and ship

1. Obtain independent design/research evidence against the immutable design and
   plan; create the initiative baseline required by the coverage writer.
2. Record atomic plan/backlog coverage for every requirement, contract, flow,
   and verification mapping above before source implementation.
3. Claim the exact implementation/test paths and consume the returned impact
   contract.
4. Execute Tasks 1–5 test-first, then run focused Vitest, web typecheck, doc
   index/link checks, and `pnpm run pregate:preflight`.
5. DCO-commit the stable tree, reconcile the Workroom, obtain fresh exact-tree
   semantic review, and run one governed exact-tree local-CI gate.
6. Publish a DCO PR, read bot findings and `pnpm pr:health`, enter the protected
   merge queue, and publish one official immutable release from the merge SHA.
7. Re-run `verify_live_install_readiness`. Follow only its `CAN-TEST`,
   `MUST-ADVANCE`, or `BLOCKED` next action. If authorized, perform exactly one
   governed self-upgrade, then verify health, data preservation, truthful update
   UX, initiative-readiness v2, and the WordPress recovery projection.

## Backlog coverage

- Decision: atomic
- Parent: `BI-FFBDDD96`
- Satisfied overlapping occurrence: `BI-6AE39A07`
- Dependencies: canonical repository provider is optional at runtime; failure
  retains the governed `MUST-ADVANCE` fallback.
- Deliverable: `source-free-consumer-preflight-disposition` → `BI-FFBDDD96`
- Rationale: exact identity, validated provenance, fail-closed counterexamples,
  and surface parity are unsafe when shipped independently.
- **Blocking condition:** implementation must not begin until independent
  research/design evidence and atomic plan coverage bind the immutable design
  and plan blobs.

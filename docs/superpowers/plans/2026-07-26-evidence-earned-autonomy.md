# Evidence-Earned Autonomy Implementation Plan

- **Status:** approved for implementation
- **Date:** 2026-07-26
- **BI:** `BI-D872BD16`
- **Epic:** `EP-CLIENT-HOOK-PLANE`
- **Work Capsule:** `WC-31705B72`
- **Coverage receipt:** `cms1y0e4v01rc01lhco9fbrke` (`atomic`)
- **Design:** `docs/superpowers/specs/2026-07-26-evidence-earned-autonomy-design.md`
- **Branch:** `feat/evidence-earned-autonomy`
- **Worktree:** `D:/DPF-worktrees/evidence-earned-autonomy`

## Outcome

Ship one atomic, server-authoritative completion-evidence gate that every AI
client inherits. The delivery is complete when an agent cannot move a BI to
`done` without server-resolved evidence proportional to the work, while direct
operator remediation, no-op transitions, and non-consequential work remain
available.

## Delivery shape and coverage

This plan is **atomic**. The policy, resolver, hook registration, MCP schema,
status receipt, and evidence writer must ship together:

- a policy without the hook does not enforce;
- a hook without the schema gives clients no valid retry;
- a schema without server resolution trusts self-attestation; and
- a gate without evidence-kind convergence creates two vocabularies.

No phase below is independently shippable. The live backlog-coverage receipt is
recorded on `BI-D872BD16` before production source edits begin.

## Coordination boundary

- Do not modify the governed-playbook experiment runtime under
  `apps/web/lib/tak/work-pattern-*`.
- Read `FeatureBuild` verification through a small adapter only.
- Do not modify per-client bootstrap/conformance files owned by
  `BI-71310615`, `BI-88681BE0`, PR #3594, or PR #3596.
- Do not mutate the 25 audited backlog items.
- Do not introduce public lifecycle enums or schema migrations.

## Budget

**10 effort units = 8 feature + 2 refactor (20%).**

The two refactor units are limited to:

1. one canonical execution-evidence kind/dimension registry; and
2. one shared evidence parsing/projection seam used by the writer and verifier.

## Task 1 — TDD the canonical evidence registry (refactor, 1 unit)

**Create:**

- `apps/web/lib/backlog/execution-evidence.ts`
- `apps/web/lib/backlog/execution-evidence.test.ts`

**Modify:**

- `apps/web/lib/mcp/packs/build-evidence-pack.ts`
- `apps/web/lib/mcp/packs/build-evidence-pack.test.ts`

**Tests first:**

- every evidence kind maps to one dimension and polarity;
- neutral `external_link` cannot satisfy a completion gate;
- source evidence requires an HTTP(S) URL;
- tool-execution references resolve only to successful audit rows when supplied;
- the MCP enum and runtime validator consume the same registry.

## Task 2 — TDD the pure completion policy (feature, 3 units)

**Create:**

- `apps/web/lib/backlog/completion-evidence-policy.ts`
- `apps/web/lib/backlog/completion-evidence-policy.test.ts`

**Contract:**

- parse and normalize `CompletionEvidenceManifest`;
- enforce item-work-type/work-class compatibility;
- derive required evidence dimensions;
- require concrete UX/migration not-applicable rationales;
- reject dangling, foreign, stale, negative, superseded, or neutral evidence;
- allow an already-done no-op;
- return structured blockers and one recommended next action.

**Tests first:**

- documentation, verified-existing, operational, implementation;
- UI and migration applicability combinations;
- implementation cannot masquerade as documentation;
- newer test/build/UX/migration failure invalidates an older pass;
- evidence from another BI never counts;
- invalid not-applicable rationale fails;
- no-op completion remains idempotent.

## Task 3 — TDD the runtime resolver and Build Studio adapter (feature, 2 units;
refactor, 1 unit)

**Create:**

- `apps/web/lib/backlog/completion-evidence-runtime.ts`
- `apps/web/lib/backlog/completion-evidence-runtime.test.ts`

**Requirements:**

- load the target item, claim/start cutoff, referenced and newer evidence;
- project `BacklogItemActivity.payload` through the shared parsing seam;
- optionally project test/build/UX facts from the active `FeatureBuild`;
- do not copy Build Studio evidence into a second store;
- return an evidence verdict with no writes.

**Tests first:**

- active build fulfills only dimensions it proves;
- skipped UX supports not-applicable, not verified;
- stale and foreign activity IDs fail;
- a newer unreferenced failure blocks;
- missing Build Studio state fails closed;
- query shape is bounded and indexed.

## Task 4 — TDD the server governance hook and circuit breaker (feature, 2 units)

**Create:**

- `apps/web/lib/backlog/completion-evidence-governance-hook.ts`
- `apps/web/lib/backlog/completion-evidence-governance-hook.test.ts`

**Modify:**

- `apps/web/instrumentation.ts`
- `apps/web/lib/mcp-governed-execute.test.ts`

**Requirements:**

- govern only `update_backlog_item_status(status="done")`;
- govern `external-jsonrpc`, `internal-mcp-session`, and `agentic-loop`;
- leave direct portal REST and non-completion transitions unchanged;
- modes: `enforce | shadow | off`;
- enforce returns actionable blockers;
- shadow records one item-scoped finding;
- count recent invalid attempts from `ToolExecution`;
- after five invalid attempts in ten minutes, send one deduped attention
  notification; valid evidence-backed retries remain allowed;
- fail closed on evidence-resolution errors for a consequential request.

**Tests first:**

- every agent source is governed;
- REST operator path, no-op, and non-done transitions pass;
- shadow/off behavior;
- audit/circuit identity precedence: API token, then agent, then user;
- valid retry bypasses the breaker;
- attention is deduped and contains no secret.

## Task 5 — wire the MCP contract and durable status receipt (feature, 1 unit)

**Modify:**

- `apps/web/lib/mcp/packs/backlog-pack.ts`
- `apps/web/lib/mcp/packs/backlog-pack.test.ts`

**Requirements:**

- add the nested `completionEvidence` input schema;
- update tool guidance with proportional examples;
- persist the normalized work class, evidence references, Build Studio adapter
  use, and UX/migration dispositions in the `status_change` activity payload;
- never persist a caller-supplied gate verdict;
- keep legal-transition and claim semantics unchanged.

**Tests first:**

- normalized receipt fields are written on completion;
- evidence parameters are absent from non-completion receipts;
- no-op does not create a new receipt;
- existing invalid-status/resolution/claim tests remain green.

## Task 6 — architecture and operator documentation (feature, 1 unit)

**Create:**

- `docs/architecture/agent-client-governance.md`

**Update:**

- this design and plan with implementation/PR pointers;
- `docs/superpowers/specs/2026-07-24-per-client-configuration-conformance-design.md`
  with the tool-disclosure versus mutation-acceptance boundary;
- `docs/superpowers/specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md`
  with the Build Studio evidence-producer relationship if the parallel delivery
  has not already added the pointer.

The architecture page owns the durable four-altitude explanation. Historical
specs link to it instead of copying the rules.

## Architecture review findings folded into the plan

- **Aligned:** reuse `BacklogItemActivity`, `FeatureBuild`, `ToolExecution`,
  Attention, `DecisionShadowLedger`, and `TrustState`; add no table.
- **Important:** client identity is attribution, never authority. The hook keys
  policy to source/risk and evidence, not client brand.
- **Important:** Build Studio is an evidence producer. Read its canonical state
  through an adapter; never emit duplicate evidence rows just to satisfy this
  gate.
- **Important:** self-attested pass strings are insufficient. The server
  resolves item ownership, polarity, freshness, and supersession.
- **Minor:** use SLSA’s provenance/verification separation as an architectural
  analogy only; do not claim SLSA compliance.

## Source-local verification

The worktree is `source-only`. Run focused tests through the available shared
dependency graph if safe; otherwise classify them unrun locally and execute the
same commands in the leased integration sandbox:

```powershell
pnpm --filter web exec vitest run `
  lib/backlog/execution-evidence.test.ts `
  lib/backlog/completion-evidence-policy.test.ts `
  lib/backlog/completion-evidence-runtime.test.ts `
  lib/backlog/completion-evidence-governance-hook.test.ts `
  lib/mcp/packs/build-evidence-pack.test.ts `
  lib/mcp/packs/backlog-pack.test.ts `
  lib/mcp-governed-execute.test.ts
pnpm --filter web typecheck
node scripts/check-module-size.mjs
node scripts/check-style-drift.mjs
```

## Governed runtime verification

Lease `local-integration-ci`, run
`node scripts/sandbox-freshness-preflight.mjs --converge`, and capture branch,
SHA, lease ID, freshness verdict, and resolved dependency versions.

Exercise:

1. external client implementation completion with resolution only — denied;
2. documentation with fresh `spec_review` — allowed;
3. verified-existing with source + manual evidence — allowed;
4. implementation with source + test + build and UX/migration N/A reasons —
   allowed;
5. UI implementation without UX evidence — denied;
6. migration implementation with a newer migration failure — denied;
7. active Build Studio evidence reuse — allowed only for proved dimensions;
8. evidence ID from another BI — denied;
9. direct operator remediation path — allowed and audited;
10. five repeated unsupported attempts — one attention notification;
11. a valid retry after repeated failures — allowed;
12. shadow and off kill switches — observed without mutation-policy drift.

Then run:

```powershell
pnpm --filter web build
```

No migration gate is required because this delivery adds no migration.

## PR completion

- record tests, build, runtime matrix, and no-migration rationale on
  `WC-31705B72` and `BI-D872BD16`;
- commit with DCO sign-off;
- push the branch;
- run the local merged-code gate;
- open one ready, non-draft PR;
- run `pnpm pr:health <n>`;
- enroll through `gh pr merge <n> --squash --auto`;
- do not mark the BI done until the PR is merged and the governed release has
  made the enforcing behavior live.

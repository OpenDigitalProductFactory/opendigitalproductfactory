# Governed playbook experimentation — Delivery 1 evidence

Date: 2026-07-26  
Branch: `feat/work-pattern-experiment-ledger`  
Backlog item: `BI-0A636528`  
Work Capsule: `WC-3301191A`

## Delivered

- Strict execution-profile, experiment-manifest, identity, outcome, and append-only effective-ledger
  contracts.
- Deterministic parent/child `TaskRun` storage with serialized replicate allocation, retry history,
  accountable ownership, and synchronized experiment/A2A lifecycle.
- Autonomous scheduling for approved, evidence-cleared shadow candidates.
- An immutable `TaskArtifact` inference-replay lane using canonical provider/model routing,
  deterministic oracle checks, compact result metadata, and orchestrating-coworker ledger
  attribution.
- Fail-closed boundaries for live-environment, missing-fixture, mutable-workspace, and unsupported
  executor cases.
- Living Playbooks projection and plain-language experiment evidence disclosure.
- Nullable `BuildPhaseRun.executionProfileRef` and measured `TaskRun(buildId,status)` index.

No experiment path advances `FeatureBuild.phase`, writes acceptance, creates a pull request, enters
the merge queue, initiates release, activates an `AuthorityBinding`, or mutates live customer state.

## Verification

- Focused test gate: 14 files, 86 tests passed.
- Production build: Next.js 16.2.11 compiled, typechecked, and generated all 139 static pages.
- Prisma schema validation: passed.
- Existing-state migration chain: 446 migrations applied successfully in the governed
  local-integration PostgreSQL environment.
- Module-size ratchet: passed after extracting the experiment projection from the existing
  read-model module.
- Full standalone web typecheck remains affected by the sandbox's duplicate PostCSS package graph
  in `design/tokens-utilities.test.ts`; the production build's canonical TypeScript gate passed and
  no experiment file reports a TypeScript error.

## Query-plan evidence

Representative sandbox volume: 100,000 `TaskRun` rows and 100,000
`DecisionShadowLedger` rows.

| Read | Plan | Measured result |
| --- | --- | --- |
| Parent to children | `TaskRun_parentTaskRunId_idx` | 100 rows, 0.354 ms |
| Build and status, before | status/heartbeat index then heap filter | 20,000 candidates, 4.514 ms |
| Build and status, after | `TaskRun_buildId_status_idx` | 200 rows, 0.691 ms |
| Ledger by task run | `DecisionShadowLedger_taskRunId_idx` | 1 row, 0.029 ms |
| Ledger by activity/risk/time | `DecisionShadowLedger_observedAt_idx` plus filter | 100 rows, 0.194 ms |

The measured build/status read justified the optional composite index. The other existing indexes
were retained unchanged.

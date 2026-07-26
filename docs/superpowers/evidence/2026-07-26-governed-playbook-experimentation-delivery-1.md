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
- Parent analysis that counts only terminal baseline/candidate pairs with matching fixtures,
  source, corpus, oracle, resource policy, and requested/actual provider-model identity.
- Nullable `BuildPhaseRun.executionProfileRef` and measured `TaskRun(buildId,status)` index.

No experiment path advances `FeatureBuild.phase`, writes acceptance, creates a pull request, enters
the merge queue, initiates release, activates an `AuthorityBinding`, or mutates live customer state.

## Verification

- Focused test gate: 14 files, 83 tests passed.
- Production build: Next.js 16.2.11 compiled, typechecked, and generated all 139 static pages.
- Prisma schema validation: passed.
- Existing-state migration chain: 446 migrations applied successfully in the governed
  local-integration PostgreSQL environment.
- Module-size ratchet: passed after extracting the experiment projection from the existing
  read-model module.
- Style/token drift ratchets: passed; the new experiment evidence uses theme tokens and a 12 px
  minimum for its explanatory copy and disclosure.
- Documentation index and user-guide link integrity: passed.
- Full standalone web typecheck remains affected by the sandbox's duplicate PostCSS package graph
  in `design/tokens-utilities.test.ts`; the production build's canonical TypeScript gate passed and
  no experiment file reports a TypeScript error.

## UX-fit verification

- Decision: **fits** the existing Platform coworker-record architecture.
- Owning area and route: Platform AI workforce,
  `/platform/ai/agent/[agentId]`; no new route or navigation layer was added.
- Primary persona: platform operator or contributor reviewing a coworker's Living Playbooks.
- Existing primitives reused: `NeedsAndPlaybooksPanel`, Living Playbook row, `Chip`, `Section`,
  and native `details` disclosure. This is contextual evidence, not a new dashboard or dense data
  grid, so Report Kit primitives are not applicable.
- Source of truth: parent `TaskRun` experiment manifest plus compact child outcomes and
  `DecisionShadowLedger` evidence; missing or invalid pairs remain visibly insufficient and cannot
  activate a method.
- Browser verification used the actual component rendered with a completed hermetic replay:
  desktop 1280x900 and mobile 390x844 both had zero horizontal overflow; the mobile evidence card
  measured 344 px wide; summary/detail copy computed at 12 px; the disclosure opened and exposed
  methods, models, scope, corpus/oracle/policy versions, freshness, and engineer IDs.
- Dark and light token behavior was verified. The dark rendering remained legible, and light-mode
  computed tokens resolved to background `#f5f7fb`, surface `#fff`, and text `#152033`.

## Recovery verification

- Queue interruption/resume skips already-terminal child cells and reruns only incomplete cells.
- Replicate allocation and retry attempts are monotonic and preserve prior evidence.
- Missing fixture, non-shadow environment, provider/model fallback, incomplete pair, mismatched
  controls, and invalid manifest paths fail closed or produce “more evidence needed”; none advances
  delivery, authority, merge, release, or live state.

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

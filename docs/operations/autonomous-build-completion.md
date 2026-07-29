# Autonomous Build Studio (operator runbook)

Build Studio can own an eligible build from intake through deployed completion without routine
operator clicks. Autonomy is evidence-cleared, scoped, and off by default. It does not enlarge an
agent's authority, bypass a phase gate, merge directly, or replace governed self-upgrade.

## Control switches

| Setting | Values | Purpose |
| --- | --- | --- |
| `DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE` | `off` (default), `shadow`, `enforce` | Observe or actuate Living Playbook eligibility at every consequential seam. |
| `DPF_AUTO_COMPLETE_VERIFIED_BUILDS` | `1`, `true`, `on` (default off) | Allows verified ship forks and deployed completion. |
| `DPF_BUILD_PR_DELIVERY_RECONCILER_MODE` | `off`, `shadow`, `enforce` | Controls PR observation and compare-and-swap delivery actions. |

The legacy switches remain independent kill switches. Full autonomous custody requires the
autonomous playbook and the relevant downstream switch to be in `enforce`. `shadow` records what
would happen but never grants a new transition.

## Eligibility contract

One pure projection is re-evaluated before intake, ideate, plan, build, review, ship, PR, and
release actions. A lane is eligible only when all of these are true:

- an active Governed Work Pattern binding matches the current activity, `dpf_dogfood` install,
  DPF repository corpus, and selected model profile;
- the binding's evidence is fresh and its authority remains active;
- the decision gate permits the transition and the regulatory ceiling permits autopilot;
- provider, sandbox, verification-oracle, recovery-budget, and delivery evidence are ready for
  that checkpoint; and
- sensitivity is below the high-risk ceiling.

The binding does not confer authority by itself. Existing `AuthorityBinding`,
`DecisionInteraction`, `DecisionShadowLedger`, `TaskRun`, `BuildPhaseRun`, Work Capsule, Feature
Build, merge-queue, and self-upgrade records remain the owners of authority and evidence.
`BuildPhaseRun.executionProfileRef` and TaskRun metadata record the method version, model profile,
provider, and model actually used.

## Experiment promotion

When a governed work-pattern experiment finishes, Build Studio analyzes and promotes its evidence
before completing the parent run. Promotion is automatic only when the versioned policy clears it:
each model lane needs at least eight comparable baseline/candidate pairs, a complete factorial
matrix, fresh evidence, no reproduced blocking finding or commandment regression, and no
regulatory human-control requirement. For `build.implement`, every qualifying pair must include a
passing production build; inference-only replay evidence remains useful shadow evidence but cannot
authorize an autonomous build lane.

An approved low-risk `build.implement` experiment continues itself one replicate at a time until
the eight-pair evidence floor is reached. Each cell receives a detached worktree at the same source
commit, may generate only the fixture's declared source file, runs only the fixture's declared
scoped tests, and must pass the canonical production build. Continuation is idempotent: retries
request the explicit next replicate rather than allocating an unbounded new run. It stops at eight,
on any invalid pair or hard regression, and before workspace creation for irreversible/outbound
risk. Experiment worktrees are removed after success or failure. They never advance a Feature
Build, create a pull request, enter the merge queue, release, or mutate the live portal.

A reviewed build candidate may carry its bounded replay fixture through the existing AI Workforce
Living Playbook review. Approval does not leave the fixture inline in TaskRun metadata: under the
experiment-definition lock, Build Studio validates the safe source/test paths and full 2x2
method-model matrix, writes one immutable `TaskArtifact`, and stamps its artifact reference into
each child execution request before dispatch. Automatic replicates reuse that artifact. Repeating
the same review is idempotent; reusing the logical fixture key with different bytes or referencing
a missing artifact parks before cell dispatch. Unsupported activity, non-shadow execution, and
irreversible/outbound risk stop before the artifact or an execution workspace is created.

The operator records the review from the existing coworker detail panel; no separate fixture
admin page or approval queue exists. A pre-dispatch rejection remains visible as review/evidence
history and should be corrected by submitting a new versioned candidate rather than editing the
retained artifact or inserting database rows manually.

The first qualifying same-install promotion creates a rollback-safe baseline binding and then
activates the candidate binding in the same serialized transaction. The candidate is scoped to the
exact install, corpus, activity, risk, and model profile proved by the experiment. A note that
portable or customer corroboration is required for broader scope does not block that local binding;
it continues to block fleet or customer promotion. Separate model profiles receive separate
activation lanes, and regulatory or authority ceilings still escalate instead of activating.

## Autonomous path

```text
intake -> ideate -> plan -> build -> review -> ship
       -> exact-head PR checks -> merge queue -> awaiting release
       -> governed self-upgrade -> deployed-SHA check -> complete
```

Every arrow is separately eligible. A binding that expires, a provider that disappears, a
regulatory change, red or missing verification, a human-closed PR, or an authority ceiling parks
the build before the next mutation.

Merge is not deployment. A merge-queued or merely merged change cannot complete. Build Studio
shows **Waiting for governed release** until the self-upgrade path proves the merged code is in the
running version. The completion reconciler then rechecks release eligibility, marks the existing
promotion deployed, and advances `ship -> complete`.

Private and `fork_only` installs preserve their existing local-delivery path. The registered local
product version is their delivery evidence; they do not fabricate a PR.

## Bounded recovery

Recovery state is serializable and resumes after process restart. The v1 policy permits:

| Failure | Autonomous action | Bound |
| --- | --- | --- |
| provider rate/capacity | backoff or eligible fallback | 2 |
| tool protocol mismatch | normalize, then compatible fallback | 2 |
| context overflow | compact and replay | 1 |
| verification or reproduced review finding | repair and verify | 2 |
| plan oscillation | decompose | 1 |
| post-push CI | repair, push a new SHA, re-observe | 2 |
| stale merge-queue base | leave queue, replay, re-enroll | 1 |
| unresolved review thread | address and re-review | 2 |
| remote SHA race | discard stale decision and re-observe | 1 |
| deployed SHA timeout | continue bounded observation | 1 |

Sandbox drift is routed to the governed sandbox convergence path and is not charged as a product
failure. Self-upgrade failure stays with the governed runner and its recovery point/rollback
contract. The policy deliberately has no direct Compose rebuild, direct redeploy, force-push,
admin merge, or PR-reopen action.

Ambiguous feedback, an authority/regulatory ceiling, exhausted recovery, or a human-closed PR
parks the run. Escalation is deduplicated so one failure does not create an attention storm.

## What the operator sees

The existing Build Studio solution band displays one plain-language custody state:

- **Build Studio is working**
- **Build Studio is recovering**
- **Checking the pull request**
- **Waiting for governed release**
- **Needs your decision**
- **Build Studio may be stalled**
- **Live and complete**

Method version, provider/model, checkpoint, blockers, and attempt counts remain under **Engineer
details**. The surface adds no new route, tab, dashboard, or prompt-sending action.

## Rollout and rollback

1. Keep all three switches off while deploying the code.
2. Enable autonomous playbook `shadow` and compare recorded decisions with existing gates.
3. Enable one contained, low-risk `dpf_dogfood` binding whose evidence scope exactly matches.
4. Exercise happy path plus provider, sandbox, verification, PR, queue, release, stale-heartbeat,
   and authority-ceiling cases.
5. Move the autonomous consumer and PR reconciler to `enforce` only after evidence is clean.
6. Broaden only to other evidence-cleared dogfood bindings. Customer/fleet authority requires
   separately corroborated portable evidence.

Emergency stop: set `DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE=off` and disable the downstream completion
and PR reconciler switches. Existing records and in-flight evidence remain available; no schema
rollback is required.

Disabling the canary prevents new autonomous runs but intentionally keeps immutable experiment
fixtures and decision evidence. Do not delete retained artifacts as a rollback step; a corrected
fixture uses a new logical version, while same-key byte drift remains a fail-closed integrity
signal.

## Verification checklist

- Confirm shadow mode creates observations but no new autonomous transitions.
- Confirm an active, exact-scope binding produces an execution profile reference on each phase.
- Confirm reviewed fixture approval creates one immutable TaskArtifact, all four factorial cells
  reference it, resume creates no duplicate, and the next replicate requires no additional click.
- Confirm malformed, changed, missing, non-shadow, and high-risk fixtures stop before cell
  dispatch; high-risk cases create neither an experiment artifact nor an execution workspace.
- Confirm stale/mismatched/missing bindings and high/regulatory cases park before mutation.
- Confirm recovery counters survive restart and exhaust into one escalation.
- Confirm exact-head PR compare-and-swap, unresolved-thread handling, queue enrollment, and human
  closure.
- Confirm sandbox drift is `blocked_sandbox_drift`, not a product red.
- Confirm merged work waits for governed self-upgrade and exact deployed-SHA evidence.
- Confirm the operator band in light/dark and narrow/wide viewports, including collapsed engineer
  details and stale-heartbeat attention.

## Design grounding

- Existing specs/plans reviewed:
  [governed playbook experimentation and autonomous Build Studio design](../superpowers/specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md)
  and its
  [implementation plan](../superpowers/plans/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-plan.md).
- Current code substrate reviewed:
  `work-pattern-activation`, `work-pattern-activation-persistence`,
  `work-pattern-effective-ledger`, `work-pattern-binding-reader`,
  `work-pattern-promotion-policy`, `work-pattern-experiment-store`,
  `work-pattern-experiment-runtime`, the experiment queue function, and
  `autonomous-build-eligibility-reader`.
- Source of truth: effective, non-superseded `DecisionShadowLedger` assignment and outcome
  evidence governs promotion; `AuthorityBinding` governs the active scope/model lane; `TaskRun`
  supplies lifecycle and parent/child status only.
- Decision: extend those substrates with fail-closed automatic same-install activation. Require
  complete, fresh, comparable evidence and `productionBuild=pass` for `build.implement`; preserve
  scoped rollback and authority-ceiling escalation; never synthesize qualifying build evidence.

## Related contracts

- [Build Studio autonomous lanes](../user-guide/build-studio/autonomous-builds.md)
- [Governed playbook experimentation and autonomous Build Studio design](../superpowers/specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md)
- [PR delivery recovery plan](../superpowers/plans/2026-07-27-build-studio-pr-readiness-merge-recovery.md)
- [Self-upgrade user guide](../user-guide/operations/self-upgrade.md)

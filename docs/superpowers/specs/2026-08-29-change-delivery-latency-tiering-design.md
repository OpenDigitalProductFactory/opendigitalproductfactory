---
status: active
---

# Change-delivery latency — tier by risk, fail open on infrastructure

- **Epic:** EP-ABB3AC9D
- **Backlog items:** BI-D908DA0A, BI-E58B57EC, BI-D088D06D, BI-8CDA7F95, BI-282AE0BC, BI-C09ECA63, BI-6332DD3D, BI-397EBDD6, BI-2C0A01CD
- **Decision ledger:** DI-0DD38401DF9F (`principle_decide`, high stakes, no commandment conflict)
- **Profile:** refactor
- **Authored:** 2026-08-29
- **Measured against:** `main` @ 97b32d3, host 192.168.0.152, window 2026-08-24 → 2026-08-29

## Problem

Getting a small correct change merged had grown to days. The working hypothesis
was that the guard surface caused it: 53 new `scripts/check-*.mjs` guards in six
weeks against a local-CI pool stuck at one slot.

The guard count is accurate. The cost attribution is not, and measuring it first
changed what this spec proposes.

### What was measured

Every figure below was produced by executing the thing, not by reading it.

| measurement | value | method |
| --- | --- | --- |
| Guards in the tree | 95 (+ 88 companion `.test.mjs`) | `find scripts -maxdepth 1 -name 'check-*.mjs'` |
| Added since 2026-07-18 | 55 of 95 — surface grew 40 → 95 | first-add commit per file |
| **All 95 guards, serial** | **76.3s** | each guard executed once against clean `main` |
| **The 55 recent guards** | **17.9s** | same run, partitioned by add date |
| Per-guard cost | median 155ms, p75 517ms, p90 1160ms | same run |
| Guards under 200ms | 52 of 95, 3.9s in total | same run |
| Host guard-parity preflight | **51.3s**, 52 entries, 60 commands | `node scripts/pregate-preflight.mjs` |
| Single-slot hold | p50 **776s**, p90 1113s, max 4924s | 301 `NonProductionEnvironmentLease` rows |
| Single-slot queue wait | p50 0s, p90 **1053s**, max 3666s | same rows |
| Slot utilisation | **45.1%** (55.8 slot-hours / 123.8h) | same rows |
| Cloud CI, pull_request | median **10.1min**, p90 10.7min | 15 `ci.yml` runs |
| Cloud policy guards | 138s + 79s + 24s = **241s**, parallel | job durations, one PR run |
| Cloud critical path | **590s**, UX Route Sweep Runtime | same run |
| `web` typecheck | **98s** | `pnpm --filter web typecheck` |

**Guards are 9.8% of the median slot hold.** Retiring every guard added since
July would return 18 seconds against a p90 queue wait of 1053 seconds. The waste
is real; it is not in the guards.

### Where the time actually goes

Three findings, each independently sufficient to explain the founder's report.

**1. One slot, 45% utilised, produces a 17-minute p90 wait.** Arrivals are
bursty. `PlatformConfig` key `local_ci.sandbox_pool` is absent — the table holds
21 keys and none is it — so `resolveLocalCiPoolPolicy` falls back to a singleton
with `rollbackReason: "config-absent"`. The slot manifest already defines
`slot-0` and `slot-1`. Running the real policy functions against this box's
measured memory returns `hostBuildCapacity: 2` and `hostStageCapacity: 2`; with
the config row present, `effectiveCapacity: 2` and `rollbackReason: null`.

The only code path that writes that key is
`contractLocalCiPoolAfterGateResult`, which moves capacity from 2 down to 1.
**No code path anywhere creates the row or raises capacity.** The pilot shipped
a rollback with no activation.

**2. Infrastructure failure is recorded as a verdict against the diff.**
`scripts/lib/pregate-status.mjs` emits five verdicts —
`NO-RECORD | STALE | PENDING | FAIL | PASS`. Anything with
`gatePassed !== true` becomes `FAIL`. The runner already knows better;
`resolveChildExit` in `local-ci-runner.mjs` prints, verbatim, that a
signal-killed child is "infrastructure evidence, not a product build failure".
That classification is captured at the point of failure and discarded at the
point of reporting.

The two paths in `pregate.mjs` that handle the same event disagree:

| wrapper killed while | writes | lease | outcome |
| --- | --- | --- | --- |
| **queued** | `status: "queued"` | preserved | revives |
| **running** | `status: "failed"` | released | terminal, poisons the SHA |

**3. A third of every commit is process, not product.** Across 60 merged PRs
and 200 commits: 67.5% substantive, 14.5% base resyncs, 17.0% commits added
only to satisfy a gate, 1.0% titled literally
`chore(ci): retry infrastructure-blocked gate`. On PRs touching ten files or
fewer, 1-commit branches take 0.35h from first commit to PR open; 9-or-more-commit
branches take **27.04h** at comparable size.

The resyncs are a second-order effect of finding 1. A branch that waits 17
minutes for a slot and holds it for 13 is a branch whose base has moved.

### The duplication

Comparing the host preflight command set against `POLICY_GUARD_PROFILES` by
exact string:

```
PREFLIGHT commands                          60
preflight commands ALSO in ANY profile      60 / 60
preflight-only commands                      0
```

Every assertion is evaluated on the host, again in the sandboxed gate, and again
in the cloud. In the cloud that is nearly free — 241s of parallel work inside a
590s critical path it never extends. On the host it is serial, and the sandboxed
re-run happens while holding the contended slot.

A further 79 of 142 profile commands (56%) are guards testing themselves rather
than checking the diff.

### The tiering already exists, and one stage ignores it

AGENTS.md §4 states the rule, and two of three stages implement it. The cloud
branches on `docsOnly`/`mobileOnly`/`heavy` via `scripts/ci-change-scope.mjs`.
The local gate runs `runPreAdmissionDocumentationLane`, so a docs-only change
produces evidence without taking a slot.

`buildPreflightPlan()` takes no changed-files argument. It returns the same 52
entries for a one-line markdown edit as for a migration. The classifier exists,
gives the right answer when called directly, and this stage never calls it.

### The guard surface cannot be reviewed on its merits

The question this investigation was asked to answer for each of the 53 new
guards — what defect motivated it, and has that class recurred — is not
answerable from the substrate. Of the 88 distinct `BI-*` ids cited across all 95
guard headers, **1 resolves in the live backlog and 87 do not**.

The cause is not a filing error. The live backlog's oldest row is dated
2026-08-22 and the guards date from 2026-05-20, so every citation predating the
reset points at a row that was not carried across. Each citation was correct
when written.

Two consequences. A guard's cost/benefit cannot be argued from the substrate, so
this spec argues it from measured cost and from stage reachability instead. And
`check-doc-anchor-existence` fails any document that quotes the history — the
first commit of this spec's own audit failed with 69 `does NOT exist` lines for
citations that were all accurate when written. Filed as BI-2C0A01CD; the audit
now cites the durable add-commit instead.

### Why Codex is worse

The gates are surface-neutral. The advance warnings are not. Hook scripts
actually reaching each surface: **Claude 22, Grok 13, Codex 10**. The twelve
Claude has and Codex lacks are, without exception, prechecks that predict a gate
refusal before a commit exists — `design-grounding-precheck`,
`spec-plan-doc-precheck`, `ux-fit-precheck`, `root-clone-freshness`,
`worktree-readiness-banner`, and seven more.

Claude is told at edit time for nothing. Codex learns the identical fact by
queueing for the slot, holding it, and failing — roughly 30 minutes for a
zero-second warning. Three hand-maintained registries with no shared source
produced this; nothing checks that they agree.

## Research

AGENTS.md §7 requires comparing open-source leaders and stating what DPF adopts
or rejects. Three projects solve exactly the three findings above, and each has
been solving them at far larger scale for longer.

### Chromium — LUCI CQ

Chromium's commit queue treats **`INFRA_FAILURE` as a build status distinct from
`FAILURE`**. A builder that dies because a bot ran out of disk, a service
timed out, or an isolate could not be fetched does not produce a verdict on the
CL. CQ retries it automatically within a configured budget, and the CL's
verdict is only ever computed from statuses that describe the change. CQ also
supports `experiment_percentage`, which runs a builder on a sampled fraction of
CLs so an expensive or still-stabilising check can gather signal without
gating every change.

Zuul (OpenStack) reaches the same conclusion independently, with a `RETRY`
result and a `RETRY_LIMIT` terminal state, so that "the job could not run" and
"the job found a defect" are never the same word.

**DPF adopts:** a first-class `INCONCLUSIVE` verdict alongside the existing
five, written whenever the runner has already classified the cause as
infrastructure. The running path in `pregate.mjs` recovers exactly as the queued
path already does. An `INCONCLUSIVE` run does not consume the SHA's verdict and
re-runs on the same SHA. DPF also adopts the sampling idea for the small number
of guards that cost more than a second, so they gather signal without paying
full cost on every push.

**DPF rejects:** unbounded automatic retry. DPF's failure taxonomy shows
starvation can be sustained rather than transient, so a bounded retry with an
honest `INCONCLUSIVE` after exhaustion is correct where a silent retry loop is
not. This is the same conclusion BI-9DC21917 reached from the opposite
direction — fencing a *transient* probe miss as sustained starvation is the
symmetric error.

### Kubernetes — Prow and Tide

Prow presubmits declare their own path scope. A job carries `run_if_changed` or
`skip_if_only_changed` regexes, and the job simply does not run when the diff
does not intersect. The scope is declared next to the job, so adding a job and
declaring what it reads are one edit. Tide then merges PRs in batches, testing
`main + PR1 + PR2 + …` once to amortise the expensive merge test.

**DPF adopts:** per-guard declared input scope. Each `scripts/check-*.mjs` gains
an exported `inputs` glob list, and the preflight intersects that against the
diff using the `ci-change-scope` classifier the cloud already trusts. This makes
the tiering property that AGENTS.md §4 already asserts actually true at the one
stage that ignores it, and it makes reachability checkable — a guard with no
declared inputs is a guard nobody can tier.

**DPF rejects:** Tide-style batch merging. DPF's merge volume does not justify
it, and a batch failure requires bisection to attribute — producing exactly the
"which change was it" ambiguity that DPF's evidence contract exists to remove.
The cost Tide amortises is the cloud merge queue, measured here at 10.3 minutes
and not a bottleneck.

### Bazel — the remote action cache

Bazel keys every action on a hash of its command line, its declared input file
contents, and its environment. An action whose key has been seen is never
re-executed; the stored result is returned. Correctness rests entirely on inputs
being **declared** — an action that reads an undeclared file gets a stale hit,
which is why Bazel enforces sandboxing.

**DPF adopts:** content-addressed guard results. Once each guard declares its
inputs (the Prow-derived change above), a guard result can be keyed on the hash
of the guard file plus the contents of its declared inputs. An unchanged pair is
a cache hit, and the three-times-per-push duplication collapses to
once-per-distinct-tree-content. This is the principled version of "stop running
it three times"; it removes the repetition without removing the assertion, so no
guarantee is weakened.

**DPF rejects:** remote execution. Verification would depend on an external
service, which contradicts DPF's local-first operating stance and scored against
`operational_independence` in the kernel ledger. The cache is local.

**Carried constraint from DPF's own history:** BI-7B249AFE records that
stripping `.test.mjs` commands from the preflight produced a false green on a
tree CI failed deterministically, because some of those files are conformance
assertions reading live repository state rather than unit tests of guard logic.
Bazel's lesson is the same lesson: caching and skipping are only safe over
**declared** inputs. Self-test classification is therefore a prerequisite for
the caching work, never a shortcut around it.

## Decision

Routed through `principle_decide` as an `external_coding_agent` platform
decision at `high` stakes, four options scored:

| option | composite | outcome |
| --- | --- | --- |
| **capacity-honesty-tiering** | **13.654** | **recommended**, margin 4.119, confidence high |
| capacity-only | 9.535 | insufficient — leaves the retry loop intact |
| cloud-only-verification | 4.182 | loses `operational_independence` and the evidence contract |
| reduce-guard-surface | 2.291 | lowest of four |

`commandmentConflict: false`, `autonomyEligible: true`, structured coverage
strong, zero flipping principles under ±0.1 sensitivity. Ledger
`DI-0DD38401DF9F`.

Strongest contributors to the recommendation were *Research and Use Standards*,
*Ground New Work In Existing Platform*, *Single Source of Truth* and *Verify
substrate before proposing new* — all of which favour the option that reuses the
already-built classifier, the already-provisioned second slot and the
already-computed infrastructure classification rather than adding substrate.

**Decision: keep all 95 guards. Attack serialisation, duplication and dishonest
verdicts.**

### Capacity belongs to the installation, not to the image

This host runs the **Docker image install path under test** — a consumer install
shape being dogfooded — while also being the machine that develops the platform.
Those two roles want opposite resource envelopes, and the numbers that decide the
envelope live in `local-ci-slot-resources.json`, which ships inside the image.
One set of bytes, two incompatible jobs.

Two tempting answers are both wrong. **Changing the install shape** would
invalidate the very thing under test and would be wrong for real consumers.
**Adding a manual capacity setting** is the original defect in a new costume: the
pool's whole problem is that it has no activation path, and a switch a consumer
never finds and a developer must hand-author JSON to flip does not fix that.

The installation already declares what it is, and both declarations are already
populated here:

```
installation.environment-class.v1  -> "development"
installation.operating-intent.v1   -> primaryPurpose "evolve-dpf", confirmed
host_profile                       -> 63.7 GB RAM, 24 cores    (written by the installer)
container_profile                  -> 12 CPUs, 24033 MB        (refreshed every portal boot)
```

The pool policy reads none of them. So capacity gains a derived tier, mirroring
the four-tier precedence `environment-class` already uses:

| rank | source | set by |
| --- | --- | --- |
| 1 | `DPF_LOCAL_CI_POOL_CAPACITY` break-glass | operator, per-process — existing |
| 2 | explicit `local_ci.sandbox_pool` row | operator — existing, and the override |
| 3 | **installation-profile** | derived from the declaration — new |
| 4 | compatibility singleton | nothing declared |

A `development` installation whose declared job is `evolve-dpf` requests the
capacity its host can carry. Every consumer install, every production install,
and any installation that has not declared itself keeps the singleton —
`UNDECLARED_ENVIRONMENT_CLASS` is `production`, so silence resolves to the
conservative answer. Host headroom, the pilot guardrails and the circuit breaker
still clamp the result and can only reduce it.

One image, correct for both shapes, and no operator action on either.

### The uncalibrated number underneath it

Deriving capacity is still not enough on its own: it returns
`host-stage-capacity-one`. Two independent memory tests gate admission and they
read **different machines**.

| test | reads | reserve per slot | verdict |
| --- | --- | --- | --- |
| `localCiBuildHeadroomCapacity` | Docker VM | 10 GiB, calibrated | 2 |
| `localCiHostStageHeadroomCapacity` | Windows host | 8 GiB, **never calibrated** | 1 |

`builderPolicy` carries an `admissionCalibration` block and reserves
`min(16 GiB ceiling, 10 GiB calibrated)` against an 8 GiB observed high-water.
`hostStagePolicy` carried no calibration at all — a flat 8 GiB. Measured
2026-08-29, peak combined node working set on the Windows host during the
heaviest host-side stage was **2.27 GiB** over idle baseline: a 3.5x
over-reservation, and the sole reason a 63.7 GB host admitted one slot.

Calibrating it to 6 GiB — 2.6x the measured peak — admits two. Filed as
BI-E58B57EC.

### Nothing checks CPU

Each builder is capped at 8 CPUs (`cpuQuota: 800000 / cpuPeriod: 100000`); the
Docker VM reports 12. Two slots request a 16-CPU ceiling against 12, and no code
path compares requested quota to available CPUs. The Windows CPU probe is also
structurally dead: `sustainedCpuPercent` is `loadavg()[0] / cpus().length`, and
`os.loadavg()` returns `[0,0,0]` on Windows, so that half of the ceiling reads 0%
and can never fire.

Quotas are ceilings rather than reservations, so this degrades rather than fails.
Replaying the trace with service time inflated for 8 CPUs becoming ~6: two slots
still beat one end-to-end at +40% (1642s vs 2063s p90 wait-plus-hold), with
break-even near +55 to 60%. An 8-to-6 shift is 25 to 33%. The gain survives the
contention — but the contention should be modelled rather than discovered, so a
CPU-count admission test is in scope.

### The tiering contract

Four tiers, each defined by what it may depend on. The rule that keeps them
honest: **a check may only run in a tier whose dependencies it already has.**

| tier | may depend on | budget | contents |
| --- | --- | --- | --- |
| **0 — edit time** | the file being edited | instant | prechecks, all four surfaces, no exceptions |
| **1 — pre-commit** | the working tree | ≤ 30s | derived artifacts, secret scan, private-identity, scoped typecheck |
| **2 — pre-push** | the tree and the diff | ≤ 60s | guards whose declared inputs intersect the diff, cache-missed only |
| **3 — sandboxed gate** | a lease, a database, an image | ≤ 15min, ≥ 2 slots | migrations, full suite, production build |
| **4 — cloud** | nothing local | parallel, off the critical path | everything, unconditionally, as the safety net |

Tier 4 remains complete and unsampled. Every guard still runs on every change
before it merges — that is what preserves the guarantees. What changes is that
tiers 2 and 3 stop re-proving what tier 4 will prove anyway, on the one machine
where proving it costs a queue position.

### Fail-closed on safety, fail-open on infrastructure

Stated as an invariant that a guard can enforce:

> No code path may write a terminal `gatePassed: false` for a condition the
> runner has classified as infrastructure. A gate that could not run reports
> `INCONCLUSIVE`, names the recorded reason, and leaves the SHA re-runnable.

Commandment-tier checks — auth, DCO, secret scanning, migration safety — are
explicitly out of scope for every tiering, sampling and caching change in this
spec. They run in every tier they run in today.

## Scope — this change

1. **BI-D908DA0A** — governed activation surface for the pool config row; seed
   an explicit `requestedCapacity: 1` at install so `config-absent` stops being
   the silent path; expose `effectiveCapacity` and `rollbackReason` on an
   operator surface. Replay says capacity 2 removes 21.7 of 23.8 queued hours.
2. **BI-D088D06D** — add the `INCONCLUSIVE` verdict; make the running path in
   `pregate.mjs` recover as the queued path does. Ships with BI-0F2E42D5 and
   BI-A7EAB5AA, which fix the same injustice at the evidence-projection layer.
3. **BI-8CDA7F95** — per-guard declared `inputs`; preflight intersects them
   against the diff via `ci-change-scope`.
4. **BI-282AE0BC** — classify self-tests (unit vs conformance), then key guard
   results on guard-file plus declared-input content.
5. **BI-C09ECA63** — one declared precheck registry, four thin adapters, and a
   parity guard that fails on undeclared drift.
6. **BI-6332DD3D** — resolve the one unreachable guard, and add reachability
   enforcement so a guard cannot be added to nothing.

Order matters: 1 and 2 are independent and deliver most of the wall-clock; 3 is
a prerequisite for 4; 5 and 6 are independent.

## Deliberately not in this change

- **No guard is retired.** The inventory recommends keeping 81 of 95 as-is;
  the remainder move tier, gain a self-test, or record their defect class.
  `check-obligation-cadence-coverage` is resolved, not deleted.
- **Commandment-tier checks are untouched** — auth, DCO, secret scanning,
  migration safety.
- **The cloud tier is not reduced.** It is the safety net and it is not on the
  critical path.
- **Pool capacity above 2.** `LOCAL_CI_MAX_CAPACITY` is 2; the replay shows 2
  already captures 91% of the available benefit. Raising the constant is a
  separate decision with its own evidence.
- **Readiness governance** — see below; it is adjacent and needs its own
  ratification.

## Adjacent: readiness governance in the merge path

`BI-F0715C9C`, `BI-53C26E60`, `BI-310EC5AF` and `BI-28E8CB88` describe a
circular blocker: plan-backlog coverage needs an initiative scope baseline, the
baseline needs an independent spec-approval review, and **71 of 76 seeded
coworkers have no Principal**, so every independent review lane is structurally
unsatisfiable. The gate that enforces it regex-matches a Receipt line rather
than asking the substrate.

While writing this spec, a further finding fell out of running that gate against
this spec's own plan. `check-plan-backlog-coverage.mjs` decides **whether it
applies** by string-matching the plan's prose:

```js
const itemId = text.match(/\*\*Backlog item:\*\*\s*`?(BI-[A-Z0-9-]+)`?/i)?.[1] ?? null;
if (!itemId) return { ok: true, errors: [] };
```

The plan accompanying this spec was committed with `Receipt: pending` and no
`## Backlog coverage` section at all, and the gate reported
"1 changed plan(s) carry complete coverage evidence. OK." Adding the literal
string `**Backlog item:**` and changing nothing else flips it to a failure.
Filed as BI-397EBDD6.

So the same gate is **impossible to satisfy honestly** — BI-F0715C9C, no
mintable receipt — and **trivial to avoid accidentally**. Both halves have one
repair: ask the substrate rather than the Markdown.

This spec's position, offered for ratification rather than asserted: **readiness
governance is an attribute of the backlog item, not a precondition of the merge.**
Blocking a merge on a reviewer lane that cannot pass is pure latency, and a gate
satisfied by prose while a real receipt cannot be minted is a gate that
measures nothing. Moving it to the backlog item asynchronously keeps the
obligation and removes it from the critical path.

That is a governance change, not a latency fix, so it is named here and left to
its own decision under EP-129D11FD rather than folded in.

## Verification

- The pool change is proven by the same replay that produced the baseline: seed
  the row, then re-measure queue-wait percentiles over the following week
  against the 1053s p90 recorded here. The circuit breaker provides rollback.
- The `INCONCLUSIVE` change is proven by a test that kills the wrapper on the
  running path and asserts the SHA remains re-runnable — the queued-path
  equivalent already exists.
- Tiering and caching are proven by re-running the preflight against the three
  PR shapes and asserting entry counts differ, plus a mutation check: perturbing
  a guard's declared input must produce a cache miss.
- Surface parity is proven by a guard that diffs the three hook registries and
  fails on undeclared drift.

The measured baseline these are compared against:
https://claude.ai/code/artifact/05d0d22a-9fb6-4530-9fad-9baccbfec72c

## Target service level

Stated in plain numbers, because a redesign without a success criterion cannot
be evaluated:

- **A docs-only change merges in under 20 minutes.**
- **A source change merges in under 40 minutes.**
- **No change is ever blocked by an infrastructure verdict.** A gate that could
  not run says so, and re-runs on the same SHA.
- **Process overhead falls below 10% of commits**, from the 32.5% measured here.
- **Surface parity is exact**: every precheck reaches all four surfaces, or its
  absence is declared.

## Risk

- **Two slots on one box.** Utilisation is 45% and the admission reserve is the
  calibrated 10 GiB rather than the 16 GiB cgroup ceiling, so two fit in the
  measured 20.5 GiB of Docker `MemAvailable`. If the calibration is wrong the
  circuit breaker contracts to 1 automatically — the rollback is the one part of
  this pilot that already shipped.
- **A wrong `inputs` declaration produces a false green.** This is the
  BI-7B249AFE failure mode. Mitigated by tier 4 remaining complete and
  unconditional: a mis-scoped guard is caught in the cloud before merge, so the
  worst case is a late failure, never a merged defect.
- **`INCONCLUSIVE` could mask a real failure** if the classifier is too eager.
  Mitigated by writing it only where the runner already recorded an
  infrastructure cause, never as a default for an unexplained exit.

## Rollback

Each item is independently revertible. The pool row can be contracted by the
existing circuit breaker or deleted, returning to `config-absent`. The
`INCONCLUSIVE` verdict is additive; consumers unaware of it see the same
`FAIL`-or-`PASS` set until they opt in. Tiering and caching are keyed by a
declaration, so removing the declaration restores the current always-run
behaviour.

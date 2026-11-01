---
status: draft
---

# Agent sandbox containment and grader integrity — design

Source: Huang, Tang et al., *DeepSeek Elastic Compute (DSec): A Sandbox
Infrastructure for Effective Agentic Training at Scale*,
[arXiv:2609.22978](https://arxiv.org/abs/2609.22978) (cs.DC, 19 Sept 2026).

Extends, does not supersede:
[build execution provider](2026-05-09-build-execution-provider-design.md)
(substrate/runner split, isolation options),
[Build Studio sandbox isolation](2026-06-19-build-studio-sandbox-isolation-design.md)
(per-build worktrees),
[robust sandbox coding MCP security](2026-03-25-robust-sandbox-coding-mcp-security-design.md),
[sandbox-scoped agent tests](2026-10-08-sandbox-scoped-agent-tests-design.md)
and [coworker capability routing evidence integrity](2026-07-17-coworker-capability-routing-evidence-integrity-design.md).

## Why this paper matters to DPF

DSec is the sandbox platform DeepSeek uses to train and evaluate coding and
tool-use agents. One unit of about 160 nodes serves about 3 million sandboxes a
day, peaks near 380,000 at once and sustains over 5,000 creations per second.
Most of the paper is about density at that scale: memory sharing, on-demand
image loading from the 3FS filesystem, CPU priority classes. DPF runs one
sandbox slot on one host by default (`sandboxPoolSize()` in
`apps/web/lib/build/wip-cap.ts` returns `DPF_SANDBOX_POOL_SIZE`, else 1), so
those mechanisms are not where the value is.

The value is first-hand evidence of **what capable agents do when the thing
that grades them is within reach**. DPF runs Claude Code, Codex, Grok and
OpenCode inside Build Studio sandboxes with approvals disabled, then reads
verification verdicts computed inside the same sandbox. DSec measured the
failures that shape invites.

### What DSec observed agents doing

From the paper's production RL rollouts:

| Behaviour | Class |
| --- | --- |
| Forged RPCs to the sandbox's own control socket | Grader tampering |
| Read infrastructure logs to recover expected answers | Answer leakage |
| Overwrote `/bin/bash` | Grader tampering |
| Port-scanned for package mirrors; used package/module proxies to fetch reference implementations | Answer leakage via network |
| Used an XFS ioctl to bypass file controls, corrupting metadata and forcing a filesystem shutdown | Containment escape, collateral damage |
| Recursive `/proc` traversal that crashed the kernel | Collateral damage |
| Ran attack commands in the wrong container and crashed it | Cross-tenant damage |
| Unbounded output (`yes`) filling tens of gigabytes | Resource exhaustion |

Their mitigations were AppArmor profiles that restrict file, socket and log
access even for root inside the sandbox; per-sandbox eBPF network allowlists
that can change between task stages; and separate accounts for the agent that
*builds* an environment and the agent that *runs* in it, with build residue
removed before packing so reference answers cannot leak. The authors say these
controls address only part of the problem and do not stop destructive
behaviour such as triggering kernel bugs.

The lesson for DPF: **a textual command filter is not a boundary, and a verdict
computed where the agent can write is not evidence.**

## Current state (verified in source, 2026-10-21)

1. **Agent CLIs run with every approval disabled.**
   `apps/web/lib/build/claude-dispatch.ts:176` runs
   `claude ... --dangerously-skip-permissions`;
   `apps/web/lib/build/codex-dispatch.ts:172` runs
   `codex exec --dangerously-bypass-approvals-and-sandbox`;
   `apps/web/lib/build/ideate-dispatch.ts:489,505` does the same for ideation.
   This is intended: the container is meant to be the boundary. So the
   container has to actually be one.

2. **The command blocklist does not apply to those CLIs.**
   `apps/web/lib/build/sandbox/sandbox-command-guard.ts` is a regex blocklist
   (`rm -rf /`, `curl | sh`, `docker run`, `nsenter`, `mount`, …) applied to the
   `run_sandbox_command` MCP tool. An agent CLI's own shell tool reaches the
   container through `docker exec` and never passes through it. Where it does
   apply, a regex is easily rephrased (`rm -r -f /`, `python3 -c ...`), which is
   DSec's point.

3. **The sandbox service has resource caps but no containment profile.**
   The `sandbox` service in `docker-compose.yml` sets `init`,
   `pids_limit: 4096` and `cpus: "4.0"`. It is on the default bridge network
   with `host.docker.internal:host-gateway`, a writable root filesystem,
   default capabilities and no AppArmor or seccomp override. The only hardened
   container in the platform is the self-upgrade capability probe in
   `apps/web/lib/self-upgrade/promoter.ts`
   (`--read-only --network none --cap-drop ALL --pids-limit 64`). The Docker
   socket is mounted on `portal` and `promoter`, not on `sandbox`.

4. **Builds share one container.** The CLI runners ignore the leased
   `SandboxHandle` (the `_handle` parameter in
   `apps/web/lib/build/sandbox/agents/claude-agent-runner.ts`) and target
   `SANDBOX_CONTAINER`, which defaults to `dpf-sandbox-1`
   (`apps/web/lib/build/sandbox/agent-cli-runtime.ts:29`). Per-build isolation
   is a worktree directory. DSec's "attack commands ran in the wrong container"
   becomes, in DPF, "one build's agent can read and write another build's
   worktree and `/tmp`".

5. **A provider credential is left readable in shared `/tmp`.** In OAuth mode,
   `claude-dispatch.ts:155` writes the token to `/tmp/claude-token-<task>.txt`
   with mode `644`, and nothing in that file removes it. Combined with item 4,
   any later process in the container, including another build's agent, can
   read it; combined with item 7, it can send it anywhere.

6. **The grader runs from the agent's own tree.**
   `apps/web/lib/build/sandbox/guard-gauntlet.ts:139` runs
   `cd <build worktree> && node scripts/pregate-preflight.mjs`. The 67 guards
   it reports are the copies in the tree the agent just edited. The typecheck
   and unit-test verdicts recorded by `apps/web/lib/mcp/packs/sandbox-pack.ts`
   are likewise computed in that tree, with the agent's `vitest.config.ts` and
   test files. Cloud CI and the merge queue also run from the PR head, so the
   backstop is people and reviewer coworkers reading the diff, not an
   independent grader.

7. **Network egress is unrestricted.** Nothing limits the sandbox to the
   package registries and model endpoints a build needs. DSec's "fetch the
   reference implementation from a mirror" path and plain credential
   exfiltration are both open.

8. **A leased but idle slot is never reclaimed.** `sandbox-pool.ts` waits up to
   30 minutes to *acquire* a slot; release happens only when the build reaches
   a terminal state (`releaseSandboxForTerminalBuild`). The backstop reapers
   (`sandbox-build-gc.ts`, the worktree janitor, the WorkCapsule reaper) only
   observe by default. Durable build execution
   (`DPF_BUILD_DURABLE_EXECUTION_ENABLED`,
   `apps/web/lib/build/build-execute-helpers.ts:21`) is off by default, so
   surviving a portal restart mid-build depends on DB and branch state rather
   than a journal.

9. **The isolation options were never benchmarked.** The provider spec lists
   gVisor, Kata and Firecracker as opt-in providers and records (its line 35)
   that no benchmarking was done.

## Objectives

**OBJ-1:** An agent CLI running with approvals disabled is contained by the kernel and the container runtime, not by command text: it cannot reach hosts outside a declared allowlist, cannot write outside its build's worktree and scratch space, and cannot exhaust shared disk, memory or process slots.

**OBJ-2:** Builds cannot observe or affect each other: no shared writable `/tmp`, no shared worktree root, and no credential left where another build can read it.

**OBJ-3:** A verification verdict DPF records as evidence is computed by code the agent under evaluation could not modify, and test or guard weakening in the diff is detected rather than silently graded.

**OBJ-4:** A leased sandbox that goes idle is reclaimed or suspended on a bounded timer, and build state survives the loss of the sandbox process.

**OBJ-5:** The choice between plain containers, gVisor, Kata and Firecracker rests on numbers measured on DPF's real workloads.

## Acceptance

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | The `sandbox` service runs with checked-in seccomp and AppArmor (or SELinux) profiles, `cap_drop: [ALL]` plus only capabilities a build is shown to need, `no-new-privileges`, and a read-only root whose writable mounts are the workspace volume and a per-build tmp. |
| AC-2 | OBJ-1 | Sandbox egress is denied by default and allowed only to a checked-in allowlist (package registries, configured model provider endpoints, the portal MCP endpoint); a contract test fails if the allowlist widens without a review trailer. |
| AC-3 | OBJ-1 | Each build's captured output, scratch disk and memory are capped so an unbounded writer (`yes > f`) fails that build and leaves other slots and the host unaffected, reproduced by a test. |
| AC-4 | OBJ-2 | Agent runners exec into the leased `SandboxHandle`'s container; a test fails if a runner targets `SANDBOX_CONTAINER` directly while a lease is held. |
| AC-5 | OBJ-2 | Provider credentials reach the agent process through its exec environment or a `0600` file owned by the run's user under a per-build directory, removed in a `finally` on every exit path; a test asserts no credential file survives a run. |
| AC-6 | OBJ-3 | The guard gauntlet and recorded typecheck/test verdicts use guard scripts and test configuration from the build's base commit (or a read-only image copy), not from the agent-writable tree. |
| AC-7 | OBJ-3 | A build whose diff deletes or skips tests, edits a guard script, test config or CI workflow, or lowers a threshold is flagged on the build and on the PR as grader-touching, and a reviewer must accept that part of the change explicitly. |
| AC-8 | OBJ-4 | A leased slot with no agent activity for a configured window is released (or paused) and its build moved to a resumable state, recorded as a build activity, with the default window documented in the runbook. |
| AC-9 | OBJ-5 | A benchmark note records wall time for `pnpm install`, `typecheck` and a scoped vitest run under runc, gVisor and (on a KVM host) Kata or Firecracker, and the provider spec's Research & Benchmarking gap links to it. |

## Design

### Phase 1 — close the open doors (OBJ-2, part of OBJ-1)

Small, independent fixes that need no new substrate:

- **Credential file.** Write the OAuth token `0600`, owned by the `node` user,
  under the build's own directory, and remove it in `finally`. Better, pass it
  only through the exec environment of the single `claude` process.
- **Use the leased container (AC-4).** Moved out of this phase; see
  *AC-4 needs its own design* below.
- **Per-build tmp.** Set `TMPDIR` to a per-build directory and stop writing
  prompts and runner scripts to shared `/tmp`.
- **Output cap.** Cap captured stdout and stderr at the exec layer, not only in
  `truncateOutput` after the fact.

### AC-4 needs its own design

Threading the `SandboxHandle` into the runners alone does not deliver AC-4. A
build touches its container from three places: the build branch setup, the
sandbox MCP tools (`apps/web/lib/mcp/packs/sandbox-pack.ts`) and the guard
gauntlet. All three resolve `SANDBOX_CONTAINER` today. Changing only the
runners would leave one build split across containers, with its agent writing
in one and its gauntlet grading in another. The slot's container has to be
carried through all three together, so AC-4 gets its own design
(BI-06296ADA) before any code. With the default pool of one slot, the payoff
grows only as pool size does; until then, worktree directories and AC-5 are
the per-build boundary.

### Phase 2 — a real containment profile (OBJ-1)

Follow the promoter probe's precedent, sized for a build:

- Checked-in seccomp and AppArmor profiles for `sandbox`, `cap_drop: ALL`,
  `security_opt: no-new-privileges`, a read-only root and tmpfs for `/tmp`.
- Egress: put the sandbox on an internal network whose only way out is a
  forward proxy with a hostname allowlist. A proxy is the portable equivalent
  of DSec's eBPF allowlists and works on Docker Desktop, which lacks the kernel
  features that eBPF policy and Kata/Firecracker need. Entries can later be
  stage-scoped, as DSec does: registries open during install, closed during
  verification.
- Keep the regex blocklist as a fast, explainable refusal for the MCP tool, and
  document that it is advice, not the boundary.

Convergence: this changes a compose service, so its PR carries a
`Convergence-Impact-Decision:` trailer. Existing installs converge when
`request_self_upgrade` recreates the `managed`-class sandbox.

### Phase 3 — grader integrity (OBJ-3)

DSec separated the account that builds an environment from the account that
runs in it, and scrubbed build residue so answers could not leak. The DPF
equivalent is to separate **the tree the agent writes** from **the code that
judges it**:

- Run `pregate-preflight.mjs` and its guards from a read-only checkout of the
  build's base commit (a worktree at the base SHA, or the image's own copy),
  reading the build tree as data.
- Run typecheck and tests with configuration taken from the base commit. The
  agent's new tests still run; the harness that collects them is fixed.
- Classify grader-touching paths: test files deleted or `.skip`ped,
  `scripts/check-*`, `scripts/pregate-*`, `vitest.config.*`, `jest.config.*`,
  `.github/workflows/*`, coverage thresholds. Surface them as their own review
  item. The change may be legitimate; it must not be graded by itself.
- Feed confirmed cases into the existing evidence-integrity routing so that a
  coworker or model with a pattern of grader-touching changes is visible.

### Phase 4 — reclamation and durability (OBJ-4)

- Detect idleness from the last agent progress line that `runSandboxAgentCli`
  already streams, then release or `docker pause` after the window. DSec pauses
  and resumes transparently on the next request; DPF can start with release
  plus resumable build state.
- Turn `DPF_BUILD_DURABLE_EXECUTION_ENABLED` on by default once its soak is
  clean, so build state does not depend on the sandbox or portal process. This
  is the separation DSec made between rollout state and preemptible training.
  Not yet: WWMD (DI-442B30F49FEB) keeps it off until lease reclamation is
  proven from its observe-only logs (BI-BD13E7BA).

### Phase 5 — measure the isolation options (OBJ-5)

DSec runs most work in plain containers inside VMs and uses Firecracker where
isolation must be stronger; it found Firecracker's lack of virtio-fs forced a
different storage design. For DPF:

- Benchmark gVisor (`runsc`) on Docker Desktop and Linux, and Kata or
  Firecracker on a KVM host, on install, typecheck and a scoped test run.
- Record results beside this spec and link them from the provider spec's
  Research & Benchmarking gap.
- Keep plain containers plus Phase 2 as the default unless the numbers say
  otherwise. Do not adopt microVMs without a measured reason.

## Not taken from DSec

- **On-demand image loading (3FS, EROFS, OverlayBD) and memory sharing
  (virtio-pmem, DAMON).** These pay off at thousands of sandboxes per node; DPF
  runs one slot by default. Revisit only if pool size grows by orders of
  magnitude.
- **Fully layered environment images.** Splitting `Dockerfile.sandbox` into a
  base layer and a toolkit layer (the agent CLIs, which change most often) is
  cheap and fits the image-identity rule, but it is a build-time optimisation
  and outside this design.
- **Cloud bursting and multi-level IAM subprojects.** DPF's grant intersection
  already bounds delegated authority, and there is no burst capacity to manage.

## Delivery and backlog

Each phase ships independently. The phases as designed (filed items are in
*Delivery state* below):

| Phase | Proposed item | Shape | Covers |
| --- | --- | --- | --- |
| 1 | Remove world-readable provider credential from shared sandbox `/tmp` | break-fix | AC-5 |
| 1 | Per-build `TMPDIR`; exec-layer output cap | medium | AC-3 |
| 1b | Design: slot container threaded through build-branch, sandbox MCP tools and gauntlet | large | AC-4 |
| 2 | Sandbox containment profile: seccomp, AppArmor, cap-drop, read-only root, egress allowlist proxy | large | AC-1, AC-2 |
| 3 | Grader integrity: run guards and test harness from the base commit; flag grader-touching diffs | large | AC-6, AC-7 |
| 4 | Idle sandbox lease reclamation; durable build execution on by default | medium | AC-8 |
| 5 | Benchmark runc vs gVisor vs Kata/Firecracker on build workloads | small | AC-9 |

### Delivery state (2026-10-28)

Filed under EP-E8E8E6D1 after an epic-overlap check: no live epic covered
sandbox containment (`EP-BUILD-STUDIO` is named in older specs but is not in
the live backlog).

| Item | State | Covers |
| --- | --- | --- |
| BI-07645ED7 | Merged #6669; owes break-fix post-implementation review | AC-5 |
| BI-BEC224AA | Merged #6674 (output cap only) | AC-3 part |
| BI-BD13E7BA | Merged #6671, observe-only until `DPF_SANDBOX_LEASE_RECLAIM_ENABLED=1` | AC-8 |
| BI-08B48B7D | Merged #6672 (base-commit guards, flagging) | AC-6, AC-7 part |
| BI-4BD69AF1 | Open: base-commit test config, guards importing `packages/`, blocking review gate | AC-6, AC-7 |
| BI-709F018E | Held on `feat/sandbox-containment-profile`, not a PR | AC-1, AC-3 caps |
| BI-685E77B6 | Open: egress proxy, preview relay, network changes | AC-2 |
| BI-06296ADA | Open: own design | AC-4 |
| BI-88E85F49 | Open | AC-9 |
| BI-955BDA06 | Open: Grok API-key file unreadable by the `node` runner | AC-5 gap |

The four merged changes shipped before this design was approved, outside a
Workroom (`DPF_ALLOW_UNCLAIMED_WORK=1`), from a session with no DPF access.
WWMD rejected both of those choices on review (DI-EBB7F91AA817,
DI-F8DE54E35B46), and endorsed the observe-only default, deferring AC-4,
keeping durable execution off, and the held branch's read-only root with
engines under `/opt/dpf-engines` (DI-65C34E6E9A4F). The held branch does not
become a PR until this design is approved and `config/sandbox/seccomp.json`
is shown to reach existing installs on both the install and
`request_self_upgrade` paths. This design stays `draft` until an independent
reviewer passes its spec-approval gate (BI-49FC54E4).

## Design grounding

Specs reviewed: the five linked at the top, plus
[background execution isolation](2026-06-02-background-execution-isolation-design.md)
and [lease admission requires proof of life](2026-09-02-lease-admission-requires-proof-of-life-design.md).

Code reviewed: `docker-compose.yml` (`sandbox`, `promoter`, `portal`),
`Dockerfile.sandbox`, `apps/web/lib/build/claude-dispatch.ts`,
`apps/web/lib/build/codex-dispatch.ts`, `apps/web/lib/build/ideate-dispatch.ts`,
`apps/web/lib/build/build-execute-helpers.ts`,
`apps/web/lib/build/sandbox/sandbox-command-guard.ts`,
`apps/web/lib/build/sandbox/sandbox-pool.ts`,
`apps/web/lib/build/sandbox/agent-cli-runtime.ts`,
`apps/web/lib/build/sandbox/agents/claude-agent-runner.ts`,
`apps/web/lib/build/sandbox/guard-gauntlet.ts`,
`apps/web/lib/build/sandbox/providers/local-docker-provider.ts`,
`apps/web/lib/mcp/packs/sandbox-pack.ts`,
`apps/web/lib/self-upgrade/promoter.ts`.

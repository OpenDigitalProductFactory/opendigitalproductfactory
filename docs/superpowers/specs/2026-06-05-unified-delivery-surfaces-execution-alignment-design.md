---
status: binding
---



> **⇢ Coordination — Unified Work Graph.** This spec is a design input to the **Collaborative Work Management × Build Studio convergence**. Before starting work traced here, read the governing memo [`2026-07-11-collaborative-work-management-convergence-memo.md`](./2026-07-11-collaborative-work-management-convergence-memo.md) and backlog epic **EP-WORK-CONVERGENCE** (9 items, write-model-first). The target is one substrate — `WorkCapsule` / `WorkItem` → `WorkCase` projection → plain approve/revise — so efforts stay coordinated and don't diverge.

---
title: Unified Delivery Surfaces — one governed process, MCP coordination, execution alignment for Claude Code / Codex / Build Studio
status: accepted
date: 2026-06-05
owner: platform
relates:
  - docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md
  - docs/superpowers/specs/2026-05-09-build-execution-provider-design.md
  - docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md
  - docs/founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md
backlog:
  - BI-5B6C1C35  # image stamp != bytes != target
  - BI-DBF3F426  # worktree/runtime janitor for stale targets + unmanaged containers
  - BI-63C11CF7  # prevent worktree compose joining root dpf project
  - BI-66682EBA  # sanitized self-upgrade build context
---

# Unified Delivery Surfaces

> **Operator framing (2026-06-05).** "Build Studio is a 3rd delivery process like Claude and Codex, but more embedded." The Build Studio *process* is right; only its *runtime engine* has been unreliable. We want all three surfaces to run **one common process**, coordinate through **MCP servers regardless of Build Studio or not**, and **hide complexity from layman users**. We also want the doctrine aligned *precisely* to how Claude Code and Codex actually execute — worktree selection, sidecar/process lifecycle, sandbox use, and container discipline.

## 1. Thesis

DPF delivers software through **three interchangeable delivery surfaces**:

| Surface | Nature | Driver |
| --- | --- | --- |
| **Claude Code** | Interactive CLI "build IDE" | Human-directed, in a worktree on the host |
| **Codex CLI** | Interactive CLI "build IDE" | Human-directed, in a worktree on the host |
| **Build Studio** | *Embedded* / autonomous | Orchestrator-driven, in-portal, sandbox executor |

They are **peers**, not a hierarchy. None is privileged; work never depends on any one being healthy. They are unified by two invariants:

1. **One common governed process** — the Build Studio lifecycle (`ideate → plan → build → review → ship`), advanced by **evidence at each gate**, right-sized by a `(type × size)` matrix. The process is provenance-agnostic by design.
2. **One MCP coordination plane** — work tracking and activity coordination live in the DPF MCP substrate (backlog, WorkCapsule, phase-gate evidence, runtime coordination), the executor-agnostic source of truth. *Whoever* does the work, the MCP records are canonical.

A third invariant governs the human surface: **complexity is hidden from layman users.** The coordination plane is backstage; non-technical users see simple status and outcomes (progressive disclosure), never the worktree/sidecar/evidence plumbing.

A fourth invariant makes the whole thing durable: **surfaces are thin, swappable adapters behind a stable contract.** Claude Code and Codex ship updates *daily*; the process must survive that churn untouched. So the durable doctrine encodes **no surface-version-specific mechanics** — it defines the gate/evidence contract, the MCP coordination plane, and the lease/worktree/sidecar discipline, and each surface adapts to them. Upgrading a tool is a *routine, sustained operation* (§4.2), not a re-architecture. If a doctrine rule would break when Claude or Codex bumps next week, it belongs in a thin adapter, not in the contract.

The enabling principle already exists and is operator-ratified: [`governance-approves-evidence-not-provenance`](../../founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md). A gate reads only its required evidence fields and never branches on *who* produced them — which is exactly what makes three surfaces interchangeable.

## 2. Problem — the architecture is latent, not bound (live evidence 2026-06-05)

Every piece of this exists in the codebase; nothing binds it into one coherent, enforced contract. The result is observable drift on the live install:

- **Stale, mislabeled Live portal.** Running image stamped `e7ef3331` (June 5) but containing ~June-3 bytes (no `device-catalog.ts`, migrations stop `20260603030000`, `/api/v1/device-catalog` → 404). Three divergent source states, none equal to `origin/main`. Filed **BI-5B6C1C35**. Root: two competing source-advance engines (host-clone `dpf/install` promoter vs. `/workspace` `my-changes` image-sync) that the upgrade spec §5.0 intends to collapse but hasn't.
- **Worktree sprawl — 119 worktrees, two conventions.** 43 are Claude Code's native `D:/DPF/.claude/worktrees/<random-name>` (nested inside the root clone); ~75 are the AGENTS.md §4 `D:/DPF-<topic>` form. The doctrine and the tool disagree about placement; nothing reaps them.
- **Orphaned sidecars block tool upgrades — 69 host processes.** 13 `claude.exe`, 16 `Codex.exe`, 30 `node.exe`, 6 `node_repl.exe`. Codex is a WindowsApps Store package that cannot update while running; three generations of per-session `app-server` + `node_repl` + npx MCP sidecars are never reaped. The spawned MCP servers are generic (`xcodebuildmcp`, `youtube-transcript-mcp`) — **not the DPF MCP** — so sessions don't coordinate through the substrate *and* their orphaned children pin the installer.
- **Sandbox use sporadic; ad-hoc host containers.** §5/§6 mandate the shared `local-integration-ci` lease for runtime-bound gates, but agents inconsistently build their own per-branch CI images (5 orphaned `dpf-local-integration-*-build` images, ~20GB). ~50GB Docker reclaimable overall.
- **No common dispatch path.** `claude-dispatch.ts` and `codex-dispatch.ts` diverge (different bypass flags, auth handling, tool sets); `dpf-native` — the intended audited common executor — is `null`/unimplemented (`sandbox/agents/index.ts:8`).

**Diagnosis:** the surfaces were never declared peers under one MCP-coordinated process, and the doctrine was never aligned to the surfaces' real execution mechanics. So they diverge, BS gets treated as primary, and coordination/hygiene is unenforced.

## 3. Target architecture

### 3.1 The common process (mirror Build Studio faithfully)

The canonical lifecycle is the Build Studio one, already a clean evidence state machine (`build-process-matrix.ts`, `feature-build-types.ts`):

| Phase | Gate to advance (feature/medium baseline) | Evidence record | MCP tool a CLI surface uses |
| --- | --- | --- | --- |
| **ideate** | designDoc present + designReview passed + intake ready | `designDoc`, `designReview` | `saveBuildEvidence{designDoc}` → `reviewDesignDoc` |
| **plan** | buildPlan present + planReview passed | `buildPlan`, `planReview` | `saveBuildEvidence{buildPlan}` → `reviewBuildPlan` |
| **build** | verification typecheck passed (verificationOut present) | `verificationOut`, `taskResults`, `PhaseHandoff` | `record_external_development_evidence`, `record_local_integration_result`, `save_phase_handoff` |
| **review** | acceptance evaluated + all-met + UX not blocking | `acceptanceMet`, `uxVerificationStatus` | `record_runtime_verification`, `record_capsule_evidence` |
| **ship** | (human PR click) | `gitCommitHashes`, PR url | `deploy_feature`, then PR-with-DCO |

Right-sizing: `(type, size)` selects a `LifecyclePolicy` — a chore-small skips ideate+review; doc drops UX/acceptance; xlarge decomposes. The phase graph never changes; a skipped phase gets an auto-pass gate. Each transition runs `checkPhaseGate` — nothing is rubber-stamped, regardless of surface.

**Process is sound; the BS *engine* is the unreliable part** — the inner `buildExecState` auto-advance pipeline (silent `step=complete`+error, restart-killed dispatch, "Reset Build" the only recovery). The interactive surfaces (Claude/Codex) bypass that engine by producing evidence and calling the gate directly through MCP. The embedded surface (BS) keeps the engine but must converge on the same gate/evidence contract. **Per the §7 decision, stabilizing this engine is the engine-first priority** — BS becomes a true peer surface, not a workaround the other two route around indefinitely.

### 3.2 The MCP coordination plane (executor-agnostic source of truth)

Work tracking and activity coordination are MCP records, written by every surface, **regardless of Build Studio**:

- **Work tracking:** `BacklogItem`/`Epic` (intake), `FeatureBuild` (lifecycle + evidence fields), `WorkCapsule` (claim/heartbeat/evidence for a unit of work).
- **Activity coordination:** `claim_capsule_scope` / `heartbeat_capsule` / `release_capsule_scope`; `claim_nonprod_environment_lease` (the shared sandbox); runtime-coordination map / `RuntimeTarget`.
- **Evidence:** `saveBuildEvidence`, `reviewDesignDoc`/`reviewBuildPlan`, `save_phase_handoff`, `record_external_development_evidence`, `record_runtime_verification`, `record_local_integration_result`.

Rule: **if it isn't in the MCP plane, it didn't happen.** A surface that does work without claiming a capsule and recording evidence is invisible to coordination and cannot advance a gate.

### 3.3 Hide complexity from layman users

- The user-facing surface shows **work + status + outcomes**, never worktree names, container ids, evidence JSON, or gate predicates.
- The coordination plane is queried *for* the user by the surface; the user issues intent ("build X", "what's in flight?") and reads progressive-disclosure status.
- Operator-grade detail (this spec's plumbing) lives behind admin/platform-development surfaces, opt-in.

## 4. Execution-alignment contract (aligned to how Claude Code & Codex actually work)

This is the layer the current doctrine is missing. It is binding on **both** interactive surfaces.

### 4.1 Worktree selection — one convention, one lifecycle

**Today the three surfaces put work in three different places (observed 2026-06-05):**

| Surface | Where its work lives | Coordinated? |
| --- | --- | --- |
| Claude Code | `D:/DPF/.claude/worktrees/<random-name>` (nested in root clone) — 43 of them | No |
| Codex / AGENTS.md §4 | `D:/DPF-<topic>` (alongside root) — ~75 of them | No |
| Build Studio | `sandbox_workspace` volume *inside* `dpf-sandbox-1` (no host worktree) | Partially (sandbox lifecycle) |

**Should they be the same location?** The right rule is *not* "one physical path for all three." Build Studio is legitimately containerized — forcing it onto a host worktree would be wrong. The correct invariant is: **the two interactive host surfaces (Claude Code, Codex) share ONE host convention, and ALL THREE register their work location + claim in the MCP coordination plane.** Sameness of *location* matters only for the two host surfaces; sameness of *governance* (registered, claimed, reaped) is mandatory for all three. The chaos comes from the registration gap, not the path difference.

- **Single canonical location and naming** *(for the two host surfaces)*. Reconcile §4 with Claude Code's native behavior: pick ONE — either standardize on `<root>/.claude/worktrees/<name>` (Claude Code's default; nest-inside-root) OR `D:/DPF-<topic>` alongside — and make the other a hard error. *(Decision needed — see Open Questions.)* Whichever is chosen, Codex must follow it too.
- **Every worktree is born governed.** Created with a topic branch off `origin/main`, MCP config seeded (`dpf-bootstrap-agent-toolchain`), `COMPOSE_PROJECT_NAME=dpf-<topic>` set, readiness marker written. A worktree without a WorkCapsule claim is an orphan by definition.
- **Lifecycle + reaping.** A worktree is `active` (claimed capsule with live heartbeat), `idle` (no heartbeat > threshold), or `done` (branch merged/abandoned). The **worktree/runtime janitor (BI-DBF3F426)** reaps `idle`/`done` worktrees, their branches, their per-branch CI images, and any stray compose project. Target: bounded worktree count, not 119.

### 4.2 Sidecar / process lifecycle — so Claude and Codex can be upgraded

- **One MCP wiring, DPF-first.** Each surface session connects the **DPF MCP** (`/api/mcp/v1` via `DPF_MCP_BEARER_TOKEN`). Generic npx MCP servers (`xcodebuildmcp`, `youtube-transcript-mcp`, etc.) are not project-default; they must not be auto-spawned per session. (Aligns with AGENTS.md §16 "generic skills are not development precedent.")
- **Session = claimed capsule; session end = reap.** When a surface session ends (or its capsule is released), its sidecars (`app-server`, `node_repl`, npx MCP children) are terminated. No three-generation orphan accumulation.
- **Upgrade windows.** Define a *quiesce-for-tooling-upgrade* procedure: drain/clear active surface sessions, reap sidecars, then allow Claude Code / Codex (incl. the WindowsApps Store package) to update, then resume. Upgrading the *tools* gets the same first-class treatment as upgrading the *platform* (the self-upgrade lifecycle) — currently it has none, which is why orphaned threads block it.

### 4.3 Sandbox & container discipline — no ad-hoc host containers

- **Runtime-bound verification goes through the shared lease, always.** `claim_nonprod_environment_lease(environmentKey="local-integration-ci")` is the *only* sanctioned runtime for build/UX/migration gates from a worktree. Building a per-branch CI image is prohibited; it is the source of the 4GB-image sprawl.
- **Every shared singleton runtime MUST be lease-gated — including the `:3001` Contributor preview.** Observed 2026-06-05: `dev-portal` (`:3001`) is a *single* shared container, bind-mounted to ONE worktree at a time via `DPF_DEV_WORKTREE`, **writing to the LIVE database**, with no lease. Whichever surface runs `dev-portal-start` last silently re-points `:3001` to its own worktree, so every other thread's "preview" is now showing someone else's code — and a coding mistake there mutates production data. This is the same unleased-shared-mutable-resource antipattern as a per-branch CI image, but worse (live-DB write). Fix: bring `:3001` under the same lease (`environmentKey="contributor-preview"` or fold it into `local-integration-ci`), surface who holds it, and refuse a silent re-bind while the lease is held. Until leased, treat `:3001` as operator-only and never as a per-thread preview.
- **No ad-hoc `docker run`/`compose up` from a surface** except through the governed sandbox/lease or an explicit, audited recovery. Worktree compose requires `COMPOSE_PROJECT_NAME` isolation (BI-63C11CF7); `--force-recreate portal` against root is the promoter's job only.
- **Artifact janitor — scheduled, three-state OBSERVE → gated AUTO-REAP (BI-DBF3F426 2026-07-16; volume reclaim BI-DBF3F426/#4025 2026-08-05; founder-gated auto-reap BI-A55BE432/#4030 2026-08-05; BuildKit cool-down complement BI-C85D1B0A 2026-08-10).** `scripts/runtime-artifact-janitor.mjs` (reaps orphaned `dpf-local-integration-*-build` images + stray/foreign compose projects **and, since #4025, their orphaned named volumes** — the dominant local-disk leak: dead `dpf-<topic>` dev stacks whose worktree merged still holding ~1GB+ of `pgdata`/`node_modules` each; **and, since BI-C85D1B0A, stops idle managed `dpf-local-ci-buildkit-vN-S` builders and removes obsolete policy-version builders**) has a scheduled home: `apps/web/lib/queue/functions/runtime-artifact-janitor.ts`, daily `20 5 * * *`. Primary cool-down still runs post-build in `local-ci-bounded-build.mjs` (`docker buildx stop`); the janitor is the crash/leftover backstop. Spec: [`2026-08-10-buildkit-session-lifecycle-design.md`](./2026-08-10-buildkit-session-lifecycle-design.md). It mirrors the worktree-janitor two-flag pattern (BI-42FA7DD8), so the durable flag pair **is** the `destructive-actions-require-explicit-go`:
  - **Default OFF** (`DPF_RUNTIME_ARTIFACT_JANITOR_ENABLED` unset) — no scan.
  - **ENABLED alone** — DRY-RUN observe: `--json` only, **logs what it WOULD reap** (what / why-classified-orphan / age), deletes nothing.
  - **ENABLED + `DPF_RUNTIME_ARTIFACT_JANITOR_AUTO_REAP=1`** — live `--apply`: reaps the candidates including their named volumes, and records reaped-project + reclaimed-volume counts.

  The whole scheduled set is also behind `DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED`. The portal container has no Docker socket, so the CLI exits 1 and the job degrades to skip+log (never throws); real reaping needs a host runner, or a manual `node scripts/runtime-artifact-janitor.mjs --apply` on the host. Rollout doctrine: soak the observe log first, arm AUTO_REAP once the daily would-reap set is trusted. The orphan criteria (identical in observe and apply): a build image matches `^dpf-local-integration-[a-z0-9-]+-build$` **and** is idle ≥ staleness-days (default 7); a compose project qualifies only when it is not the root `dpf` project, has **no** live worktree backing it, has **no** running container, **and** its newest container/volume is idle ≥ staleness-days. Volume removal is label-scoped (`com.docker.compose.project=<name>`) and refuses the root `dpf` project as defense-in-depth.
- **The live install advances only via the self-upgrade pipeline.** No surface hand-advances the root clone HEAD or the running portal (no `git checkout origin/main`/`pull`/`reset` on root; no manual portal rebuild to "update"). A built image must carry the identity of its bytes — stamp == built HEAD == target, asserted pre-swap, `DEPLOYED_SHA` populated, fail loud on divergence (BI-5B6C1C35). Never trust a version label over the bytes.

### 4.4 One execution contract, equal for Claude and Codex

Both surfaces, identically: read AGENTS.md; load the `dpf-platform` skill pack (the procedural binding to §3.1); connect DPF MCP; claim a capsule before work; produce gate evidence through MCP; route runtime gates through the lease; never bypass the MCP scope gate; never orchestrate host containers outside the sandbox/lease. The governed common *dispatch* path for the embedded surface is `dpf-native` (to be implemented — closes the audit/bypass divergence between `claude-dispatch` and `codex-dispatch`).

### 4.5 Client specifics — the per-surface config that enforces the contract

The common contract is only real if each tool's actual client config enforces it. Observed 2026-06-05; the asymmetry is the point.

**Shared baseline (both surfaces).** DPF MCP wired via `DPF_MCP_BEARER_TOKEN` (`.mcp.json` http `dpf`; Codex `[mcp_servers.dpf].bearer_token_env_var`); `dpf-platform` plugin enabled; draft-PRs off. `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` is the **single convergence point** that must enforce everything below, so every new worktree is born conformant and drift is flagged at its readiness banner.

**Claude Code** (`.claude/settings.json`, `.mcp.json`) — **clean and DPF-scoped today:** only the `dpf` MCP server (`enabledMcpjsonServers:["dpf"]`), only `dpf-platform@dpf-platform-local`, with `PostToolUse`/`SessionEnd` hooks already wired. Gaps to close:
- `permissions.allow` includes `Bash(docker compose:*)` — the host-side ad-hoc-container enabler. Constrain it (require `COMPOSE_PROJECT_NAME`, forbid root `--force-recreate`/`down --volumes`) or drop it in favor of the lease.
- Point the worktree base at the canonical `D:/DPF-worktrees/<topic>` instead of the default random `.claude/worktrees/<name>` nesting.
- Extend the existing `SessionEnd` hook to reap sidecars + release any held lease/capsule.

**Codex** (`~/.codex/config.toml`) — **DPF MCP present, but polluted with non-DPF clients that spawn the orphaned sidecars:**
- Generic MCP servers `nanobanana-mcp`, `youtube_transcript` and generic plugins `superpowers@openai-curated`, `build-ios-apps@openai-curated` (the last spawns `xcodebuildmcp` — iOS, irrelevant on Windows). Per AGENTS.md §16 these are not project-default; prune them from the DPF client profile so sessions stop auto-spawning orphaned `npx`/node children.
- `superpowers@openai-curated` conflicts with `dpf-platform`; DPF must win — disable the generic one in the DPF profile.
- `trust_level="trusted"` is set for `D:\DPF` only, not the worktrees → worktree sessions hit trust friction. Add the canonical worktree base.
- `model="gpt-5.5"` is client-pinned; for the interactive surface the operator's choice is fine, but record it rather than silently pin.
- No session-end reaping → `app-server` + `node_repl` + plugin MCP children accumulate (3 generations observed 2026-06-05) and pin the WindowsApps Store package against update. The quiesce-for-tooling-upgrade routine (§4.2) must terminate these before a Codex upgrade.

**Net:** Claude's client is already near-conformant; Codex's is the drift source (generic plugins/MCP servers → orphaned sidecars → blocked upgrades). The bootstrap script converges both to one DPF-scoped baseline (DPF MCP only + dpf-platform only + worktree trust + worktree base + reaping hooks); anything outside that baseline is reported, not silently tolerated.

## 5. Research & Benchmarking (per AGENTS.md §10)

- **Claude Code execution model.** Native git-worktree support defaults to a managed worktrees dir; subagents/sidecars are child processes; MCP servers configured per-project via `.mcp.json`. *Adopted:* worktree-per-session, MCP-per-worktree. *Gap it creates:* default nesting + no reaping → sprawl + orphaned children. Doctrine must align to the real default, not an idealized path.
- **Codex CLI / app execution model.** WindowsApps Store package; `app-server --listen stdio://` with node MCP children spawned per session via `npx -y <pkg>@latest`. *Anti-pattern observed:* irrelevant generic MCP servers auto-spawned; Store-app-can't-update-while-running. *Adopted pattern:* DPF-first MCP wiring + quiesce-for-upgrade.
- **Multi-agent orchestration comparators.** Kubernetes pod-termination + ELB connection-draining (already mirrored by the Activity Quiescence Protocol for the portal) — extend the same drain/reap model to *tooling* sessions, not just the portal swap. CI-runner ephemerality (GitHub Actions runners are disposable) — the shared `local-integration-ci` lease is DPF's bounded-runtime answer; enforce it instead of per-branch images.
- **Provenance-agnostic gates.** The "evidence not provenance" gate is the same pattern as CI required-checks (a check is green by its result, not its author) — generalized here so three executors satisfy one gate set.

## 6. Binding (how this becomes prescriptive *now*)

1. **AGENTS.md** — new section "Delivery Surfaces & Execution Alignment" capturing §3.1–§3.3 invariants and the §4 contract (single source of truth; the surfaces' tool docs remain pointers).
2. **Kernel principles** — promote the durable ones (`one-common-process-three-surfaces`, `mcp-is-the-coordination-plane`, `worktree-selection-and-reaping`, `reap-sidecars-to-upgrade-tools`, `runtime-gates-via-shared-lease`, `image-identity-equals-bytes`) under `docs/founder-kernel/wiki/principles/` so they ship with every install and hold offline.
3. **dpf-platform skill pack** — wire the lifecycle skill chain to the gate/evidence contract; add worktree/sidecar/sandbox discipline to `dpf-worktree-per-session` and `dpf-finishing-a-development-branch`.
4. **Code keystones (separate plans), engine-first ordering:** (a) **stabilize the BS embedded engine** — the `buildExecState` auto-advance pipeline, contradictory-checkpoint recovery, restart-resume (the §7 Q4 priority); then (b) retire the `/workspace` second source-advance engine (converge on §5.0 host-clone); (c) implement `dpf-native`; (d) activate the janitor (BI-DBF3F426); (e) enforce image stamp==bytes==target (BI-5B6C1C35); (f) fold `:3001` into the `local-integration-ci` lease.

## 7. Decisions (WWMD-ratified 2026-06-05)

Scored via `principle_decide` against the `mark-dpf-platform` profile (20 commandment-tier principles each; **zero commandment conflicts**; strong structured coverage, no semantic fallback). Operator-ratified; Q4 decided by the operator after the kernel returned a sub-threshold tie. The `principle_decide` traces (callingSurface `unified-delivery-spec-q1..q5`) are the audit record.

1. **Worktree canonical location → dedicated sibling dir `D:/DPF-worktrees/<topic>`** for both host surfaces (not the tool-native `.claude/worktrees/` nesting). *Kernel: high confidence, margin 3.12 — the most decisive of the five; worktree-is-source-control-not-runtime + single-source-of-truth.*
2. **Tooling-upgrade authority → operator-triggered** quiesce-reap-upgrade routine. *Kernel: high, margin 0.32; never-ask-the-user + destructive-actions-require-explicit-go.*
3. **Layman front → the AI Coworker panel** (delivery status only; plumbing stays admin-only). *Kernel: high, margin 0.86; single-source-of-truth / agent-as-conduit.*
4. **BS engine vs. process → engine-first.** Stabilize the embedded BS runtime engine now; the common process + MCP plane remain the contract all three surfaces share. *Kernel returned a sub-threshold tie (margin 0.027, low confidence) nominally tipping engine-first on single-source-of-truth + ship-real-functionality; **operator decided engine-first**.*
5. **`:3001` disposition → fold into the `local-integration-ci` lease** (one lease-gated shared-runtime model; no standalone singleton, no silent re-bind). *Kernel: high, margin 0.63; single-source-of-truth.*

## 9. Addendum (2026-08-25, BI-81780B4A): a gate refusal declares which kind of no it is

**Operator directive.** The product behaviour is the workroom and its shape, with
gates and actions. Every gate requirement and definition — now and for those
built later — carries this as an implementation mechanic.

**The shape.** A gate exists to make the right thing happen: proceed when the
case is clear, escalate when it is ambiguous, refuse when it is wrong. A
coworker may RESHAPE a decision and try again, bounded; where it holds several
valid options, scoring them against each other is how it picks. Ceiling for both
axes: **5** (operator's call).

**What was wrong.** `evaluateWorkCasePolicy` is the single chokepoint every
governed workroom action passes through, and it returned a binary allow/deny
across twelve denial reasons. Every no read the same, so a coworker could not
tell "attach the receipt policy and retry" from "this case is sealed forever"
from "a person must approve this envelope". Both failure modes follow: stopping
on something fixable in one move, or grinding against a stop that was never
going to yield — the forever-loop wearing the costume of diligence.

**The mechanic.**

| Disposition | Meaning | Example |
| --- | --- | --- |
| `shape` | the caller holds the missing input and may retry, bounded | missing verification evidence, missing decision interaction |
| `escalate` | nothing the caller controls will fix it; a person rules | an envelope awaiting approval |
| `hard-no` | never yields | sealed case, unsupported transition, **tripped stop condition** |

Four rules make it hold:

1. **The classification is a closed `Record` keyed by the denial union**, in
   `apps/web/lib/work-management/gate-shaping.ts`. Adding a reason without
   deciding what kind of no it is **does not compile**. That is the
   "and for those built in the future" clause — the next gate requirement
   inherits the contract by construction, not by its author remembering.
2. **A shapeable denial names what to change.** A hint-free "shape" is just a
   retry, and a retry that changes nothing is refused upstream already.
3. **Budget exhaustion converts to `escalate`, never to `hard-no`.** Running out
   of attempts says nothing about whether the action is allowed — only that this
   coworker could not shape it. The attempt history is the human's context.
4. **A tripped stop stays a hard no** (§1 of AGENTS.md: an enforcement refusal
   is a stop, not a workaround). Shaping against one *is* the workaround.

**Still open, tracked on BI-81780B4A.** The no-progress trip: today the retry
loop refuses only *identical* inputs, so a coworker can declare five different
changes and thrash at the same margin. And option dedupe before scoring: margin
is top-1 against the runner-up, so adding a near-clone of the leader collapses
the margin and manufactures an escalation on a decision that was clear — five
real options, not five variants.

## 8. Acceptance

- All three surfaces advance the same gates by writing the same MCP evidence; a gate cannot tell which surface produced the evidence.
- Worktree count is bounded and reaped; no orphaned sidecars pin a tool upgrade; Claude/Codex updatable on demand.
- No per-branch CI images; runtime gates run on the shared lease; root install advances only via the self-upgrade pipeline; running image stamp == bytes == target.
- Layman users never see worktree/container/evidence plumbing; they see work + status + outcomes.

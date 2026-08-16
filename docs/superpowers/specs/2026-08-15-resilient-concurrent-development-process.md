# Resilient Concurrent Development Process

**Surface-agnostic, enforce-by-construction pipeline for high-fan-out AI development**

- Epic: EP-056D2A5E (Resource contention & concurrency safety)
- Gap BIs: BI-6C54223E (Stage 0) · BI-8D56F777 (Stages 2+4) · BI-3D4A7063 (Stage 3) · BI-9A353411 (Stage 5)
- Cross-surface corpus mirror (retrievable via `doc_search`/`search_knowledge`): `DOC-C263E0C9`
- Extends AGENTS.md §12 doctrine: "Four peer surfaces, one process" and "Governance approves evidence, not provenance."

---

## 1. Why this exists

DPF development runs at very high fan-out — up to ~160 concurrent agent threads (2 systems × 4 clients × ~20 threads). That concurrency is the productivity multiplier (weeks-not-years) and is a **requirement, not a bug**. Two structural faults today:

1. **It is client-discretionary.** Whether a thread seeds its worktree correctly, verifies before pushing, or records evidence depends on *which* AI client (Claude/Codex/Grok/Antigravity/Build Studio) ran it and how rigorous that client was. Quality varies by surface.
2. **It funnels every thread through one scarce, heavyweight, LOCAL resource** — a 2-slot, 16 GB-per-run Docker verification gate — which starves under high demand and exhausts host RAM.

## 2. Binding constraints (a fix may not violate any)

- **C1 — Concurrency is required.** Do not "run fewer threads." Preserve high fan-out.
- **C2 — Low RAM.** Hosts cannot run many Docker images. Per-verification heavyweight Docker stacks are the wrong model.
- **C3 — Bounded tokens.** The weekly token budget is spent in days at this fan-out. Improve throughput-per-token; do not require re-running the fan-out to validate.

## 3. Governing principle: enforce by construction, not by client discretion

The only way *every* agent surface applies the same process is to stop relying on each client to choose to. Two layers:

- **Advisory layer** (AGENTS.md + dpf-skill-pack skills): tells a surface what to do. A lax client may skip it.
- **Mandatory layer** (platform gates on the worktree lifecycle, capsule/Work-Room transitions, pre-push gate, and merge queue): a surface *cannot* proceed without satisfying it. Client cooperation is not required.

**Design rule:** every stage below has a mandatory gate, so the process holds regardless of surface. This is the AGENTS.md §12 keystone ("governance approves evidence, not provenance") applied to the whole pipeline.

## 4. The pipeline (unit of work = capsule, migrating to Work Room)

Validation / user acceptance is the final stage and legitimately happens **post-deploy** (see §8).

| Stage | What happens | Mandatory gate (surface-agnostic) | Advisory (all surfaces) | Gap BI |
|---|---|---|---|---|
| **0 · Allocate** | Worktree comes up **guaranteed compile-ready** (deps linked, Prisma/generated client, env, MCP config, in-worktree symlinks) | Readiness gate: `.dpf-worktree-readiness.json` must be `compile-ready` for code/test intent — else auto-heal or **block** with the exact missing item | dpf-worktree-per-session | BI-6C54223E |
| **1 · Work** | Agent edits in its isolated worktree — cheap, no Docker, fully parallel | worktree isolation + lease | dpf-worktree-per-session | — |
| **2 · Fast local gate** | `typecheck + lint + affected tests` as plain Node — seconds, in-context, **no Docker**; catches ~90% of failures here | Scope-aware pre-push gate via `DPF_LOCAL_CI_COMMAND`; push blocked until green | dpf-local-merge-ci-before-push | BI-8D56F777 |
| **3 · Evidence** | Thread records the minimum evidence for its work-kind | Capsule/Work-Room transition to `ready-for-review`/`ready-for-promotion` is **refused** unless required evidence is present + valid (reuse `requiredEvidence`/`evidenceCompleteness`) | dpf-external-evidence-handoff, dpf-tdd | BI-3D4A7063 |
| **4 · Cloud safety net** | Heavy 16 GB build + integration runs **once, elastic** (GitHub merge queue) — the *rare* failure the cheap gate can't catch | Required checks (DCO, Merge Readiness, UX Route Budget) + merge queue | dpf-pr-with-dco, dpf-finishing-a-development-branch | BI-8D56F777 |
| **5 · Liveness** | Dead thread → reap/resume; finished-but-stranded → surface for promotion; merged → auto-close | Platform reaper keyed on lease/liveness (already computed); no client cooperation needed | — | BI-9A353411 |
| **6 · Validate (post-deploy)** | User acceptance after deploy, behind flags/canary with fast rollback | Progressive-delivery guardrails (see §8) | dpf-verify-on-live-install | (open, §8) |

**Key rule:** Stage 4 (cloud) is a *safety net*, not where failures are discovered. Failures must surface fast at Stage 2 (local, in-context) — otherwise threads pay the slow git round-trip (push → wait → CI-red → return → fix → re-push). Stage 2 is comprehensive *because* it is plain-Node, not Docker. Docs/reconciliation branches → lint only.

## 4a. Observed in the field (2026-08-15/16) — evidence for the Stage 2/4 split

One Claude Code session shipped five PRs (#4335, #4343, #4345, #4347, #4353) in a
single evening while other sessions worked concurrently. It ran the heavy local
Docker gate (`pnpm run pregate`) roughly **fourteen times to get five passes**.
The failure distribution is the argument for §4's Stage 2/4 split, so it is
recorded rather than left as folklore.

**Cheap, correct failures — the preflight (~16–25 s each).** Module Size Guard,
Derived Artifact Registry (a doc edit left `doc-impact.generated.json` stale), and
Design Grounding Gate each failed fast, before any lease was claimed, and each was
a real defect. This is precisely the Stage 2 behaviour the pipeline wants: plain
Node, seconds, in-context, no Docker, no shared resource consumed.

**Expensive, non-informative failures — the Docker stage.** Six of the fourteen
runs died without producing build evidence:

| Failure | Count | Cost each | Signal |
| --- | --- | --- | --- |
| `blocked_sandbox_drift` (exit 3) | 3 | ~5 s + a lease cycle | none — sandbox defect, self-heals on plain re-run |
| `received SIGTERM` mid-run (exit 1) | 3 | 0:30, 1:10, 2:06 into ~3–5 min runs | none — the log showed `fail 0` throughout |

The SIGTERMs were **slot contention**, not a product failure and not a defect in
the invocation. Host state at the time: load average 5.4, ~22 live worktrees,
several sessions gating against the same 2-slot resource. The decisive evidence
is that the run passed first try once `list_nonprod_environment_leases` returned
`{leases:[],queued:[]}`.

**Diagnostic rule for any surface hitting this:** on `gate-worktree: received
SIGTERM`, do **not** retry blindly and do **not** "fix" the invocation — check
`list_nonprod_environment_leases` and retry only when it is empty. (A plausible
but wrong hypothesis was pursued first in this session — that redirecting the
command's output caused it — and was disproved when an unpiped, sole-command run
died the same way. The queue message is also mildly misleading: "previous
local-CI lease claim was released; creating fresh admission attempt N" can print
while another session still holds the slot.)

**Why this is evidence for the design, not an argument for a bigger gate.** Every
defect that mattered was caught by the seconds-long preflight. The multi-minute
Docker stage caught nothing in fourteen attempts that the cheap stage had not
already caught, while consuming the scarce shared resource ~9 times without
producing evidence. §1's second structural fault — one scarce heavyweight local
resource that starves under demand — is not a projection; this is it happening at
a fan-out of a handful of threads, well below the ~160 the pipeline targets.

Tracked under `BI-8D56F777` (Stages 2 + 4).

## 5. Cross-surface enforcement matrix

"Gate" = mandatory/platform; "Skill" = advisory paved road; every surface inherits both.

| Stage | Claude Code | Codex | Grok | Antigravity | Build Studio |
|---|---|---|---|---|---|
| 0 Readiness | Gate + skill | Gate + skill | Gate + skill | Gate (+ warn) | Gate (native) |
| 2 Fast gate | Gate (`DPF_LOCAL_CI_COMMAND`) + skill | Gate + skill | Gate + skill | Gate | Gate (native) |
| 3 Evidence | Gate (capsule transition) + skill | Gate + handoff skill | Gate + handoff skill | Gate | Gate (native) |
| 4 Cloud | Required checks + merge queue (identical for all) |
| 5 Liveness | Platform reaper (identical for all — keyed on lease, not client) |

Because Stages 0/3/5 are **platform gates**, a surface that "forgets" cannot bypass them.

## 6. Alignment with mainstream practice

Converges on large-monorepo engineering (Google/Meta):
- Trunk-based dev + short-lived branches + **merge queue** (not-rocket-science rule).
- **Presubmit** (fast, affected-only) vs **postsubmit** (comprehensive) = Stage 2 vs Stage 4.
- **Remote Build Execution + caching** instead of per-change local full builds = Stage 4 offload.
- **Hermetic/reproducible dev environments** = Stage 0.
- **Policy-as-code / required checks / SLSA provenance / Definition-of-Done** = Stage 3.
- **Progressive delivery (flags/canary/rollback)** = Stage 6.
References: *Software Engineering at Google* (TAP presubmit/postsubmit); *Accelerate* (DORA); SLSA.

## 7. Rollout sequencing

1. **Stage 0** (BI-6C54223E) first — a broken worktree poisons every later stage (spurious failures, wasted tokens, dirty evidence).
2. **Stage 2** (BI-8D56F777) — the scope-aware lightweight `DPF_LOCAL_CI_COMMAND` gate; fastest operator-visible win, testable on a couple of threads with no build.
3. **Stage 3** (BI-3D4A7063) — enforce the evidence contract at capsule transition.
4. **Stage 5** (BI-9A353411) — the liveness reaper.

Instrument with **DORA metrics** (deploy freq, lead time, change-failure rate, MTTR) to prove each stage helps.

## 8. Open question — Stage 6 progressive delivery

Post-deploy UAT is mainstream *only if* paired with **feature flags + canary/staged rollout + fast automated rollback**. Confirm DPF's progressive-delivery story supports safe post-deploy validation before leaning on it. If absent, this is a fifth gap BI.

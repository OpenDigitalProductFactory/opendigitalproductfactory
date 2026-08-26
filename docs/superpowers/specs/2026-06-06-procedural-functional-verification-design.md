---
title: Procedural functional-verification — one executable preflight, one verdict, one stop-rule
status: active
date: 2026-06-06
owner: platform
relates:
  - docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
  - docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md
  - docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md
  - docs/founder-kernel/wiki/principles/image-identity-equals-bytes.md
  - docs/founder-kernel/wiki/principles/runtime-gates-via-shared-lease.md
epic: EP-VERIFY-PROC
backlog:
  - BI-85433710  # executable preflight + verdict
  - BI-35A92FB6  # single entry-point skill + stop-rule
  - BI-6B31D9FF  # reconcile redeploy-portal pointer
  - BI-E4CBC7C1  # classify self-upgrade build-gate failures
  - BI-98AF1066  # fast static bundle-boundary guard
  - BI-C5E03376  # bind entry point into AGENTS.md + thin-adapter seam
  - BI-FFBDDD96  # source-free release ancestry disposition
---

# Procedural functional-verification

> **Operator framing (2026-06-06).** "Codex and Claude threads spend an inordinate amount of tokens mucking with build and testing that should be more or less procedural." This is the platform principle of *continuously moving human cognitive load to AI, and AI cognitive load to procedure*. The agent is the AI; today it bears **cognitive** load (improvising a verification procedure from scattered doctrine) where it should bear **procedural** load (running a deterministic preflight and following a decision tree). This spec is the single source of truth for that procedure; AGENTS.md and the skill docs become pointers to it.

## 1. Thesis

Functional verification on the live install must be **one executable procedure with a deterministic verdict and a hard stop-rule**, not an assembly the agent re-derives every time.

There have been many attempts (§2 timeline) and none converged because **every attempt added doctrine — a rule stating what is true — and almost none added an executable procedure stating what to do.** Six commandment/core kernel principles, two partial executable pipelines, zero single agent-facing entry point. Doctrine tells the agent the live install must contain the feature's bytes; it never hands the agent a runnable check that *answers whether it does* and *what the one next action is*. So the agent improvises — and improvisation under time pressure is exactly the token burn and the thread-to-thread "sporadic" divergence the operator observes.

The fix is the missing **executable binding** of the already-accepted Unified Delivery Surfaces contract — not a fourteenth doctrine artifact.

## 2. Problem — doctrine without an executable, evidenced by a 22-minute trace

### 2.1 The trace (anonymized from a live thread, 2026-06-06)

Task: *functionally test the Finance Specialist browser-retrieval feature on the live install.* What actually happened:

| Phase | Agent work | Why expensive |
| --- | --- | --- |
| Detect skew | ~4 separate git/curl batches re-deriving "running container = old commit; HEAD lacks the feature; origin/main has it" | A drift check exists (`scripts/portal-version-check.sh`) but was never found; the comparison was hand-rolled |
| Advance | Triggered `/ops/self-upgrade` (correct governed path) → it failed the Docker build gate | No deterministic outcome on failure |
| Reproduce | New worktree → `pnpm install` (55s) → host build (passes) → Docker build (65s, fails) | Host-vs-Docker divergence is a **known recurring class** (`docs/triage/2026-05-24-portal-prisma-generate-rebuild-failure.md`) — re-derived from zero |
| Fix + verify | TDD'd two bundle-boundary violations, **discovered serially** across two full Docker builds | No fast static check; each 40–90s build surfaced only the *next* violation |

**The original test never ran.** A verification task silently became a multi-hour build-infra fix, and nothing told the agent to stop. Scope expansion was unbounded.

### 2.2 The 13-artifact timeline (why it never converged)

| Date | Artifact | Kind |
| --- | --- | --- |
| 2026-04-19/20 | coworker-driven-sandbox-verification (Inngest `build/review.verify` auto-trigger) | executable (BS ship-phase only) |
| 2026-05-11 | AI routing + UX verification test architecture | doctrine |
| 2026-05-18 | `structural-verification-is-not-functional` | doctrine (commandment) |
| 2026-05-20 | portal-self-upgrade-local | executable (partial) |
| 2026-05-23 | governed-platform-upgrade-lifecycle | doctrine + reconciliation |
| 2026-05-31 | `worktree-is-source-control-not-runtime` | doctrine (commandment) |
| 2026-06-04 | `dpf-verify-substrate-first` skill | skill (pre-impl sweep) |
| 2026-06-05 | `image-identity-equals-bytes` | doctrine |
| 2026-06-05 | `runtime-gates-via-shared-lease` | doctrine |
| 2026-06-05 | three-band stage-D verification plan | executable (one route only) |
| 2026-06-05 | unified-delivery-surfaces | doctrine (governing contract) |

**Diagnosis:** the substrate is dense and correct; the binding is missing. No single thing an agent *runs first*. The procedure lives in the agent's head, assembled from 6+ sources, differently each time.

### 2.3 A self-reinforcing contradiction

`scripts/portal-version-check.sh:58` tells the agent, on drift, to "Rebuild/redeploy with: scripts/redeploy-portal.sh" — which AGENTS.md §5 and `image-identity-equals-bytes` **forbid** for feature verification. The one drift tool that exists points at the one banned remediation. Inconsistent pointers are a structural cause of sporadic behavior.

## 3. Target architecture — one procedure, three parts

### 3.1 The preflight (executable fact) — `BI-85433710`

A surface-agnostic, deterministic resolver. **It computes a verdict; it changes nothing.** Separation of fact (preflight) from action (skill) is the design's spine.

**Inputs:** the feature's required commit (`featureSha`, defaulting to the branch-under-test HEAD) and the live install's served identity (`/api/platform/version` + `/api/platform/image-version`).

**Output (machine-readable):**

```jsonc
{
  "verdict": "CAN-TEST" | "MUST-ADVANCE" | "BLOCKED",
  "reason": "served bytes contain feature commit <sha>",
  "served":  { "sha": "<sha|null>", "source": "git-sha|content-hash|unreachable" },
  "feature": { "sha": "<sha>" },
  "nextAction": {
    "kind": "drive-happy-path" | "trigger-self-upgrade" | "file-blocker-bi",
    "detail": "..."
  }
}
```

**Decision logic (total, no ambiguity):**

1. Portal unreachable / no image-version marker → **BLOCKED** (`nextAction: file-blocker-bi` — install not serving).
2. Served identity is a **content-hash** (not a git SHA) → cannot prove the feature is present → **MUST-ADVANCE** (governed self-upgrade restamps a SHA).
3. Served identity is a **git SHA**:
   - `featureSha` is an ancestor of (or equal to) `servedSha` (`git merge-base --is-ancestor`) → **CAN-TEST** (`nextAction: drive-happy-path`).
   - else → **MUST-ADVANCE** (`nextAction: trigger-self-upgrade`, then re-preflight).

The preflight wraps existing substrate (the two `/api/platform/*` endpoints, the version-tracking lib) and introduces **no new data sources**. The verdict-computation is a pure function (`apps/web/lib/verify/preflight.ts`), unit-tested as a truth table, and reused by both the CLI shim and (later) an MCP tool so all three surfaces hit identical logic.

#### 3.1.1 Source-free release ancestry amendment — `BI-FFBDDD96`

The original decision table assumes the process that owns a Git-stamped served
image can also consult a Git object store. That assumption is false for a
consumer release install by design: the image has an immutable source revision,
while the installed runtime contains neither a checkout nor `.git`.

The preflight therefore distinguishes **served identity** from **ancestry
authority**. A Git SHA proves which source revision produced the image; it does
not prove that a Git repository is present at runtime. The server-side adapter
must reuse `readInstallHostProfile()` from
`apps/web/lib/install/host-profile.ts` and project its closed
`source | consumer | unknown` classification into the pure verdict input. That
existing adapter owns the governed host-mount evidence: `.install-mode`, `.git`
presence, and the release image tag. Verification must not add a second raw
install-state reader or infer provenance from a caller assertion.

| Provenance | Ancestry result | Verdict |
| --- | --- | --- |
| any built install | equal or prefix-equal feature/served SHA | `CAN-TEST` |
| any built install | Git proves ancestor | `CAN-TEST` |
| any built install | Git proves not-ancestor | `MUST-ADVANCE` |
| source-backed | uncomputable | `BLOCKED` with the existing Git repair |
| source-free release (`consumer` or `customer`) | uncomputable | `MUST-ADVANCE` through `/ops/self-upgrade` |
| unknown installation provenance | uncomputable | `BLOCKED` |

`consumer` and `customer` remain the only source-free mode markers interpreted
by `readInstallHostProfile()`. A release image tag without a mode marker may
also establish its existing `consumer-release-install` classification, while a
consumer marker paired with Git source is contradictory and therefore
`unknown`. Unknown or malformed identity remains fail-closed. CLI calls made
from a source checkout remain source-backed unless they consume the same
validated host profile.

This does not claim containment from a release label alone. When no repository
can prove ancestry, the consumer-safe fact is only that containment is
unprovable on the running bytes. The governed response is `MUST-ADVANCE`, not a
request to mount source into a production image. After an advance, exact
feature/served identity can establish `CAN-TEST` without Git; richer immutable
release provenance may later prove older ancestors, but it must enter through
the same adapter and may not add another verdict or deployment path.

The CLI and MCP/server adapters must produce the same result for the same
validated provenance. Focused tests cover source-backed, source-free, unknown,
equal-SHA, proven-ancestor, and proven-not-ancestor cases, and assert that no
source-free recovery text mentions `DPF_REPO_ROOT`, mounting `.git`, or installing
Git.

##### Governed scope manifest

**OBJ-EXACT-IDENTITY:** Equal immutable served and feature SHAs are testable without a source checkout.

**OBJ-CONSUMER-ADVANCE:** Uncomputable ancestry on a validated source-free release uses only the governed self-upgrade path.

**OBJ-FAIL-CLOSED:** Source-backed, contradictory, or unknown installation evidence never infers containment.

**OBJ-SURFACE-PARITY:** CLI and MCP adapters use the same verdict core and the same governed advance action.

**OBJ-ACTIONABLE:** Source-free recovery guidance never asks an operator to mount Git or set `DPF_REPO_ROOT`.

| Acceptance ID | Objective IDs | Acceptance statement |
| --- | --- | --- |
| AC-EXACT-IDENTITY | OBJ-EXACT-IDENTITY | Equal full or unambiguous-prefix SHAs return `CAN-TEST` without consulting a Git object store. |
| AC-CONSUMER-ADVANCE | OBJ-CONSUMER-ADVANCE | Uncomputable ancestry on a validated consumer release returns `MUST-ADVANCE` through `/ops/self-upgrade`. |
| AC-FAIL-CLOSED | OBJ-FAIL-CLOSED | Source-backed, contradictory, and unknown host evidence remains `BLOCKED` when ancestry cannot be computed. |
| AC-SURFACE-PARITY | OBJ-SURFACE-PARITY | CLI and MCP produce the same verdict and next action for the same validated host evidence. |
| AC-ACTIONABLE | OBJ-ACTIONABLE | Consumer recovery text omits `DPF_REPO_ROOT`, `.git` mounts, and Git-install guidance. |

### 3.2 The entry-point skill (decision + the stop-rule) — `BI-35A92FB6`

One `dpf-platform` skill, `dpf-verify-on-live-install`, is **step zero** of any "does the feature work on the live install" task. It runs the preflight and follows the tree:

- **CAN-TEST** → drive the happy path (Chrome MCP / coworker), record runtime verification evidence, done.
- **MUST-ADVANCE** → trigger the governed self-upgrade (the *only* sanctioned advance), then re-preflight. Bounded retry.
- **BLOCKED** → **the hard stop-rule.** If blocked by an unrelated defect (e.g. main does not build in Docker), the skill **files a BI for that defect and STOPS the verification task.** It does *not* silently become a build-infra fix. Context-switching to fix the blocker is a separate, explicitly chosen body of work — surfaced to the operator, never an implicit continuation. *This single rule ends the §2.1 trace at minute ~6.*

The skill enforces `structural-verification-is-not-functional`, `worktree-is-source-control-not-runtime`, and `image-identity-equals-bytes`, and composes after `dpf-evidence-before-diagnosis`.

### 3.3 Faster, classified failure handling (so the stop-rule is cheap, not lossy)

The stop-rule only works if the BLOCKED reason is *actionable*. Two supporting pieces:

- **Classified build-gate diagnostics (`BI-E4CBC7C1`).** The self-upgrade promoter already captures the failure log; a classifier matches the known recurring classes (host-vs-Docker hoist divergence; Turbopack NFT duplicate-asset cascade; bundle-boundary static import) and returns `{class, playbookLink, failingTrace, isMainDefectVsEnvironment}`. The agent gets the diagnosis without reproducing the build from zero.
- **Fast static bundle-boundary guard (`BI-98AF1066`).** A pre-commit + CI check that traces route/Inngest entrypoints → import graph and flags Docker-only/promoter modules pulled into the server bundle, plus the triage doc's "Option A" undeclared-import check (depcheck/knip). Surfaces *all* Docker-only failures in seconds, source-local, instead of serially across 40–90s Docker builds.

### 3.4 The thin-adapter seam (Claude/Codex daily churn) — `BI-C5E03376`

Claude Code and Codex ship capabilities almost daily. Per Unified Delivery Surfaces invariant 4, the **contract stays stable; surfaces adapt.** The preflight contract — *verdict + served-SHA source + the one governed advance action* — is surface-version-agnostic. New tool capabilities plug in at the adapter layer (how the skill drives the happy path, how it triggers self-upgrade) and never require editing the contract. A standing checklist evaluates each new Claude/Codex capability against the contract so changing tool capabilities are absorbed **procedurally, not by re-architecture**. If a rule would break on next week's Claude/Codex bump, it belongs in an adapter, not here.

**Standing checklist — evaluate every new Claude Code / Codex capability against the contract** (run when a tool ships a capability that touches verification: a new browser/computer-use mode, a new dispatch/sandbox primitive, a new MCP transport, a new "run the app" affordance):

1. **Does it change the *verdict*?** The contract is `verdict ∈ {CAN-TEST, MUST-ADVANCE, BLOCKED}` + served-SHA source + the one governed advance. A new capability must not add a verdict, a fourth state, or a second advance path. If it seems to, it's an *adapter* feature — wire it in step 4/5 of the skill, not here.
2. **Which adapter slot does it fill?** Exactly one of: *how we read served identity* (today: `/api/platform/*`), *how we drive the happy path* (today: Chrome MCP / coworker), *how we trigger the governed advance* (today: `/ops/self-upgrade`). Name the slot; if it fits none, it's out of scope for verification.
3. **Does it tempt a bypass?** A faster "just rebuild the portal" / "just run it in the worktree" capability is a contract violation regardless of how convenient — it breaks `image-identity-equals-bytes` / `worktree-is-source-control-not-runtime`. Reject the bypass; keep the governed path.
4. **Does it weaken the stop-rule?** Any capability that makes "context-switch into fixing the blocker" frictionless still does NOT make it implicit — BLOCKED still files a BI and stops. Ease of pivot ≠ authority to pivot.
5. **Record, don't pin.** If the operator adopts the capability as the default adapter, record it in the skill's adapter notes; never hard-pin a tool version in the contract (mirrors AGENTS.md §17 client-config discipline).

Net: a Claude/Codex release can change *every adapter* and the preflight core, its tests, and this contract stay byte-for-byte unchanged.

### 3.5 Anti-scatter binding

This spec is the single source of truth. AGENTS.md §5 names the preflight+skill as step zero and **points here**; the skill docs point here; `portal-version-check.sh` is reconciled to point at the governed advance (`BI-6B31D9FF`). No rule is copied into two places.

```
              ┌─────────────────────────────────────────────┐
  "verify     │  dpf-verify-on-live-install  (skill, §3.2)   │
   feature    │  ─ runs preflight, follows the tree, STOPS   │
   on live"   └───────────────┬─────────────────────────────┘
                              │ runs first
                     ┌────────▼─────────┐   wraps    ┌──────────────────────┐
                     │ preflight (§3.1) │──────────► │ /api/platform/version│
                     │ pure verdict fn  │            │ /api/platform/image- │
                     └────────┬─────────┘            │ version + git        │
            CAN-TEST │  MUST-ADVANCE │  BLOCKED      └──────────────────────┘
                ▼            ▼             ▼
         drive happy   governed       file blocker BI
         path + record self-upgrade   + STOP (classified
         evidence      then re-flight  reason, §3.3)
```

## 4. Research & Benchmarking (per AGENTS.md §10)

- **CI required-checks (GitHub Actions / GitLab).** A gate is green by its *result*, not its author or the path taken to produce it. Adopted: the preflight emits a single verdict the skill branches on; the verification is provenance-agnostic, mirroring "evidence not provenance."
- **Kubernetes readiness/liveness probes.** A probe is a cheap, deterministic, side-effect-free check that gates traffic. Adopted: the preflight is a readiness probe for "can I trust this runtime to test against," distinct from the action that advances it (mirrors probe-vs-controller separation). Rejected: making the probe itself mutate state (the §2.1 antipattern of conflating "check" with "fix").
- **`terraform plan` vs `apply`.** Plan computes a diff and a proposed action; apply executes. Adopted directly: preflight = plan (verdict + nextAction), skill = apply (governed advance). The operator/agent reads the plan before any mutation.
- **Make / Bazel staleness.** Build systems compare a target's inputs to its built artifact and rebuild only on drift. Adopted: served-SHA-vs-feature-SHA ancestry is the staleness check; CAN-TEST ≈ up-to-date, MUST-ADVANCE ≈ stale.
- **Anti-pattern identified (internal).** Prior DPF attempts emitted *doctrine after each failure* (six principles) without an executable. Stating the rule did not change behavior because the agent still had to assemble and run the procedure itself. The gap this spec fills is precisely *executable*, not *normative*.

## 5. Binding

1. **This spec** is authoritative for the procedure; everything else points here.
2. **AGENTS.md §5** ("Where each gate runs") names `dpf-verify-on-live-install` + the preflight as step zero of live-install functional verification (`BI-C5E03376`).
3. **dpf-platform skill chain:** `dpf-evidence-before-diagnosis → dpf-verify-on-live-install → dpf-finishing-a-development-branch`.
4. **Tooling reconciliation:** `portal-version-check.sh` / `.ps1` point at the governed self-upgrade path, not `redeploy-portal.sh` (`BI-6B31D9FF`).
5. **No new kernel principle** unless a durable rule emerges that is not already covered by the four related principles in the frontmatter. The deliverable is executable, not doctrinal.

## 6. Implementation slices (engine-light first)

- **Slice 1 (self-verifiable source-local):** preflight pure-verdict core + truth-table tests (`apps/web/lib/verify/preflight.ts`); reconcile the `portal-version-check` remediation pointer. Green via `vitest` + `typecheck` — no live portal required (and deliberately so: fully driving this work hits the very problem it solves).
- **Slice 2:** CLI shim (`scripts/dpf-verify-preflight.mjs`) + the `dpf-verify-on-live-install` skill with the stop-rule; AGENTS.md §5 binding + thin-adapter checklist.
- **Slice 3:** build-gate failure classifier (`BI-E4CBC7C1`) feeding the BLOCKED reason.
- **Slice 4:** fast static bundle-boundary / undeclared-import guard (`BI-98AF1066`) in pre-commit + CI.
- **Slice 5:** MCP-tool exposure of the preflight so Build Studio / in-portal coworkers hit the identical verdict (closes surface-agnosticism).

## 7. Acceptance

- An agent asked to "verify feature X on the live install" runs ONE thing first and gets a verdict + one next action; it never hand-rolls the git/curl skew comparison.
- A BLOCKED verdict from an unrelated build defect produces a filed BI and a stopped task — never an unbounded pivot into infra work.
- A self-upgrade build-gate failure returns a classified, actionable reason without local reproduction from zero.
- Docker-only build failures surface in seconds via a source-local static check.
- The procedure is defined once; AGENTS.md, skills, and tooling are pointers; no contradictory remediation remains.
- The preflight contract is unchanged by a Claude Code / Codex capability bump; only adapters move.

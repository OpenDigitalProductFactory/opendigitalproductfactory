# Manufacturing Process Spine — reliable, observable, enforced-by-construction

- **Date:** 2026-08-05
- **Status:** Draft (founder-initiated; WWMD/portfolio scope)
- **Epic:** EP-PROCESS-SPINE (this spec is its Ideate output)
- **Scope:** platform (the manufacturing process is shared by every surface, thread, and install)
- **Author:** Claude (Opus 4.8), on founder direction
- **Adjacent epics (cross-link, do not duplicate):** EP-413F2602 (product-architecture fitness gates), EP-AGENT-INSTRUCTION-PLANE (agent instruction/decision plane), EP-WSID (coworker corpus/decision seed)

---

## 1. Problem

The founder's observation, verbatim in effect: research, specification, and testing are increasingly done *after* the work; testing varies by client (Claude / Codex / Grok) and even thread-to-thread; **most PRs fail CI at least three times**, causing heavy rework; WWMD and WSID specialists (e.g. UX design) go unconsulted; there is churn waiting on the shared sandbox; skills and the MCP server work sometimes and not others; the tools we built to inspect code, surfaces, and doc blast-radius "may or may not be used — suspected not, because they were found broken"; test coverage is constantly hand-adjusted per PR; and webhooks had to be added to *force* an agent that "clearly was not following process" — with the honest question left open: **was the process ambiguous, or optional?**

### 1.1 The single root cause

**The process is advisory and heterogeneous.** Every agent, in every client, in every thread, *voluntarily chooses* whether to follow the steps — using tools that are sometimes broken, with the pass/fail verdict arriving at CI instead of locally.

This inverts the platform's own **Reduction Gear** principle: the correct path should be the path of *least* resistance. Today the correct path is the path of *most* resistance — extra tool calls, shared-sandbox waits, flaky MCP/skills, and gates that only run after push. So agents rationally shortcut it, and "optional or ambiguous?" resolves to: **in practice, optional.**

### 1.2 The doctrine already prescribes the cure — it just isn't enforced

This is not a call to invent a new process. `AGENTS.md` already states the right answers; they are advisory prose, not gates:

- **§11 already defines a process-spine health check** and says "A session with retired process skills visible and no DPF replacement is DPF-precedence-unproven — repair or restart before project work." This exact signal is live in the current session: `DPF-native replacement skills loaded/exposed in this session: UNKNOWN — DPF cannot prove replacements are loaded.` **We cannot prove the spine is loaded, so we cannot expect conformance, and we cannot measure the gap.**
- **§12 already states the keystone:** "Governance approves evidence, not provenance — a gate reads its required evidence fields; it never asks which surface produced them." This is the intended cure for client/thread divergence. Divergence persists because the evidence-gating is *incomplete* — where a step has no required, machine-checkable receipt, each surface improvises.
- **§4 build gate, §5 plan-before-build, §7 research-required** are all real — but test *right-sizing* is prose judgment ("affected files", "any UI change"), so it is re-decided per agent and per client.

### 1.3 The reinforcing loops (why symptoms cluster)

| Observation | Loop |
|---|---|
| Research/spec/test done *after* the work; specialists skipped | **A — Declared, not gated.** Steps are norms, not required machine-checkable inputs. |
| Claude/Codex/Grok test differently; thread-to-thread variance | **B — No provable single spine.** The live `UNKNOWN loaded` signal; each surface improvises. |
| PRs fail ≥3× → rework | **C — Feedback is push-time, not local.** Source-only worktrees cannot pregate, so failures surface in CI. |
| Sandbox churn; MCP/skills work "sometimes" | **D — Flaky shared infra.** Contention plus host-pressure phantom failures. |
| Blast-radius / surface tools "found broken → not used" | **D → trust death-spiral.** A tool that fails once is never trusted, so never used, so never fixed. |
| "May or may not be used — I suspect not" | **E — No conformance observability.** Suspicion, not data. (The new MCP-use logging is the first step out of E.) |

---

## 2. Design principle: reliability → observability → enforcement (in that order)

The ordering is load-bearing, not cosmetic:

- **You cannot enforce a process built on flaky tools.** Mandating an unreliable tool multiplies churn instead of removing it.
- **You cannot enforce what you cannot measure.** Ratcheting a step from advisory to required blindly will block legitimate work and erode trust.

Therefore the intervention proceeds in three phases. **Phase 3 (enforcement) must not begin for a given control until Phases 1–2 prove that control's tool is reliable and its conformance is measured.** The strategic reframe: *stop trying to make agents comply, and make the compliant path the cheapest path (Reduction Gear); then measure the residual gap; then gate only that.*

### 2.1 Work is not one-size-fits-all — work-type shapes the process (founder, 2026-08-05)

The process must never apply one gate profile to every change. **Work-type is a first-class input**, alongside diff-shape:

| Work-type | PR? | Test depth | Sandbox |
|---|---|---|---|
| **break-fix / hotfix** | **usually NO PR** — the targeted hotfix path | the regression test that proves the fix, not the full suite | only if runtime-bound |
| **doc-only** | PR, but **minimal** — no code tests | link/doc gates only | none |
| **small / chore** | PR | minimal, scoped to the change | batched (see §2.2) |
| **feature / schema / cross-cutting** | PR | full four-gate (§4) | batched sandbox run |

When the work-type is **ambiguous, classify it *with the person who gave the instruction* before acting** (AGENTS.md §1, classify-ambiguous-requests) — never silently default to the heaviest or lightest profile. WS6 is therefore keyed on **work-type as well as diff-shape**, and its output includes *whether a PR is even required* and *how deep the tests go*, not just *which checks run*.

### 2.2 Batch before the sandbox — end the 1-BI→1-PR bottleneck (founder, 2026-08-05)

The observed saturation (15 builds vs a 3 cap; ~100 stale capsules) was **made worse by a 1-BI → 1-PR → 1-sandbox-lease pattern**: every small item consumed a scarce shared lease. The spine **batches compatible, non-conflicting BIs into ONE sandbox run and ONE PR** (a single coherent concern), reserving a dedicated lease only for genuinely independent or conflicting work. Batching is a **Phase-1 throughput lever (WS10)**, not a Phase-3 nicety — it directly relieves the same contention WS3 targets. This spec applies its own rule: Phase 1's WS1+WS3+WS9 ship as **one batched capsule (WC-3B8A9E08) → one PR**, not three lease-consuming cycles.

---

## 3. Research & Benchmarking (per AGENTS.md §7)

How the industry solves "make a multi-actor build process reliable and conformant," and what DPF adopts:

- **Paved Road / Golden Path (Netflix, Spotify).** The supported path is made the easiest path; deviating costs effort. **Adopt** — this *is* Reduction Gear; it is the organizing principle of this spec. DPF's twist: the "developers" are heterogeneous AI agents across four surfaces, so the paved road must be enforced by evidence-receipts the coordination plane checks, not by human habit.
- **Policy-as-Code (Open Policy Agent / Conftest; GitHub required status checks).** Merge policy is declarative, versioned, and identical for every actor. **Adopt/adapt** — DPF already has this shape (pregate, ratchets, required checks). The gap is that *which* checks are required is computed inconsistently; §6 (WS6) makes the change-class → required-checks mapping a single deterministic authority.
- **DORA metrics (change-failure rate, lead time).** You cannot improve a delivery process you do not measure. **Adopt** — "most PRs fail 3×" is an unmeasured change-failure/rework rate; §5 makes it a tracked yield metric.
- **SLSA / build provenance (evidence over trust).** Gates verify signed evidence artifacts, not the identity of the builder. **Adopt** — this is exactly AGENTS.md §12's "governance approves evidence, not provenance." DPF extends it from *artifact* provenance to *process-step* receipts (research done, UX-fit done).
- **Reject:** per-surface bespoke CI (the current de-facto state) — it is the thing producing the divergence. **Reject:** enforcement-first without reliability/observability — known to erode trust and increase shadow workarounds.

---

## 4. Existing substrate to extend (verify-substrate-first)

This epic **integrates and hardens** existing threads rather than starting fresh:

- **`FB-3D0A5095` — Right-sizing matrix Phase 2** (Phase 1 shipped, PR #1348). The deterministic change-class → checks matrix already exists in Phase-1 form. WS6 extends it to be the *single authority* every surface consults, and to cover doc/tool/skill kinds.
- **`FB-AD29AC0C` — Auto-claim nonprod-environment-lease on session start.** Directly removes shared-sandbox churn. WS3 lands it.
- **`EP-AGENT-INSTRUCTION-PLANE`** — owns the clarity/disambiguation of what agents are told. WS7's "unambiguous required step" work coordinates with it (a step cannot be enforced until it is unambiguously stated).
- **The new research-MCP-use logging** (just added) is the seed of WS4's conformance ledger.
- **AGENTS.md §11 process-spine health check** is the seed of WS1's provable-spine gate.

Both `FB-*` items are `ideate`-context, "absent on this install at ingest" — good ideas that never became enforced spine. That is the pattern this epic exists to break.

---

## 5. The plan (phased workstreams → child backlog items)

### Phase 1 — Reliability & a provable spine (fixes B, D). *Precondition for all enforcement.*

- **WS1 — Provable spine load.** Turn §11's advisory "repair or restart before project work" into a machine signal: every session emits a **spine-loaded receipt** (which DPF process skills + MCP connector are actually exposed). Where the host supports hooks, project-work tools *refuse* when the spine is unproven; where it does not, the coordination plane records `spine-unproven` on any resulting work. Removes root cause B (the live `UNKNOWN`).
- **WS2 — Process-tool reliability SLOs + health probes.** Give the inspection tools (doc blast-radius, `trace_code_surface`, code-graph, search) health probes and per-tool success-rate SLOs. A tool below SLO is *auto-flagged and its finding is marked low-confidence*, not silently trusted. Breaks the trust death-spiral ("found broken → never used → never fixed").
- **WS3 — Remove sandbox contention + make source-only worktrees pre-gateable.** Land `FB-AD29AC0C` (auto-lease on session start) and make `bootstrap-worktree-deps` run by default so a worktree is compile-ready — so the CI-failure loop happens once, locally, not 3× remotely. Fixes root cause C's precondition and root cause D.
- **WS10 — Batch BIs into one sandbox lease / one PR (founder directive, §2.2).** Replace the 1-BI→1-PR→1-lease pattern with a batching orchestrator: group compatible, non-conflicting BIs (by work-type and claimed scope) into a single sandbox run and a single coherent PR; reserve a dedicated lease only for independent/conflicting work. Directly relieves the shared-lease saturation. Composes with WS6 (work-type/scope decide what may batch) and WS3 (the lease it economizes).

### Phase 2 — Conformance observability (fixes E). *Turn suspicion into data.*

- **WS4 — Process-conformance ledger.** Extend the new MCP-use logging into a per-PR / per-surface / per-thread record: for each change, was research / spec / UX-fit / blast-radius actually used, did the tool succeed, and how many CI attempts did the PR take. This is the manufacturing traveler for each unit of work.
- **WS5 — Conformance dashboard + factory-yield metrics.** Surface the ledger as DORA-style yield: **PR first-pass rate, median CI attempts per PR, spine-proven session %, per-tool success rate, and per-surface conformance**. Makes "I suspect not" a number the founder can watch trend.

### Phase 3 — Enforce-by-construction (fixes A, C). *Ratchet advisory → gated, per control, only after its Phase 1–2 are green.*

- **WS6 — Deterministic work-type + change-class → required-process matrix (single authority).** Extend `FB-3D0A5095`: **work-type AND diff-shape** together determine the required process — *whether a PR is required at all* (break-fix usually none — §2.1), *how deep the tests go* (doc-only/small → minimal), and *which checks run* (a UI route provably requires UX-fit) — computed identically for Claude/Codex/Grok/Build Studio. Kills per-thread and per-client variance in both test depth and PR discipline. Ambiguous work-type routes to the instruction-giver, never a silent default.
- **WS7 — Evidence-gated process receipts.** Make research / spec / UX-fit *required evidence fields* on the change classes that need them (per §12 keystone). The webhook becomes the *backstop* for a now-unambiguous requirement, not the primary mechanism. Coordinates with EP-AGENT-INSTRUCTION-PLANE so each required step is unambiguously stated before it is gated.
- **WS8 — Local-and-early gate as the default.** With WS3 done, pregate runs locally by default and blocks a red push; the reconciliation loop that currently costs 3 CI rounds costs one local round.

---

## 6. Success metrics (the epic is measurable)

Baseline first (Phase 2 produces it), then targets:

- **PR first-pass rate:** from "most fail ≥3×" → target **set from the measured baseline** (WS4/WS5), not a guessed number (resolved §8.2). `≥80%` is a placeholder pending that measurement.
- **Median CI attempts per PR:** → **1.**
- **Spine-proven sessions:** → **100%** (no `UNKNOWN loaded`).
- **Process-tool success rate:** each inspection tool **≥ its SLO** (e.g. 99%) before it is ever *required*.
- **Applicable-PR conformance:** % of PRs whose change-class needed research/spec/UX that carry the receipt — **measured, then ratcheted upward** rather than mandated blind.

---

## 7. Sequencing & guardrails

- **Do not start Phase 3 enforcement for a control whose Phase 1 tool is not at SLO and whose Phase 2 conformance is not yet measured.** Enforcing an unreliable, unmeasured step is the failure mode this spec exists to prevent.
- **Never apply one gate profile to every work-type (§2.1), and never spend a sandbox lease on a single small BI when it can be batched (§2.2).** One-size-fits-all gating and 1:1 lease consumption are the two founder-named anti-patterns this spine must not reintroduce.
- **One concern per PR / child BI** (AGENTS.md §3). Each WS decomposes into small landable items.
- **This spec is a WWMD/platform decision surface** — the ordering above is the recommendation; a per-control go/no-go on enforcement routes through `principle_decide` at the time each control reaches Phase 3.

---

## 8. Open questions for founder ratification

1. ~~**Enforcement teeth on hookless hosts.**~~ **RESOLVED 2026-08-05 via `principle_decide` (DI-F32A8BC90372, high confidence, margin 2.45, no commandment conflict).** Decision: **hard-refuse where PreToolUse hooks load (Claude/Grok native, Codex aliased); on a hookless host, record `spine-unproven` + loud-flag and block at the PR/evidence gate** (Option B). The hard-block-everywhere alternative (Option A) scored lower because its blast-radius / business-disruption cost (a buggy spine-detector halts all work on every host) outweighs its marginal compliance gain; Option B rides the existing §12 evidence gate. This is WS1's build contract.
2. ~~**First-pass-rate target.**~~ **RESOLVED 2026-08-05 via `principle_decide` (DI-B28DDDC3BC81, high confidence, margin 7.65).** Decision: **baseline-first** — do NOT commit to a fixed 80%/90% now; WS4/WS5 measure the real first-pass rate, then the target is set from the observed distribution. Both fixed-number options were decisively rejected (composite ~4.76 vs 12.41); the kernel weighted *Never Assume — Verify* and *Ship Real Functionality* against guessing a number before observability exists. The `≥80%` in §6 is therefore a placeholder pending measurement, not a commitment.
3. ~~**Which control ratchets first.**~~ **RESOLVED 2026-08-05 via `principle_decide` (DI-658E92827CD3, high confidence, margin 2.27).** Decision: **WS6 (deterministic change-class→checks matrix) ratchets first**, ahead of WS1 spine-proof. WS6 extends already-shipped substrate (schema-grounding), carries lower blast-radius/business-disruption, and delivers churn-reduction faster; gating the newer behavioral spine-proof channel first would risk blocking legitimate work. Top contributors: *Research and Use Standards*, *Ground New Work in Existing Platform*.

---
status: active
title: Verification-first workroom gates — making declared verification load-bearing, and raising coworker concurrency on earned trust
---

# Verification-First Workroom Gates

- **Date:** 2026-08-28
- **Scope:** platform — workroom gates, build lifecycle gate, work posture, coworker autonomy
- **Origin:** external-input review, [`2026-08-28-remote-agent-surface-transcript-review.md`](../research/2026-08-28-remote-agent-surface-transcript-review.md) §8 — a practitioner talk on scaling agent concurrency, whose central claim is that parallelism is gated by *verification*, not by capacity.
- **Status:** Design — proposed. Not decomposed into backlog items (see §10).

> **The gate proves the artifacts exist and the code compiles. It does not prove the thing ran.
> While that is true, the human is the verifier, and the number of coworkers we can run at once
> is bounded by one person's attention rather than by the platform's evidence.**

---

## 1. What is actually true today

Every row is code-verified against this branch, not inferred.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **Failing tests do not block a phase advance.** `verification-typecheck-passed` reads `evidence.verificationOut` and asserts only `typecheckPassed`. `testsFailed` is declared on the same inline type and never read. | `apps/web/lib/explore/build-process-matrix.ts` `checkRequirement`, case `verification-typecheck-passed` |
| 2 | **UX verification cannot block.** `uxVerification-not-blocking` returns `allowed` for `complete`, `failed`, `skipped` and `null`. Only the transient `running` defers. The code comment records this as an operator decision of 2026-06-07 and names the open quality problem as `BI-4BD81F3B` — "browser-use agent producing genuine, non-vacuous results". | same file, case `uxVerification-not-blocking` |
| 3 | **Acceptance is self-assessed.** `acceptance-evaluated` requires only that `evidence.acceptanceMet` be truthy. `acceptance-all-met-if-array` tightens this *only* when the value happens to be an array. A scalar truthy value passes unexamined. | same file, cases `acceptance-evaluated`, `acceptance-all-met-if-array` |
| 4 | ~~**`verificationDepth` is inert.** It is derived (`work-posture/derive.ts`), tightened through a floor (`work-posture/resolve.ts` `tightenVerificationDepth`), and rendered as chips. Its only consumers are display components. No gate reads it.~~ **CORRECTED 2026-09-06 — this finding was already stale when written.** See §1.2. | `WorkroomPosture.tsx`, `posture-display.ts`, `GoldenTriangleOutcomes.tsx`; already recorded as finding 5 of [`workroom-work-posture-design`](2026-08-22-workroom-work-posture-design.md) |
| 5 | **Nothing constrains the judge to be independent of the author.** No gate requirement, routing rule, or envelope check asserts that the model family judging an artifact differs from the family that produced it. | `GATE_REQUIREMENTS` (11 entries, none about judge identity); `apps/web/lib/model-selection` |
| 6 | **Verification that runs on the real path exists — and is not gate-bound.** Golden journeys execute through the real coworker path (real persona, real tool surface, real routing) and are judged by five mechanical oracles (`ORACLE-FABRICATE`, `ORACLE-PURITY`, `ORACLE-REFUSAL`, `ORACLE-SURFACE`, `ORACLE-TOOL`). They run on a certification *sweep*. No phase gate or workroom transition consults their verdicts. | `coworker-lifecycle/golden-journeys.ts`, `certification-runner.ts`, `certification-oracles.ts` |
| 7 | **There is no feature reachability map.** `apps/web/lib/ea/route-manifest.json` is a route *inventory* — `routePath`, `kind`, `segments`, `dynamicParams`, `file`. It carries nothing about how a *user* reaches a feature: no nav path, no entry point, no stable selector, no keyboard affordance. | `apps/web/lib/ea/route-manifest.json` |

### 1.1 The asymmetry these findings describe

DPF runs **93 non-test guard scripts** under `scripts/check-*` — Spec/Plan/Doc, Design Grounding, Doc Reference Integrity, Docs Impact, Retired Substrate, Data-Impact, Stewardship Scope, application boundaries, bundle boundaries, compose pins, build-script policy. That is unusually strong hard enforcement, and `enforced-ci-gates.md` states the operating rule outright: *a missing trailer fails the PR, not the agent's memory.*

Every one of those guards protects **the repository that builds the factory**.

The **workroom** — where in-portal coworkers do customer work — has, at the runtime tier, exactly one hard check: the code compiles. Tests are informational, UX verification is advisory, acceptance is self-reported, and the declared verification depth is decorative.

**DPF has hard gates on the code that builds the factory and soft gates on the work the factory does.** Findings 1–7 are that one sentence seen from seven angles.

### 1.2 Correction to finding 4 — recorded 2026-09-06

Finding 4 claimed no gate reads `verificationDepth`. That was **already false on the day this design was written**, and is now false twice over. Recorded here rather than silently edited, because the reason it was wrong is the reason §10's blocking precondition existed.

1. **The action path was already bound, five days earlier.** `BI-13ED1BE1` (EP-WORK-POSTURE, Slice E) shipped in PR #4591 / `a5da024b4` on **2026-08-23**. `resolveVerificationRequirement` (`work-management/hitl-join.ts`) fuses the declared depth with `RiskClass.outbound-or-floor`, and `evaluateWorkCasePolicy` denies a consequential action by name — `missing_verification_evidence` — when verification is required and no evidence carries a `verifiedAt`. That item's own body states Defect 1 in the same terms this design's finding 4 uses. The design was authored without live backlog state (see §10), so it re-derived a problem the platform had already fixed at a different enforcement point.

2. **The build phase gate is now bound in shadow.** PR #4880 / `48a7492bd` (2026-09-02) landed Change A per §4.1 — `verification-depth-satisfied` in `GATE_REQUIREMENTS`, evaluated on every transition and recorded to `BuildActivity`, changing no verdict.

**What survives.** The two bindings enforce at *different points* and are not duplicates: BI-13ED1BE1 governs whether a coworker may take a consequential **action**; §4.1 governs whether a build may cross a **phase boundary**. The accurate form of finding 4 is narrower and still true as of `433d90325`: *the build-process phase gate did not read `verificationDepth`* — `GATE_REQUIREMENTS` carried 11 entries and none concerned depth.

**What this costs the rest of the design.** §4.1's depth table and BI-13ED1BE1's requirement now define "deep" differently — a three-tier evidence ladder versus a binary requires-verification floor. Reconciling them is unowned work; until it is done, one declaration means two things. Before Phase 3 binds anything, that reconciliation is a precondition, not a cleanup.

## 2. Why this is a design problem, not seven bug fixes

Each finding could be patched alone, and patching them alone would be a mistake, because the thing they jointly cause is not a set of defects — it is a **ceiling**.

The originating source frames it as a trust curve: an operator running agents can only parallelize as far as they trust the output, and trust comes from verification the operator did not have to perform personally. The talk's load-bearing line:

> "If you don't have a verification skill, you are the verifier. You're the bottleneck. You tell your agent to do something and then it goes off and writes some code, then you open up your local dev build... you're constantly in the loop and being a bottleneck. So there's really no way to parallelize."

Map that onto DPF. A workroom advances when documents exist, a plan was reviewed, and `tsc` succeeded. Whether the change *works* is established by a person opening the portal. So coworker concurrency is bounded by operator attention, and every proposal to widen autonomy has to be argued from optimism rather than from evidence — because the evidence that would settle it is not collected at the gate.

That is why the fix is one design. Making tests blocking without a trustworthy UX check just moves the bottleneck. Making the UX check blocking before it produces non-vacuous results teaches everyone to route around it. Widening autonomy before either is what `dpf-establish-coworker` already warns about: *a missing floor is how weak local models produce fabricated "Done" replies.*

## 3. Principles adopted

Four, each traced to the source and reconciled with existing DPF doctrine.

**P1 — Enforcement has layers, and a rule must declare which layer it lives on.** The source ranks them: architecture and conventions (strongest, because agents copy surrounding patterns), then CI hard failure, then static analysis, then rules/skills/review-bots (weakest). Its warning: *"if you only have rules and bugbot and skills and a style guide for your code, it's only a matter of time before your codebase looks like complete trash."* DPF already believes this at the repository tier; the principle is simply not stated, and is not applied at the workroom tier. **A rule enforced only by a skill is a wish.**

**P2 — A rule a human enforces by reading is an anti-pattern with a work item attached.** The source, verbatim: *"if you are stuck in code review land where you enforce all of the invariants by literally the human person reading the code — every time you have to do that, you should consider that an anti-pattern. Instead of me commenting on the PR, how do I turn this into a hard rule? A lint rule? A CI failure? Or how do I categorically eliminate this problem entirely?"* This is the trigger DPF's commons routing lacks (F5 of the source review): a repeated human correction is a *missing gate*, and should file one.

**P3 — Verification means the thing ran.** Not that a document asserts it was verified. DPF already has this shape in golden journeys — real path, mechanical oracle — and does not use it at a gate.

**P4 — The judge is not the author.** The source, on evaluating skills: *"you can have a judge agent of a different model to cross reference and make sure the first model is not being biased."* This independently corroborates F3 of the source review, and upgrades it from a proposal to a practice someone runs in production. It is consistent with [`governance-approves-evidence-not-provenance`](../../founder-kernel/wiki/principles/governance-approves-evidence-not-provenance.md), which forbids a gate from branching on *which surface* produced evidence and says nothing about whether an author may grade its own work.

### 3.1 Adopted with modification

**P5 — Make the shortest path the correct path.** *"Agents love to take shortcuts... so why not make that the best way to solve the problem?"* DPF's version is not banning constructs; it is tooling ergonomics. Where doctrine asks for a slow correct route and the environment offers a fast wrong one, the environment is the defect.

### 3.2 Rejected, with reasons

Recorded so they are not re-proposed from the same source.

- **Auto-merge on agent verdict.** The source's endpoint is agents merging PRs unattended, reviewed afterwards on `main`. DPF forbids this: changes land via the merge queue and an agent may never approve or merge. This is not timidity about the same goal — it is a different goal. DPF's endpoint is **higher coworker concurrency under gates**, not unattended merge. Everything upstream of the merge decision transfers; the merge decision does not.
- **Banning code comments.** The source bans them in CI, on the grounds that agents write irrelevant historical narration. DPF handles that failure at the right layer already (`dpf-unslop`), and DPF's doctrine deliberately encodes contingency markers (`⟦runtime:⟧`, `⟦model:⟧`) *in* prose. A ban would delete a governance mechanism to fix a style problem.
- **Rewrite for architectural strictness.** The source argues greenfield vibe-coded applications are the biggest risk and may warrant rewriting. By its own analysis DPF is in the good position — brownfield with guardrails already in place. Nothing here justifies a rewrite.

## 4. Design

Four changes. A, B and C are gate mechanics; D is workroom guidance. Composition over new substrate throughout: no new tables, no replacement engines.

### 4.1 Change A — make `verificationDepth` load-bearing

Bind the already-resolved depth to the gate. Add one requirement to `GATE_REQUIREMENTS`:

```
"verification-depth-satisfied"
```

It compares the **declared** floor (from `work-posture/resolve.ts`, already computed and already tightened) against the **observed** depth of the evidence on the transition:

| Declared depth | Observed depth required to pass |
| --- | --- |
| `none` | nothing — byte-identical to today |
| `shallow` | typecheck passed **and** `testsFailed === 0` |
| `deep` | `shallow`, **and** at least one verification that executed on the real path with a mechanical verdict (a golden-journey result, or a UX verification whose status is `complete` and whose result is non-vacuous) |

Two properties make this safe to land:

1. **It changes nothing where depth is not declared.** Absent or `none` resolves to today's behaviour exactly, preserving the matrix's stated back-compat invariant.
2. **It makes an existing declaration mean what it says.** Where the posture layer already resolves `deep` — marketing, payroll, the outward-facing and money-moving shapes — the platform currently renders a chip promising verification it does not perform. That is the defect being fixed. Finding 5 of the posture design says so in its own words: *"'Marketing and payroll require verification' is currently unenforceable."*

### 4.2 Change B — tests and UX verification become depth-tiered

- **Tests.** `testsFailed` is already carried on `verificationOut`. Read it at `shallow` and above. This is one line of logic with a wide blast radius, so §6 stages it behind a report-only period.
- **UX verification.** Keep `uxVerification-not-blocking` as-is at `shallow`. At `deep`, require `complete` plus a non-vacuous result.

The operator decision of 2026-06-07 is **respected, not overridden**. That decision was that a CLI-developed, committed, serving build should ship on the CLI's evidence rather than be blocked by a browser-use result. Under this design it still does — that path resolves to `shallow`. What changes is that work the posture layer has *already classified as high-stakes* gets a real check.

**Ordering constraint, and it is the most important sentence in this spec:** UX verification must not become blocking until `BI-4BD81F3B` (non-vacuous browser-use results) is closed. A gate that fires on a check people do not trust does not raise quality; it teaches everyone to route around the gate, and burns the credibility of every gate next to it. Change C is what makes that check trustworthy, which is why it precedes B in the plan.

### 4.3 Change C — the feature reachability map

The verifying agent currently has a route inventory and no idea how a person reaches a feature. The source describes exactly this failure and its cure:

> "It had no idea what the agent's window was... someone would say the left sidebar is laggy, and the agent would just be flailing around... this feature map has been really useful because it teaches the agent how to get to all of the features that you have."

DPF's symptom is already filed: `BI-4BD81F3B`, non-vacuous UX results. An agent that cannot navigate to the surface under test produces a vacuous pass. This is the same problem with the same cause.

**Extend the existing route manifest rather than adding an artifact.** A reachability layer over `route-manifest.json`:

- **feature** → the routes that compose it
- **entry points** → how a user arrives (nav item, command, deep link)
- **stable selectors** → the attributes a driver can target
- **preconditions** → the seeded persona and state needed to see it

Derive what is derivable (routes, nav configuration, existing test ids); curate the rest. Freshness is enforced the way DPF already enforces manifest freshness — a `--check` mode in CI, exactly as `doc-impact.generated.json` and the route manifest are kept fresh today.

This is the highest-leverage change in the design. It is a prerequisite for B, and it independently improves every browser-driven verification the platform runs.

### 4.4 Change D — concurrency and autonomy earned from measured verification

The workroom guidance change. Today `verificationDepth` derives from shape and stakes — properties of *the work*. The dimension the trust curve turns on is missing: **the demonstrated reliability of this coworker on this kind of work.**

The substrate exists and is disconnected:

- certification sweeps already produce per-coworker, per-oracle verdicts with stable finding keys;
- DAME already requires escalation rate to be *measured per coworker* (`OBJ-DAME-004`);
- the autonomy envelope already decides HITL from trust level, risk class and regulatory ceiling.

The rule: **a coworker's concurrency and autonomy are functions of its measured verification record, not of operator optimism.** Sustained green oracles on a work class widen the envelope; a fabrication finding narrows it immediately and asymmetrically — trust is earned slowly and lost at once, which is both correct governance and correct management.

This deliberately **extends rather than duplicates** finding 8 of the posture design ("the posture never reaches the autonomy envelope"). That finding owns the *join* between the two ladders. This design contributes the *input* the join needs: an evidence-derived reliability signal. The decomposition in §9 of that spec remains the owner of the join itself.

## 5. Research & Benchmarking

Required by AGENTS.md §7. Compared before adopting.

| Approach | What it does | What DPF adopts / rejects |
| --- | --- | --- |
| **dependency-cruiser** (open source, Node) | Analyses the import graph against declared forbidden rules; exits non-zero so CI fails. Used to build "architecture fitness functions" that keep a codebase on its intended design, and to catch circular dependencies and orphans. ([Xebia](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/), [lastminute.com](https://technology.lastminute.com/how-we-enforce-architecture-boundaries-at-scale-on-our-app/)) | **Already covered, hand-rolled.** DPF enforces the same class of rule through `check-application-boundaries.mjs` and `check-bundle-boundaries.mjs`. Adopting the library would swap bespoke guards for a dependency without changing behaviour. Rejected — but it confirms the repository tier is at industry standard, which is the point of §1.1. |
| **Nx module boundaries / ESLint boundary plugins** | Tag-based allow-lists on cross-module imports, enforced at lint time. ([Stefanos Lignos](https://www.stefanos-lignos.dev/posts/nx-module-boundaries)) | Same verdict. Lint-tier enforcement; DPF is already at CI tier for this concern, which P1 ranks higher. |
| **Cursor's internal architecture (described in the source talk)** | Feature-per-directory colocation, banned constructs failing CI, import-graph checks between process boundaries, a review bot layered on top, plus a feature map and control skill giving agents real verification. Proprietary; known only from the talk. | **Adopt the verification half, reject the ban half.** The feature map (§4.3) and real-path verification (§4.1) are the transferable parts. The construct bans are framework-specific to Electron/React and to a codebase where humans have stopped reading code. |
| **DPF's own golden journeys + oracles** | Real-path probes with mechanical verdicts, already built, already running on sweeps. | **The chosen substrate.** §4.1's `deep` tier consumes these rather than introducing a parallel verification concept — `verify-substrate-before-proposing-new`. |

**What the comparison establishes:** nothing in this design is novel at the repository tier, where DPF already meets or exceeds the standard. The novelty is entirely in applying that same discipline to the *runtime* tier, where the industry comparison set is thin because most tools verify code and DPF must verify *work*.

## 6. Risks and how the design contains them

| Risk | Containment |
| --- | --- |
| Making tests blocking strands in-flight work on pre-existing failures | Report-only period first (§7 Phase 2). AGENTS.md §4 already requires pre-existing failures be noted and not silently deferred; the report surfaces the true count before anything blocks. |
| A blocking UX gate people do not trust | Hard ordering: C before B; `BI-4BD81F3B` closed before UX blocks at any depth. Stated in §4.2. |
| Depth binding tightens gates nobody expected | Depth `none`/absent is byte-identical to today. The blast radius equals the set of work already declaring `shallow`/`deep`, which is enumerable before landing. |
| Judge-independence unsatisfiable when one family is reachable | Follow `OBJ-DAME-006`: surface as a finding, record the receipt as single-family, never silently pass. This is the same shape the escalation design already uses for an unsatisfiable tier floor. |
| The feature map rots | CI `--check` freshness, matching how the route manifest and doc-impact graph are already kept fresh. A stale map is worse than none, because it produces confident wrong navigation. |
| Scope creep into an autonomy redesign | §4.4 contributes an input signal only. The ladder join stays owned by the posture design's §9. |

## 7. Sequence

Detail, task breakdown and rollback: [`2026-08-28-verification-first-workroom-gates.md`](../plans/2026-08-28-verification-first-workroom-gates.md).

1. **Feature reachability map** (Change C) — unblocks everything else.
2. **Depth binding, report-only** (Change A, shadow mode) — emit what *would* have blocked; change no verdict.
3. **Tests blocking at `shallow`** (Change B, first half) — after the report is clean.
4. **UX blocking at `deep`** (Change B, second half) — only after `BI-4BD81F3B`.
5. **Judge independence** (P4) — kernel gap capture first, then decision, then enforcement.
6. **Earned-trust envelope input** (Change D) — last; it consumes the record the earlier phases start producing.

## 8. Doctrine changes this implies

- **New kernel principle — enforcement layers are ranked.** P1, promoted to doctrine so it holds offline and ships with every install.
- **New kernel principle — a repeated human correction is a missing gate.** P2, and the trigger `dpf-route-learning-to-commons` currently lacks.
- **AGENTS.md §4** — the UX verification bullet currently says "exercise the affected path against the running app" without defining what evidence that produces. Give it an evidence shape tied to the depth ladder.
- **`dpf-route-learning-to-commons`** — add the twice-is-a-pattern trigger from P2.

## 9. What this design does not do

- It does not change the merge model, add auto-merge, or let an agent approve anything.
- It does not touch the 93 repository guards. They are the part that works.
- It does not introduce a new verification engine, table, or evidence store.
- It does not raise any coworker's autonomy. It builds the measurement that would let that be argued from evidence later.

## 10. Verification status of this document

Findings 1–7 are code-verified on this branch and cite the files.

~~**Backlog coverage is absent.**~~ **RESOLVED 2026-09-06 — the epic-overlap check ran against live state.** Recorded below; the original text is preserved in git history.

The check the original §10 asked for was run against the live database on 2026-09-06 with `DPF_MCP_BEARER_TOKEN` set and the MCP server reachable. Results:

| Named neighbour | Live state |
| --- | --- |
| `EP-WORK-CONVERGENCE` | Exists. Does not own depth binding. |
| `EP-1C37C089` | Exists, but is **mislabelled in the plan as "gate binding"**. Its real title is *TAK alignment control surface — WWWD×WSID governance gate on consequential tool use*. Adjacent, not this. |
| `EP-QUALITY-RIGHTSIZING` | **Does not exist.** No match across all 80 epics. |
| `EP-COWORKER-LIFECYCLE` | Exists. Owns certification and oracles (finding 6), not depth binding. |
| **`EP-WORK-POSTURE`** | **The actual owner, and not named in the original list.** Slice E, `BI-13ED1BE1`, owns making `verificationDepth` load-bearing — see §1.2. |

**`BI-4BD81F3B` does not exist in the live backlog.** It returns `not_found`. It is cited only from a code comment in `build-process-matrix.ts`. §4.2 makes it the hard ordering precondition for Phase 4, so **Phase 4 is currently gated on a backlog item that was never filed.** Filing it — or replacing the reference with whatever really tracks non-vacuous browser-use results — is a precondition for Phase 4, not a formality.

**Status of the design as a whole.** The problem statements remain code-verified apart from finding 4 (§1.2). Phase 2 is delivered (`BI-30165EB4`) and its report is at [`2026-09-06-verification-depth-shadow-report.md`](../audits/2026-09-06-verification-depth-shadow-report.md). Phases 3–6 remain proposals; Phase 3 has two open preconditions named in that report.

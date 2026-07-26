# DPF Development Model & Frontier-Harness Positioning — Consolidated Strategy

> **2026-07-25 implementation companion:** Governed model x method experimentation and the
> evidence-bounded autonomous Build Studio consumer are specified in
> [`2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md`](2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md).

- **Status:** approved-direction (kernel-consulted; see §10)
- **Authored:** 2026-07-12
- **Epic anchors:** EP-1155CEF3 (doc consolidation), EP-27FD96BC (reasoning economy), EP-0AF96937 (decision governance), EP-F7E35344 (capability inputs)
- **Supersession:** this document is the narrative **entry point** for the DPF development model. It does not replace the specs it cites (§11 appendix maps topic → authoritative spec and marks superseded drafts).

---

## 1. Thesis

DPF develops software through a **tiered, evidence-gated, decision-governed pipeline** that runs the same lifecycle across four peer surfaces (Build Studio embedded, Claude Code, Codex, Grok as host CLIs). The 2025–26 industry evidence says this is the structurally correct bet — and that the next moves are (a) collapsing the pipeline's per-feature latency and cost toward **one-shot features** where the evidence base permits, and (b) letting the WWMD/WWWD/WSID decision corpora answer more of the gate questions that today still stop for a human.

The strategy is NOT to imitate frontier harnesses' one-shot-a-whole-product demos. Fable 5's headline capability is real (Anthropic: "apps that took a hundred prompts a year ago, it now one-shots"; Stripe migrated a 50M-line codebase in a day), but those wins are either greenfield artifacts or mechanically-verifiable migrations. DPF's problem class is different: **durable features inside a large live platform, for an org and a hive of installs, built mostly by AI coworkers under a non-technical operator.** For that class the binding constraints are context curation, machine-checkable gates, tiered review, and maintainability ratchets — pipeline properties, not model properties (§4).

## 2. The DPF development model, told once

The story is currently fragmented across ~15 specs (inventory in §11). Told as one narrative:

1. **Intake & demand.** Work enters as a `BacklogItem` (closed `workType` × `source` axes) under an `Epic`; triage assigns `triageOutcome` and `effortSize`. Governed backlog tee-up promotes up to 3 build-ready BIs/day into Build Studio drafts (`apps/web/lib/governed-backlog-tee-up.ts`).
2. **Right-sizing (three axes).** `(type × size)` lifecycle matrix (`apps/web/lib/explore/build-process-matrix.ts:327`) ⊔ **deliverable sensitivity** (low/elevated/high from BI text + org risk posture; monotonic escalation only) ⊔ the **golden-triangle dial** (Cost/Quality/Time posture, default pinned Quality 0.8). Skipping a phase = its gate auto-passes; the phase graph never changes. Small chores run plan→build→ship; xlarge anything must decompose first.
3. **The lifecycle.** `ideate → plan → build → review → ship`, two nested state machines: a governance phase graph (`feature-build-types.ts:571`) and a checkpointed, resumable execution step machine (`build-pipeline.ts:71`). Phase handoffs are structured records (evidence digests), not chat history. Specs, plans, reviews, and acceptance are **first-class DB columns** on `FeatureBuild` — gates read evidence, never conversation.
4. **Gates.** ~20 distinct gates (full inventory: Build Studio process map, §3 of the research record). Nearly all are automated: dual-AI design/plan review with oscillation detection, the WWMD plan→build kernel gate (fail-closed), releasable-diff, typecheck, pre-PR security/destructive-SQL/architecture gates, CI required checks, Spec/Plan/Doc + UX-Fit + Seed-Fit attestation gates, watchdogs and reapers for unattended operation. **One intentional human gate remains in-pipeline: the "Ship to GitHub" click.** Post-PR, the human residue is whatever escalations the decision ladder can't clear.
5. **Decision governance.** Two engines. *Engine A* — `principle_decide`: advisory kernel consult over 92 tiered principles (commandment/core/contextual, structured dimension scoring with semantic fallback), ledgered as `DecisionInteraction`. *Engine B* — the Decision Perspective Gate: blocking, profile+material scored (`confidence = MEAN(effective weights) − risk/override penalties`), with the confirmation ladder unconfirmed B/0.6 → confirmed A/0.9 → ruled A/1.0 and fail-closed escalation. WWMD governs platform work, WWWD governs org business calls (non-inherit boundary), WSID grounds profession craft (prompt-injection today, not yet a gate). Escalations land in the founder-review attention queue; resolutions write back to the corpus ("remember this" → ruled A/1.0 stance).
6. **Surfaces & coordination.** Four peer surfaces, one process (AGENTS.md §17). MCP is the coordination plane: WorkCapsule claims, evidence records, unified WIP. Governance approves **evidence, not provenance** — which is exactly what makes surfaces swappable thin adapters.
7. **Verification & release.** Build gate (tests/prod-build/UX/migration), shared local-CI convergence sandbox via lease, merge queue on required checks, governed self-upgrade with image-identity assertions, release batching. Learnings route to the commons (WWMD/WWWD/WSID/AGENTS.md) and to the hive.

## 3. Frontier harnesses — where each stands (mid-2026)

| Tool | Process model | Gates / quality | Cost levers | One-shot-feature fitness (brownfield) | Governance fitness |
|---|---|---|---|---|---|
| **Claude Code / Fable 5** | plan mode + ultraplan (cloud plan review) → local/cloud/agent-team execution → /code-review → ultrareview (verified findings) → PR | permission modes, OS sandbox, hooks as programmable gates, REVIEW.md policy, verified-finding review | effort tiers (low→max; xhigh default-class), model tiers Haiku→Fable ($1/$5→$10/$50), fast mode, cache reads 0.1× | **Strongest.** 1M ctx, brownfield proof points; Opus 4.8 xhigh is the cost-sane default, Fable for hardest passes | Managed settings/MDM, hierarchical CLAUDE.md, analytics + spend caps; research→design→build composable but not a pipeline primitive |
| **OpenAI Codex** | cloud task (isolated container) + best-of-N → review queue → PR; `@codex` from issues/Slack/Linear | sandbox × approval matrix, `approvals_reviewer` machine gate, /review primitive, AGENTS.md standard | model tiers Sol/Terra/Luna ($5/$30→$1/$6), reasoning effort, native compaction (−30% tokens), bundled in ChatGPT plans | Strong on long-horizon; weakness: env-setup fidelity for gnarly monorepos, compaction occasionally drops standing rules | Config-profile convention, younger central-policy plane |
| **Cursor** | Plan Mode (research + clarify → editable plan) → IDE/cloud agents (worktrees) → Bugbot + security review → PR with **video artifacts** | Team Rules (org precedence), Bugbot precision review, hooks; **no AI-activity audit trail** | Composer 2.5 at ~1/10 frontier cost, multiplier tiers, Bugbot per-run | Very good human-in-loop; unattended one-shots need frontier models at frontier prices | Strongest admin console (SSO/SCIM/RBAC/MDM) but best-effort sandboxing, audit gap |
| **Grok Build** | plan-approval → up to 8 parallel worktree subagents → diffs; headless CI mode | per-tool approvals, hooks, fleet `requirements.toml`, sandbox profiles | cheapest tokens (grok-code-fast-1 $0.20/$1.50; 4.5 ~4.2× fewer output tokens than Opus), 90% caching | Trailing single-pass accuracy (SWE-bench ~17pts behind); good cheap first-pass/second-opinion engine | Credible for a beta; single-vendor, ecosystem immature |
| **opencode** | Plan/Build agents + Explore/Scout subagents → your git flow; GitHub Action loop; server+SDK | permission framework, doom-loop detection, plugin hooks, LSP diagnostics | free OSS harness, 75+ providers, Zen at-cost gateway, per-agent model mix | Model-dependent; best raw material, least opinionated discipline | Central config/SSO/gateway-lock, but no SOC2/audit substrate |

**Positioning readout.** Every harness is converging on DPF-shaped ideas — plan gates, worktree isolation, machine review layers, AGENTS.md, evidence artifacts (Cursor's videos, Codex's review queue). None of them has: (a) a **decision corpus** that answers gate questions from organizational doctrine with a confidence ladder and an audit ledger; (b) **evidence-not-provenance** gate contracts making surfaces interchangeable; (c) an **org/hive durability layer** (WorkCapsule graph, commons routing, self-upgrade fleet). Those three are DPF's moat. Conversely, the harnesses are ahead of DPF on: verified-finding review depth (ultrareview), effort-tier cost routing as a default-on lever, native compaction economics, research/design as packaged capabilities, and best-of-N attempt parallelism.

## 4. What the 2025–26 evidence says

The load-bearing findings (full citations in the research record; primary sources: DORA 2025 + 2026 ROI, Stanford ~100k-dev program, METR RCT + 2026 update, GitClear 2026, Stack Overflow 2025, Swarmia, Anthropic engineering):

1. **Greenfield/brownfield asymmetry is the central quantified fact:** 35–40% AI uplift on simple greenfield vs ≤10% (often single digits) on complex legacy code. One-shot demos are greenfield; DPF's work is brownfield.
2. **DORA 2025: AI amplifies existing conditions** — throughput up, stability *down* wherever tests/feedback/VCS discipline are weak. A governed pipeline is precisely the control system that converts AI speed into value.
3. **GitClear 2026: maintainability is measurably degrading** under ungoverned AI output (duplication +81% since 2023, refactoring −70%, error-masking +47%). Only repo-level ratchets catch this — DPF's module-size/table/ratchet guards are the right species.
4. **Review is the new bottleneck** (PR sizes ~doubled; time-in-review +441% in one 22k-dev dataset). Pipelines must restructure review — tiering, AI pre-review, spec-stage review — not just queue more of it.
5. **Graduated autonomy is the consensus**, not full autonomy: auto-merge only low-risk well-tested changes; risk-tiered human gates; separation of duties between generating and verifying agents. Full delegation is empirically viable for ~0–20% of tasks. DPF's sensitivity axis + confidence ladder is this, already built.
6. **Bounded loops with machine-checkable oracles are what make cheap one-shots real** (Ralph-loop economics: $297 MVP; but spec-less unbounded loops → "architecturally incoherent" output). The loop is cheap; the harness is the asset.
7. **Context engineering beats raw model power in large codebases** — compaction at phase boundaries into structured artifacts (~95% context reduction), sub-agent isolation, external memory. DPF's phase-handoff digests are exactly this pattern; they should be treated as a named competitive feature, not plumbing.
8. **Effort routing has displaced model routing as the primary cost lever** (40–60% pipeline-spend cuts from per-request effort allocation); prompt-cache discipline (reads at 0.1×) rewards stable structured prompts — governed pipelines are structurally cheaper per unit of quality than ad-hoc frontier usage.
9. **AI code needs more review, and AI review works** — AI-coauthored PRs carry ~1.7× more issues; best reviewers with repo context + execution catch 58–82%. Stacked AI-then-human review is standard practice.
10. **SDD tooling is popular but unproven** (Spec Kit, Kiro); the durable value is spec-*thinking*, not ceremony. DPF already has spec-thinking as DB-native artifacts — avoid importing SDD ceremony on top.

**Net read:** DPF should not defend its process by asserting governance is good; it can defend it with this evidence — and should *tune* it where the same evidence says the harnesses found cheaper mechanics (effort routing, compaction economics, verified review).

## 5. One-shot features, not one-shot products

**Definition.** A one-shot feature = a BI that enters the pipeline and exits as a merged, evidence-complete PR **in a single governed pass** — no human touches between "Approve Start" (auto under governed backlog) and merge, because every gate question was answered by evidence or by the decision corpora. The phases still exist; they collapse in *latency and interaction count*, not in evidence.

**What already enables it** (all shipped): auto-advance chain across all phase boundaries; matrix-driven gate auto-pass; WWMD plan gate with fail-closed escalation; dual-AI reviews; typecheck + releasable-diff gates; watchdogs making unattended runs safe; merge queue + required checks as the outer oracle.

**What still stops every feature today:**
1. The **Ship-to-GitHub human click** — intentionally the last in-pipeline human gate.
2. **Unconfirmed WWWD seeds clear nothing** (B/0.6 → effective 0.45 < every band): medium+ risk business-flavored gate questions all escalate until stances are confirmed (Phase-3 setup step unshipped).
3. **Doctrine-blind transitions**: only plan→build consults the kernel; ideate approval and review→ship are mechanical.
4. **Advisory-only UX verification** and typecheck-only in-loop quality: fine for the current human-backstopped flow, thin for autonomous merges of low-risk work.

**The lane** (roadmap items §9): for `feature/fix × small|medium × low-sensitivity` work, grant a **one-shot lane**: single dispatch produces research→spec→plan in one compacted pass (phase records still written), build+verify runs bounded self-fix, review runs a *verified-finding* pass (ultrareview-class: findings must be reproduced before they block), and ship auto-fires when (a) the confidence ladder clears the ship-decision at the work's risk tier, and (b) all machine oracles are green. High/elevated sensitivity keeps the human click — that is the graduated-autonomy consensus, and it is already DPF doctrine via the sensitivity floor.

## 6. Cost strategy — lower cost, hold quality

Priority-ordered, per the evidence in §4 and the cost-knob inventory in the research record:

1. **Turn on what's built.** `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING` and `DPF_BUILD_MODEL_TIER_ROUTING` are default-off. The quality-first matrix routes robust models everywhere except the trivial tail (small doc/chore) — this *raises* quality where it matters and *cuts* spend on the tail. Activate behind evidence (per-build cost is already captured from the Claude CLI envelope).
2. **Effort tiers as the primary lever, not model swaps.** The per-agent `defaultEffort`/`budgetClass` plumbing exists (`tak/agentic-loop.ts:289`) but no in-loop classifier drives it (EP-27FD96BC P1). Wiring effort-warrant classification is the single highest-leverage cost item: industry data says 40–60% pipeline-spend cuts.
3. **Cache-discipline the pipeline.** Stable prompt prefixes (system + tool schemas first) across specialist dispatches; cache reads at 0.1× reward exactly the structured, repetitive prompt shapes Build Studio already emits. Audit the dispatch prompts for prefix stability.
4. **Compaction economics.** Phase-handoff digests already exist; extend the same discipline inside the build phase (task-boundary compaction, tool-result budgets are in place) so long builds do not pay quadratic context tax.
5. **One-shot lane** (§5) removes the most expensive unit of all: idle human-gated latency and re-orientation cost between phases.
6. **Claude billing mode.** OAuth/Max flat-rate vs API-key metering is already selectable per provider; keep flat-rate for the high-volume lanes, metered for burst.

Quality is held by the same moves: quality-first routing spends *more* on high-sensitivity work by construction; verified-finding review (§9 R4) raises review precision while cutting noise; and every autonomy expansion is gated by the confidence ladder, never by optimism.

## 7. Gate automation via WWMD / WWWD / WSID

Current coverage (from the governance research record): the **plan→build** transition is doctrine-gated (blocking, fail-closed) and demand funding is WWWD-gated on main; coworker business calls route through the org gate; everything else is mechanical or attestation-only. The residue that still reaches the founder is dominated by: unconfirmed stance seeds (by construction), high/critical risk (always escalates — correct), non-build escalations lacking a resolution path, and questions that don't map onto the four `domainClass`es.

Direction (BIs in §9):
- **Extend Engine B to the remaining lifecycle decisions** — ideate-start ("should we build this now") and ship ("is the evidence sufficient to merge at this risk tier") — so the confidence ladder, not a hardcoded human click, decides where autonomy stops. This is *the* mechanism that makes the one-shot lane governed rather than reckless.
- **Ship the stance-confirmation fast path** (EP-0AF96937 Phase 3 / BI-D6DC2432): until owners can confirm seeded stances in bulk, WWWD clears nothing at medium+ risk and every "one-shot" business-flavored feature stalls by design.
- **Give WSID a gate consumer.** Profession profiles (`wsid-*`) are seeded but no decision surface reads them; "what should this coworker do" questions score against WWWD materials or nothing. For coworker-scoped features (the "single AI coworker + human" tier), WSID is the natural gate corpus.
- **Attestation → evidence.** UX-Fit/Seed-Fit CI gates check trailer strings; upgrade them to verify a persisted `DecisionInteraction` (BI-65DEE968 direction) so the PR plane and the decision ledger stop being parallel truths.

## 8. Claude capabilities as first-class pipeline steps

Both capabilities decompose into API/SDK-available building blocks (server-side `web_search`/`web_fetch` with citations, Agent SDK subagents/hooks, Skills API, MCP connector, Managed Agents with gradeable outcome rubrics) — nothing requires Anthropic's consumer products.

**Deep research → the ideate phase.** Adopt the orchestrator-worker + adversarial-verification pattern (Anthropic's system beat single-agent by 90.2%, at ~15× tokens — reserve for warranted cases): a governed *research-before-spec* step that fans out searches (standards, prior art, competitive practice), adversarially verifies claims, and emits a **cited research report attached to the design doc as evidence**. Trigger by right-sizing: mandatory for large/thorough features, skippable for the trivial tail. DPF already researches inside ideate via CLI dispatch; the upgrade is verification + citations + a durable artifact the design review can gate on.

**UX design → ideate + review phases.** Three adoptions: (1) **design-system-as-skill** — encode DPF's theme-aware styling rules (`var(--dpf-*)`, report-kit composition, anti-slop guidance) as a versioned skill loaded by every UI-generating dispatch; (2) **propose-N-directions** at the UX-Fit gate for net-new surfaces (3–4 concrete visual directions, gate on a pick — the sanctioned substitute for temperature-driven variety); (3) **screenshot-verification loop as a review stage** — the sandbox already runs browser-use UX verification; extend it to multi-viewport + light/dark screenshot sets attached to the PR, with an a11y pass (axe-core, keyboard tab-through) as an advisory-then-ratcheted check.

## 9. Roadmap (filed as BIs under existing epics)

| # | Item | Epic | Why |
|---|---|---|---|
| R1 | Reconcile development-process doc authority: supersession markers on the right-sizing trilogy + cost-doc drafts; pointer appendix maintained here | EP-1155CEF3 | §11 contradictions; consolidation is this doc's other half |
| R2 | Activate Build Studio cost flags behind evidence: quality-first rightsizing + model-tier routing defaults, with per-build cost telemetry review | EP-27FD96BC | §6.1 — shipped code, dormant value |
| R3 | One-shot feature lane: single-pass research→spec→plan dispatch + auto-ship for small/medium low-sensitivity work when ladder + oracles clear | EP-27FD96BC | §5 — the cost/latency headline |
| R4 | Verified-finding review stage: findings must reproduce (ultrareview-class) before blocking; separation of generate/verify duties | EP-27FD96BC | §4.9 — review precision at lower noise |
| R5 | Graduated gate autonomy: Engine-B doctrine gates on ideate-start and review→ship, ladder-driven auto-ship at low risk | EP-0AF96937 | §7 — the governance mechanism for R3 |
| R6 | WSID gate consumer for coworker-scoped decisions | EP-0AF96937 | §7 — third scope has no gate |
| R7 | Research-before-spec step: governed deep-research harness (fan-out, adversarial verify, cited report) as ideate evidence, right-size-triggered | EP-F7E35344 | §8 |
| R8 | UX-design capability stage: design-system-as-skill + propose-N-directions at UX-Fit + screenshot/a11y verification set on PRs | EP-F7E35344 | §8 |

Dependencies: R3 depends on R5 (governed ship) and benefits from R2/R4; R5 depends on stance confirmation (existing BI-D6DC2432) for business-flavored questions. R1, R7, R8 are independent.

## 10. Decision record

Deliverable shape was kernel-consulted (`principle_decide`, 2026-07-12): **consolidated doc + BIs into existing epics** recommended at high confidence (composite 9.46, margin 2.44) over a new umbrella epic and over doc-only. Rationale echoed by `check-epic-overlap-before-creating` and `single-source-of-truth`: the four target epics already own these problem spaces; a fifth umbrella would re-fragment them.

## 11. Appendix — topic → authoritative source (and superseded drafts)

| Topic | Authoritative today | Superseded / stale (mark on sight) |
|---|---|---|
| Process meta-model | `2026-05-30-development-process-spine-design.md` | — |
| Surfaces & alignment | `2026-06-05-unified-delivery-surfaces-execution-alignment-design.md` (+ AGENTS.md §17) | — |
| Right-sizing | `2026-06-23-quality-first-risk-aware-build-rightsizing-design.md` + `build-process-matrix.ts` (code is truth) | `2026-05-30-build-studio-right-sizing-design.md` (draft; cheap-default reversed), `2026-06-22-build-studio-model-tier-routing-design.md` (folded into quality-first) |
| Cost doctrine | `docs/design/golden-triangle-design.md` + this doc §6 | `2026-05-19-ai-cost-governance.md` (never left draft) |
| Decision governance | `2026-07-04-decision-governance-surface-redesign-design.md`, `2026-07-11-wwwd-stance-onboarding-design.md` | `docs/architecture/autonomy-and-wwmd.md` predates three-scope frame (update, don't trust for scope boundaries) |
| Tracking & WIP | `2026-06-19-unified-build-studio-tracking-all-surfaces-design.md`, `docs/architecture/unified-development-tracking.md` | — |
| Verification | `2026-06-06-procedural-functional-verification-design.md`, AGENTS.md §5 | — |
| Undocumented (gap; see EP links in §9) | coworker lifecycle/certification, reasoning-economy strategy (EP-27FD96BC), demand management, vertical-integration bets | — |

External evidence citations live in the research record produced for this doc (Stanford/DORA/METR/GitClear/Stack Overflow/Swarmia/Anthropic engineering; harness docs for Claude Code, Codex, Cursor, Grok Build, opencode).

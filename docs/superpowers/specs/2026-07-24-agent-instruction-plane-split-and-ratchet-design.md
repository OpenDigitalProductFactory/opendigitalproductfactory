# Agent instruction-plane split, discriminator reconciliation, and a re-accretion ratchet

- **Backlog item:** BI-0020D511 — "Agent instruction-plane audit: 32k always-on preamble, and prose/code discriminator drift on load-bearing rules"
- **Status:** Design (decision-bearing), independent architecture-review pass incorporated (§11). No code in this document.
- **Author:** Claude (external_coding_agent), 2026-07-24
- **Kernel decision:** `principle_decide` → **Option B (split + ratchet)**, high confidence, composite 17.742, margin 0.522, interaction `DI-F844365B0DCC` (ledger in §3).
- **Coordinates with:** BI-C5A31A24 (decision-routing enforcement — owns the guard change), BI-ACC7A2B5 (unmarked runtime-assumption audit — same files), BI-5FE47130 (specialist-doctrine migration out of the kernel — corpus tier).
- **Substrate touched at implementation time:** `AGENTS.md`, `CLAUDE.md`, `packages/dpf-skill-pack/hooks/`, `apps/web/lib/mcp-tools.ts`, `apps/web/lib/wiki/ppr.ts`, `apps/web/lib/mcp/packs/wiki-pack.ts`, `scripts/` (new ratchet guard).

---

## 1. Problem, re-measured at `origin/main` (b863e5c5c2)

BI-0020D511 was scouted on a branch (`claude/feature-flags-modularity-d5725e`) that is now behind `origin/main`, and it explicitly asks the implementing thread to re-measure. Every figure below was re-taken on `origin/main @ b863e5c5c2`. The BI's numbers hold, with the deltas noted — and the growth *between* the two measurements is itself evidence for the ratchet (Workstream 4).

| Plane | BI figure | Re-measured @ b863e5c5c2 | Note |
|---|---|---|---|
| `AGENTS.md` | 108,413 chars / ~27.1k tok | **112,507 chars / 367 lines / ~28.1k tok** | **+4,094 chars in ~1 day** — active accretion |
| `MEMORY.md` (client index) | 18,877 chars / ~4.7k tok | **18,877 chars** | exact |
| `CLAUDE.md` + `CONVENTIONS.md` | 438 chars | **438 chars** (194 + 244) | exact |
| Client memory corpus | 353 files / ~1.72M chars | **353 files / 1,729,791 chars** | exact |
| `feedback_*` memory files | 91 | **91** | exact |
| Kernel principle `.md` files | 95 | **101 files / 499,111 chars** | +6 files, +28k chars |
| `mcp-tools.ts` | 104,918 chars / 1,909 lines | **105,955 chars / 1,922 lines** | ~26.3k tok |
| MCP `listChanged` | `false` @ route.ts:333 | **`false` @ route.ts:333** | confirmed |
| Live MCP catalog (`tools/list`) | ~250 tools | **223 tools, single response, no cursor** | confirmed no server-side disclosure |

**Two material refinements the audit could only make against the live substrate — both change the design:**

### 1a. The always-on plane is *pointer-forced*, not harness-injected

There is **no `SessionStart` hook that injects `AGENTS.md`** (`.claude/settings.json` `SessionStart` runs only `worktree-freshness`). `CLAUDE.md` is a **pointer**: *"Read /AGENTS.md at the repo root before any work."* In this very audit session, only `CLAUDE.md` (438 chars) was auto-loaded; `AGENTS.md` entered context because the agent *obeyed the pointer and read the whole file*.

This is not a caveat — it is **the control point for the split.** The ~28k-token cost is incurred by a read the pointer *instructs*. If the pointer instructs the agent to read a small doctrine file always, and names the procedure/history files as *on-demand* reads, the split is enforced at the pointer with zero harness changes. The BI's "ALWAYS-ON, every thread" is true in effect but the mechanism is softer than "injected", and the softer mechanism is what makes the fix cheap.

### 1b. The kernel corpus is *already in the graph* — the BI's Workstream 6 premise was half wrong

The BI states the kernel corpus and memory index "are markdown-with-`[[links]]` that are NOT yet in the WikiPageLink graph, so PPR cannot traverse them." Direct DB inspection (`dpf-postgres-1`) refutes the kernel half:

- **170 `principleTier` WikiPages**, **121 `isKernel` pages**; `pageKind` distribution `principle:170, heuristic:42, entity:41, summary:34, stance:17, index:1, runbook:1, decision:1`.
- **575 `WikiPageLink` edges**; **87 principle pages are link sources, 93 are link targets** — principles already participate in the graph.
- A live ingestion pipeline exists (`apps/web/lib/wiki/ingest.ts`), and `wiki_query` already exposes `retrievalMode: "vector" | "ppr"` with PPR over the per-org `WikiPageLink` subgraph (`apps/web/lib/mcp/packs/wiki-pack.ts:48`), defaulting to `vector` until an org switches `wikiRetrievalMode`.

**Provenance — it is a current 1:1 mirror, not a stale/partial copy** (checked, because "reuse already done" is what sank Option C in §3 and must not rest on drift): the three counts reconcile exactly. The **101 canonical kernel principle pages** (`isKernel=true`, `organizationId IS NULL`, `pageKind='principle'`) map **1:1 to the 101 source `.md` files** in §1. The **170 `principleTier` pages** = 101 canonical + **68 org-derived variants** (`isKernel=false`, org-scoped, via `kernelPageId`/`derivedFromKernelVersion`) + 1 org-local principle. The **121 `isKernel` pages** = 101 canonical principle pages + 20 kernel pages of other `pageKind` (heuristics/stances). No gap is unexplained; the kernel-graph reuse is genuinely banked.

What is genuinely **not** in the graph: **`AGENTS.md` (0 WikiPage rows)** and the **client memory files**. So Workstream 6 is not "ingest the kernel" (done); it is the much narrower, and mostly *deferred*, question of whether the *always-on prose* should become retrievable graph nodes. §6 treats this honestly, and it is why the graph option lost to B in the kernel scoring.

> Methodology note, per `never-conclude-x-doesnt-exist-from-a-list`: both refinements come from `admin_query_db`-class direct queries against the live DB and config, not from reading a file listing. The MCP read tools were not available in this worktree session (per-worktree seed gap, BI-noted); the audit used the raw Postgres container and the authenticated MCP HTTP endpoint directly.

---

## 2. The four problems, restated as this spec sees them

The BI's four problems survive re-measurement. Restating them so the split falls out cleanly:

1. **Bloat by inline detail, not duplication.** `AGENTS.md` largely obeys "pointers, not copies" (46 distinct principle links). The weight is *accreted inline detail* — ~306 chars/line across 367 lines — because the file does three jobs at once: **doctrine** (belongs always-on), **operational runbook** (belongs in skills, already built), and **incident history** (belongs in specs/BIs, already there). §340 (work-scope routing) is the canonical example: one ~2,000-char paragraph carrying rule + rationale + 2 spec links + 3 BI numbers + a failure anecdote + a branch-versioning caveat.
2. **Conflict: low count, high severity.** Drift appears only where a load-bearing rule is *restated in different words* in a second plane. The proven instance is `consult-scopes-before-asking` across five planes, with **prose keyed on AUDIENCE** ("before asking a **human**") and **code keyed on SHAPE** (`options.length < 2 → skip`, then a vocabulary deny-list). §5 reconciles this.
3. **Recall failure is why 1 and 2 matter.** §340 *was in context* and was still missed. Past a threshold, more always-on prose buys *less* reliably-applied rule, because a rule buried mid-paragraph in an 18-section file is invisible at the moment of action ("lost in the middle"). This is the argument **for** enforced guards on twice-failed rules and **against** solving compliance by adding prose.
4. **The MCP tool plane pays the full catalog to every non-Claude-Code client.** 223 tools, ~26.3k tokens, `listChanged:false`, no cursor. Claude Code survives only because the *client* defers the catalog (ToolSearch). Any other connected agent pays it all. §7 decides where this lives.

---

## 3. The decision, routed through the kernel

Per DPF governance (`consult-scopes-before-asking` is a commandment) and the goal's explicit instruction, the approach was **not** pre-picked. Four architecturally-distinct options were scored with `principle_decide` (`callingPopulation: external_coding_agent`, `tieMargin: 0.2`, full 20-axis feature vectors, structured coverage **strong**, semantic fallback ratio **0**, 36 principles applied, no commandment conflict).

| Option | Composite | |
|---|---|---|
| **B — Structural split + size/token ratchet + reconcile proven discriminators** (defer graph & MCP to siblings) | **17.742** | **recommended, high confidence** |
| D — Enforcement-first (guardify every twice-failed rule) | 17.219 | close second |
| C — Graph-native doctrine retrieval (ingest AGENTS.md+memory, PPR per task) | 14.082 | |
| A — In-place prose shrink only (no structure, no ratchet) | 6.525 | |

**Margin B→D = 0.522** (> tieMargin, so high confidence; no human escalation required). Interaction recorded as **`DI-F844365B0DCC`**, profile `mark-dpf-platform` (platform).

**Where B wins (per-principle contribution delta vs D, top signals):**

| Principle | Tier | B | D | Δ |
|---|---|---|---|---|
| Single Source of Truth | commandment | 0.530 | 0.407 | +0.123 |
| Research and Use Standards | commandment | 0.775 | 0.659 | +0.116 |
| Ground New Work In Existing Platform | commandment | 0.544 | 0.459 | +0.085 |
| Architecture Over Shortcuts | commandment | 0.514 | 0.438 | +0.076 |
| Proper Fix Over Quick Fix | commandment | 0.357 | 0.283 | +0.074 |
| Structured Handoffs, Not Conversation History | core | 0.296 | 0.244 | +0.051 |

**Where D wins (marginally):** security-enforcement commandments — *validate input*, *least privilege*, *never hardcode secrets*, *respect license terms* (Δ ≈ −0.05 each). These read as "more enforcement," which is exactly the strength the design **absorbs from D** rather than discards.

**Reading of the ledger.** B and D are close and complementary. B is the *spine* — the structural split plus a ratchet — and it wins on **Single Source of Truth**, the precise principle for de-conflicting restated rules. D's enforcement idea is folded in as a *bounded* sub-rule: **a rule that has failed twice graduates from prose to an enforced guard, and its prose then shrinks to describe the guard's test** (§5). C loses because its central reuse premise (ingest the kernel into the graph) is already done (§1b) and its remaining move — lazy-retrieving doctrine — carries a correctness hazard: the most load-bearing rule ("consult the kernel *before* acting") must be present *before* the agent acts, and lazy retrieval cannot guarantee that. A loses because "shrink the prose but change nothing structural" re-accretes by the next session — as the +4,094-char/day measurement already demonstrates.

**Decision: implement B, with D's guardify-twice-failed sub-rule, and treat C as a deferred, narrowed follow-on (§6).**

---

## 4. The split — doctrine / procedure / history

The organizing rule: **keep a section always-on only if an agent needs it *before and during every action, before it could know to fetch anything else*.** That is doctrine. Everything else is fetched when the task selects it.

### 4a. Tier definitions

- **Doctrine (always-on).** The rules and first principles that must be in context before the agent can even decide what to read next: first principles, the mandatory commandment *statements* (build gate, PR-against-main + DCO, typed enums, no-hardcoded-colors, consult-scopes-before-asking, never-wipe-db), the tool-authorization *principle*, the data-stewardship *principle*, and a one-paragraph architecture orientation. **Stated once, as the rule, with a link to its skill/spec for the how and the why.**
- **Procedure (on-demand skills).** The step-by-step: how to open a PR, how to file a BI, how to write a plan, how to run the build gate, the skill-discovery catalog, the tool-grant tables, the theme-styling how-to. **These skills already exist and already work** (30 DPF skills). Doctrine keeps the *trigger* ("work enters via a BI") and hands the mechanics to the skill.
- **History (spec + BI links).** Incident anecdotes, "this failed 3× / see BI-XXXX," dated architecture snapshots, branch-versioning caveats. **Already in the specs and BIs they cite** — the always-on plane keeps at most a one-line pointer.

### 4b. Concrete allocation of the 17 sections (measured)

Per-section sizes were measured on `origin/main`. The single biggest lever is **§16 Skill Discovery (17,445 chars)** — a catalog of skills with trigger regexes, which is *pure procedure* and duplicates what the skill system already surfaces.

| § | Section | Chars | → Tier | Move |
|---|---|---|---|---|
| 16 | Skill Discovery | 17,445 | **Split: Doctrine (sub-rules) + Procedure (catalog)** | The **per-skill catalog table** (the bulk) → a `dpf-skill-index` reference. But §16 is **not** pure procedure: its skill-precedence rules (DPF-over-generic, intra-pack disambiguation / `composesFrom` ordering, the dual-surface authoring contract, the process-spine health-check contract) are **doctrine** — they govern behaviour *before* an agent would know to fetch a skill index — and **stay always-on**. Only the lookup table moves. |
| 17 | Delivery Surfaces & Execution Alignment | 15,476 | **Doctrine (rule) + History** | Keep the surface-agnostic *contract* (§17's own doctrine, cited by Problem 4); move the runbook detail + anecdotes to spec links. |
| 6 | Backlog & Planning | 12,639 | **Procedure** | → `dpf-file-backlog-item` + `dpf-writing-plans` (exist). Keep: "work enters as a BI; plan before build." |
| 5 | Verification — Build Gate | 10,472 | **Doctrine (rule) + Procedure** | Keep the mandatory-gate commandment; move the step list to a build-gate skill/reference. |
| 4 | Branching, Commits & PRs | 10,357 | **Procedure** | → `dpf-pr-with-dco`, `dpf-finishing-a-development-branch` (exist). Keep: "PR against main; DCO-sign every commit." |
| 8 | Tool Authorization | 8,292 | **Procedure/reference** | Grant tables → reference; keep the authorization *principle*. |
| 12 | UI — Theme-Aware Styling | 6,993 | **Doctrine (rule) + Procedure** | Keep "theme-aware mandatory; no hardcoded colors" (commandment); move how-to to the UI skill + design tokens. |
| 2 | Project Architecture (*"current as of 2026-04-27"*) | 6,044 | **History/reference** | Dated snapshot → living arch doc; keep a one-paragraph orientation. (Coordinate with BI-ACC7A2B5: the stale-date marker is an unmarked runtime assumption.) |
| 1 | First Principles | 5,363 | **Doctrine** | Keep. This is the core. Tighten only. |
| 11 | Data Model Stewardship | 4,188 | **Doctrine (rule) + Procedure** | Keep the stewardship principle; move procedure to `dpf-data-architecture-steward`. |
| 10 | Design Research | 3,195 | **Doctrine (rule) + Procedure** | Keep "design research required in every spec"; move how-to. |
| 3 | Strongly-Typed String Enums | 2,225 | **Doctrine** | Keep (mandatory). Tighten. |
| 13/9/8a/15/7/14 | (small) | ~8,100 total | **mixed** | Pointerize or keep-small per the same test. |

### 4c. Measured token target and the ratchet

- **Current:** 112,507 chars (~28.1k tokens) always-on.
- **Target:** **≤ 45,000 chars (~11.3k tokens)** for the doctrine plane — a **~60% reduction** — with a stretch of ~35k. The bulk comes from moving §16, §4, §6, §8, and the procedural halves of §5/§11/§12.
- **Ratchet (Workstream 4).** A new CI guard, `scripts/instruction-plane-size-guard.mjs`, mirroring the existing **Module Size Guard** shape. Because §1a establishes that the always-on cost is *whatever the pointer forces the agent to read* — not one hard-coded filename — the guard must measure the **whole pointer-forced set**, or it is trivially gamed (shrink `AGENTS.md`, then have the pointer also force `doctrine-extras.md`; the true cost is unchanged while the baseline ratchets down). Design:
  - A **machine-readable manifest**, `scripts/instruction-plane-manifest.json`, enumerates *every* file the `CLAUDE.md` pointer instructs the agent to always read. The guard (i) **sums chars across the whole manifest** against a **baseline file** (`scripts/instruction-plane-baseline.json`), and (ii) **asserts the `CLAUDE.md` pointer references only manifest files** — so a second always-read file cannot be introduced without appearing in the manifest and thus in the measured total.
  - **Chars only** are the hard-fail metric — deterministic across environments. An approximate token count is printed as *advisory* output, never a fail condition (token counts drift across tokenizer versions and would flake a blocking gate).
  - **Shrink-only:** a PR that grows the manifest total above baseline fails; a PR that shrinks it *rewrites the baseline down*. Growth requires an explicit baseline bump with a one-line justification in the PR body — the same friction that stops silent re-accretion.
  - **Rename-proof structural check:** instead of a header-string allow-list (defeated by renaming `## Branching, Commits & PRs` to `## Branch Hygiene` and re-inlining the content), the guard flags **any doctrine-plane section exceeding a per-section char budget** and **any single line exceeding a max length** — a content signal that survives renaming and catches a procedure block creeping back inline regardless of its header.

> The ratchet is deliberately dumb (char ceiling + manifest closure + per-section budget), not semantic. Per Problem 3, a smart-but-ignorable check is worse than a dumb blocking one — but it must be dumb about the *right* quantity (the manifest total), not a proxy.

---

## 5. Reconciling the prose-vs-code discriminator (hand-off to BI-C5A31A24)

This spec **defines the reconciled *direction*** (§5b) and the **measured rollout** to reach it safely (§5c); **BI-C5A31A24 owns the guard implementation and the base-rate experiment.** No guard code is written here.

### 5a. The conflict, precisely

`consult-scopes-before-asking` lives in five planes. The two that *execute* disagree:

- **Prose** (AGENTS.md §340; commandment "Consult the Governed Scopes Before Asking a Human"): keyed on **audience + decision-nature** — "before asking a **human** to choose on a **platform/build decision**, consult the kernel." Operator-owned (naming/branding/business strategy) is the carve-**out**.
- **Code** (`packages/dpf-skill-pack/hooks/decision-routing-guard.mjs` `decide()`): keyed on **shape + vocabulary** — `options.length < 2 → skip`, then block only if the text matches a **deny-list** of engineering/delivery/technical-artifact regexes. Engineering vocabulary is the carve-**in**.

The code approximates "is this a governed decision?" with a **vocabulary deny-list**. Vocabulary is a lossy proxy for decision-nature, so every governed decision phrased in not-yet-listed vocabulary **escapes** (false negative). This has recurred three times; each fix **added more vocabulary** (BI-0F0BE69A added `DELIVERY_LANGUAGE` + `TECHNICAL_ARTIFACT` after a roadmap-vocabulary question escaped). The shape of the discriminator *guarantees* a perpetual false-negative tail. **This is the whack-a-mole Problem 3 warns against — solving a compliance gap by adding more matching text.**

### 5b. The reconciled discriminator: shape-default-route, operator-owned is the marked exception

Note first that **audience is implied by the tool**: an `AskUserQuestion` *is* asking a human. So the prose's "before asking a **human**" is redundant with the tool. The real discriminator collapses to decision-nature + shape. Reconcile by making **both planes state the same single test**, and flip the default so the fail-safe direction is *closed*, not open:

> **A multi-option `AskUserQuestion` (≥2 options) is presumed a governed decision and must carry consultation evidence, UNLESS it is explicitly marked operator-owned.**
>
> The guard **allows** a ≥2-option question only when it (a) cites a kernel ledger (`principle_decide` / `composite` / `margin` — already implemented as `LEDGER_MARKERS`), or (b) carries an explicit `[operator-owned]` / `[direct-ask]` bypass (already implemented), or (c) matches a **small, high-precision operator-owned allow-list** (naming, branding, visual/brand choice, business strategy, pricing). Everything else with ≥2 options is **blocked** with the existing guidance.

This replaces the open-ended **deny-list of governed vocabulary** with a **closed allow-list of operator-owned exceptions** — a set that is small, stable, and genuinely enumerable (naming/branding/strategy don't multiply the way engineering phrasings do). Consequences:

- **Prose and code now state one discriminator.** The prose shrinks to describe the guard's actual test: *"A multi-option question defaults to kernel-routed. Mark a genuinely operator-owned choice with `[operator-owned]`."* — the BI's "one discriminator per rule, stated once, executed once."
- **Fail-safe flips to closed.** The recurring defect was *fail-open* (a governed decision slipped through). Under the flip, an unmarked question fails *toward* "route it through the kernel" — the safe direction. The cost moves from "a governed decision silently escapes" (the actual harm, 3×) to "the agent adds a one-word tag or a ledger" (cheap, self-correcting, and something the prose already required).
- **This is itself Single Source of Truth** — the principle that won the kernel scoring — applied to the discriminator: the guard becomes the *single* executable statement of the rule, and every prose plane points at it.

### 5c. The flip's real risk — and why it ships as a *measured experiment*, not a ratified contract

The flip trades a chronic false-negative tail for a false-positive risk, and that risk is **larger than "unmarked operator-owned questions."** The premise `P(governed | ≥2 options)` is high is **unproven and probably false for a general-purpose agent**: a large share of multi-option `AskUserQuestion`s are **preference / logistics / factual clarification** the kernel has no authority over —

- "Did you mean the staging or production DB?" (2-option factual clarification — the `options.length < 2` skip does **not** save it)
- "Proceed now, or wait until after your review?"
- "Email Alice or Bob about this?"

None match the operator-owned allow-list, so under a naive flip **all get blocked** and told to route through the kernel. Worse, running `principle_decide` on a non-governed preference returns `insufficientSignal: true` / `recommendation: null` — the agent is then stuck, or learns to reflexively tag everything `[operator-owned]`, which **structurally recreates the fail-open hole the flip set out to close.** The flip conflates operator-owned *decisions* (small, enumerable) with the far larger set of operator *preference/clarification* questions (not enumerable). Taken naively, this is plausibly a **worse** failure mode than the bounded false-negative tail it replaces.

Two consequences for how this lands:

1. **The flip is a distinct decision, not a derivation of Option B.** Option B ratified "reconcile *proven* discriminators." Flipping a shipped, thrice-iterated commandment guard from fail-open to fail-closed is a separate trade-off (it can regress). It must **not** be smuggled in as "contract of record." It ships as a **bounded, measured experiment**, and if the base-rate data says the FP cost is real, it is re-scored through the kernel before any hard block.

2. **The rollout must actually be measurable — the earlier "behind `DPF_ALLOW_DIRECT_ASK`" plan was incoherent.** `decide()` returns `{block:false}` globally when `DPF_ALLOW_DIRECT_ASK==="1"` (guard line 116): that flag turns the guard **off**, so you would measure nothing. Correct rollout, handed to **BI-C5A31A24**:
   - Add a **new observe-only mode** (e.g. `DPF_DECISION_GUARD_WARN=1`) that **logs would-block** on every unmarked ≥2-option question **without denying**.
   - Run one session wave in observe mode; measure the **actual base rate** of governed vs preference/clarification multi-option asks, and the would-be FP rate against the operator-owned allow-list.
   - Only if the measured governed-share is high does the hard flip proceed — otherwise adopt a **narrower reconciliation**: keep shape-default routing but *broaden the allowed-exception set* to include a "factual/preference clarification" signal (e.g. no governance-relevant nouns AND no ledger-worthy stakes), so clarifications pass without a tag.
   - Keep the operator-owned allow-list **in the guard, not in prose**, so the rule has a single executable home; seed it from BI-ACC7A2B5's section audit.

The reconciled *direction* (one discriminator, prose describes the guard's test, fail-safe closed) is the contract this spec commits to. The *hard flip* is the experiment C5A31A24 runs to get there safely.

---

## 6. The wiki-graph reuse question, answered honestly (Workstream 6 — mostly deferred)

The BI's instinct — *reuse the graph DPF already owns rather than adopt Obsidian/Graphify* — is correct doctrine (`ground-new-work-in-existing-platform`, which scored for B). But §1b shows the reuse is **already banked for the kernel**: principles are WikiPages, linked, and PPR-traversable today. So the honest scope of Workstream 6 is narrow, and the kernel scored the graph-native *option* (C) **below** B precisely because its headline reuse is done and its remaining move is risky.

**What stays out (correctness, precisely stated):** **unguarded** load-bearing doctrine cannot be lazy-retrieved — an unenforced rule must be present *before* the agent acts, and PPR-at-need cannot guarantee presence-before-action, so it stays always-on prose (small, per §4). Note the sharper point, which *strengthens* the split: for a rule that has an enforced guard, the guarantee comes from the **PreToolUse hook firing at action time, not from preload** — exactly the mechanism Problem 3 relied on when preloaded prose (§340) was read and still missed. So guarded rules need not be preloaded for enforcement at all; the preload of a guarded rule is a courtesy, not the guarantee. This is the deeper reason the split is safe: the doctrine that *must* stay always-on is only the **unguarded** load-bearing set, and §5's "guardify twice-failed rules" keeps shrinking even that.

**What is a *sound* graph reuse, deferred to a follow-on:** dual-home the *procedure and history* tiers — the skill index and the moved-out sections — as WikiPages with `[[wikilinks]]`, so that `wiki_query` PPR retrieval (already built) can surface the right procedure/history node when a task selects it, for **every** connected agent, not just Claude Code's file reads. This is additive, reuses `ppr.ts` and `wiki-pack.ts` with **no new retrieval engine**, and is only worth doing *after* the split creates clean, node-sized procedure/history units. **Recommendation: carry it as a Phase 4 stretch in this BI's plan, or split it to a follow-on once Phases 1–3 land — do not block the split on it.**

---

## 7. The MCP tool plane (Problem 4) — decision: **linked sibling BI, scoped here**

The goal delegates this call. **Decision: file a linked sibling BI; do not fold it into this spec.** Rationale (itself Single-Source-of-Truth / one-concern):

- **Different substrate and mechanism.** Problem 4 is a *protocol* change to `apps/web/app/api/mcp/v1/route.ts` (`listChanged`, cursor pagination, server-side tool-search/programmatic-disclosure) and `apps/web/lib/mcp-tools.ts` — not an instruction-prose refactor. Its risk profile is *client-compatibility across Codex / Grok / in-portal coworkers*, orthogonal to doctrine.
- **Different acceptance test.** The instruction-plane ratchet measures a doc; the tool-plane fix measures a `tools/list` response and cross-client token cost.
- Mixing a protocol change into a doc-refactor spec violates the same one-concern discipline this spec preaches.

**Scoped hand-off (attach to the sibling BI):** live-confirmed 223 tools returned in a single un-paginated `tools/list`; ~26.3k tokens; `tools: { listChanged: false }` at `route.ts:333`; per-tool weight ~420 tokens (schemas are *lean*, not the defect — the defect is the absence of server-side disclosure). The sibling should evaluate the 2026-GA progressive-disclosure pattern (Tool Search + Programmatic Tool Calling) against DPF's surface-agnostic doctrine (§17), so non-Claude-Code clients stop paying the full catalog. **Suggested title:** "Server-side progressive tool disclosure on the DPF MCP surface (Problem 4 of BI-0020D511)."

---

## 8. Coordination (do not collide)

An undecided sequence *is* a collision. This spec therefore **commits to an order** rather than listing options:

- **BI-ACC7A2B5 (open) — unmarked runtime-assumption audit, same files — lands FIRST.** ACC7A2B5 marks assumptions in the very sections this BI relocates (§2, §4, §6, §8, §16). If the split lands first, ACC7A2B5 then marks assumptions in sections that no longer exist inline (marks lost, or landed in the wrong plane); if they land concurrently, they merge-conflict on a heavily-restructured file. **Committed dependency: ACC7A2B5's assumption-marking merges before Phase 1 begins, on the pre-split file, so the split relocates already-marked content.** The stale "current as of 2026-04-27" marker in §2 is a shared find handed to ACC7A2B5. **SATISFIED 2026-07-31** — 10 `⟦runtime:⟧` markers applied to the pre-split `AGENTS.md`; see the *Application status* section of [the audit](../audits/2026-07-24-agents-md-runtime-assumption-audit.md). Phase 1 is unblocked on this dependency. Two carry-overs travel with the content when it relocates: the `seed-worktree-mcp` shim's unanchored "one release cycle" expiry (owner call, still open) and the skill-frontmatter sweep, which the audit defers into Phase 1 by design.
- **BI-C5A31A24 (open) — decision-routing enforcement.** Owns the guard code. This spec hands it the reconciled *direction* (§5), **not** a ratified hard flip: per §5c, C5A31A24 ships the flip in observe-only mode, measures the base rate, and only then decides between the hard flip and the narrower reconciliation. C5A31A24 is not bound to ship a fail-closed block before the FP data exists.
- **BI-5FE47130 (in-progress) — specialist-doctrine migration out of the kernel (corpus tier).** Complementary on the token-budget framing (it shrinks the *retrieved* corpus; this shrinks the *preloaded* plane; no shared file). **One real coupling:** Phase 3 dedupes the 91 `feedback_*` files against "the 101 kernel principles," but 5FE47130 is concurrently *changing which principles are in the kernel* — so Phase 3 measures a moving target. **Committed: Phase 3 runs after 5FE47130 settles, or against a snapshotted principle set recorded in the Phase 3 report.**

---

## 9. Phased plan

Ordering is by dependency and blast radius; each phase is independently shippable and independently valuable. **Prerequisite (§8): BI-ACC7A2B5's assumption-marking on `AGENTS.md` merges before Phase 1 — SATISFIED 2026-07-31.**

**Phase 0 — Baseline & guard scaffold (no doctrine moves yet).**
- Add `scripts/instruction-plane-size-guard.mjs`, `scripts/instruction-plane-manifest.json` (initially: the current pointer-forced set), and `scripts/instruction-plane-baseline.json`, baselined at the *current* manifest total (~112,507 chars, so it is a no-op ratchet until Phase 1 shrinks it). Wire it into CI advisory-first.
- Acceptance: guard runs green at current total; a synthetic +1-char edit to any manifest file fails it; adding an always-read file to the `CLAUDE.md` pointer *without* listing it in the manifest fails the closure check.

**Phase 1 — The split (the token win).**
- Move the §16 skill-catalog *table* (keeping §16's skill-precedence/disambiguation **doctrine sub-rules** always-on, per §4b), §4, §6, §8, and the procedural halves of §5/§11/§12 to their existing skills / new reference docs; keep the *rule* lines in doctrine. Rewrite §2 to a one-paragraph orientation + link to a living arch doc. Update the `CLAUDE.md` pointer + the manifest to name the doctrine file always-on and the procedure/history files as on-demand reads.
- Re-run the ratchet; **rewrite the baseline down** to the measured post-split total. Target ≤ 45,000 chars.
- Acceptance: manifest total ≤ 45k chars; every moved section reachable via a named skill or a linked doc; **non-Claude-Code surfaces (Codex, Grok, in-portal coworker) still surface skill triggers without §16's catalog in always-on prose** — verified, or a minimal trigger index kept always-on / dual-homed (§6); `apps/web/lib/docs/doc-index.generated.json` regenerated; no rule *statement* lost (diff-reviewed against the commandment set).

**Seed-fit applicability decision (Phase 1): `global-default`.** Phase 1 tightens the `description` frontmatter of six DPF platform skills, which is canonical seeded content. The descriptions state *when* a platform skill applies; that semantics is not tied to one operator, geography, archetype or market, so the change belongs in canonical seed for every install rather than as scoped or install-local content. No skill body, assignment or capability changed. (Recorded here durably in addition to the `Seed-Fit-Decision:` PR trailer the CI gate reads.)

**Phase 2 — Discriminator direction (this spec) → hand to BI-C5A31A24 as a measured experiment.**
- Land §5's *direction* (one discriminator; prose describes the guard's test; fail-safe closed). BI-C5A31A24 adds an **observe-only mode** (`DPF_DECISION_GUARD_WARN=1`) that logs would-block without denying, runs one session wave, and **measures the governed-vs-preference base rate** before any hard flip (§5c). The hard flip proceeds only if the data supports it; otherwise the narrower reconciliation (shape-default + a clarification-exception signal) ships instead.
- Acceptance: observe-mode data recorded; whichever variant ships, prose and guard state one discriminator, and the guard's test file covers a governed question phrased in *novel* vocabulary (the class that escaped 3×) **and** a preference/factual clarification (which must NOT be blocked).

**Phase 3 — feedback-memory vs kernel-principle dedupe (Workstream 3). Runs after BI-5FE47130 settles (§8), or against a snapshotted principle set.**
- Quantify the real overlap between the 91 `feedback_*` client-memory files and the (snapshotted) kernel principles (semantic, not filename). Route durable items to the commons via the existing `dpf-route-learning-to-commons` pipeline; delete the rest. This directly serves AGENTS.md's own "local-only knowledge is a defect" rule.
- Acceptance: a report of overlap % (against a recorded principle-set snapshot), a commons-contribution list, and a shrunk client index.

**Phase 4 (stretch, or split to a follow-on) — dual-home procedure/history in the wiki graph (§6).**
- Ingest the moved-out procedure/history units as WikiPages with `[[wikilinks]]`; verify `wiki_query` PPR surfaces them. Reuses `ingest.ts` + `ppr.ts` + `wiki-pack.ts`; no new engine.
- Acceptance: a non-Claude-Code client can retrieve a moved procedure node via `wiki_query retrievalMode:"ppr"`.

**Parallel, not a phase — file the Problem 4 sibling BI (§7)** with the scoped hand-off attached.

---

## 10. Design research

- **Kernel decision** — `principle_decide` interaction `DI-F844365B0DCC` (§3): live scoring against 36 in-scope principles, structured coverage strong, no commandment conflict. Recommendation Option B, high confidence.
- **Convergent 2026 patterns the BI cites, corroborated across independent sources** (directional, single-source *magnitudes* excepted): progressive tool disclosure as the default production MCP pattern; three-tier agent memory (episodic/semantic/procedural) — DPF already implements all three; hybrid graph+vector retrieval — DPF already implements it (`ppr.ts`, `wiki_query`). "Lost in the middle" (most-important instructions belong at the top/end, never the center) is the empirical basis for §4's doctrine-only always-on plane and Problem 3.
- **Substrate verification** (`dpf-verify-substrate-first`): the graph, the ratchet pattern (Module Size Guard), the discriminator guard, and the skill catalog **all already exist**; this spec reuses each rather than proposing new substrate — the reason B out-scored C.
- **Existing DPF specs consulted:** `docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md` (the guard's origin), `docs/superpowers/specs/2026-07-22-wwmd-design-quality-kernel-gap-design.md` (dimension-catalog discipline), `docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md` (spine reduction, adjacent to BI-5FE47130).

---

## 11. Open questions for review

*(An independent adversarial architecture-review pass has been folded in: it hardened §5c from an incoherent kill-switch rollout to a measured observe-only experiment, replaced the ratchet's gameable filename proxy with a manifest-closure design (§4c), split §16's doctrine sub-rules from its catalog (§4b), reconciled the 101/121/170 page counts (§1b), narrowed the §6 correctness claim to *unguarded* doctrine, and committed §8 to an ACC7A2B5-first sequence. The residual calls below are genuinely for the human/founder.)*

1. **Doctrine target.** Is ≤ 45,000 chars (~11.3k tokens) the right ceiling, or should we commit to the ~35k stretch as the baseline?
2. **§17 split line.** How much of Delivery Surfaces is doctrine vs runbook is the least mechanical call in §4b — worth a second reviewer's eyes.
3. **Phase 4.** Carry graph dual-homing in this BI, or split it to a follow-on the moment Phases 1–3 land?
4. **The §5 hard flip.** If the Phase-2 observe-mode data shows the governed-share is *not* dominant, is the narrower reconciliation (shape-default + clarification-exception) acceptable, or does the founder want a different escape from the vocabulary-deny-list whack-a-mole?

---

## 12. Addendum (2026-07-30) — Anthropic's "context engineering for Claude 5" guidance, evaluated against this design

**Why this section exists.** Anthropic published prompting/context-engineering guidance for the Claude 5 generation, reporting that **>80% of Claude Code's own system prompt was removed with no measurable loss** on their coding evals, and recommending five shifts: *rules → judgement*, *examples → interface design*, *upfront → progressive disclosure*, *repetition → simple tool descriptions*, *simple specs → rich references*. The founder asked whether these apply to DPF, whether they hold on **non-Claude surfaces**, and what else we should be doing. This addendum answers those three questions against measured substrate. It does not reopen the §3 kernel decision — it **ratifies Option B** and adds four gaps that Option B, as written, does not close.

### 12a. Re-measurement at this branch

| Plane | §1 (2026-07-24) | Now (2026-07-30) | Note |
|---|---|---|---|
| `AGENTS.md` | 112,507 bytes | **90,298 bytes** | −20% already banked between the spec and now |
| `CLAUDE.md` + `CONVENTIONS.md` | 438 | **438** | exact |
| **Pointer-forced subtotal** (what the ratchet measured) | — | **90,736** | the whole of `manifest.alwaysOn` |
| **Harness-injected skill frontmatter** (31 × `name`+`description`) | *not measured* | **16,195** | **invisible to the Phase 0 ratchet** |
| **True always-on total** | — | **106,931 bytes / ~26.7k tokens** | |

**The Phase 0 ratchet under-measured the always-on plane by 17.7%.** The gap is not an accounting nicety — it is a live evasion path for Phase 1, and §12c fixes it.

### 12b. What the guidance ratifies (no design change needed)

- **Progressive disclosure over front-loading** is the article's central move and is exactly §4's doctrine/procedure/history split. Independent convergence on the design already chosen.
- **"Lost in the middle"** — the article's observation that over-constraining forces the model to *reconcile conflicting instructions before acting* is the same failure this spec's Problem 3 recorded empirically (§340 was in context and was still missed).
- **Rich references over simple specs.** DPF is ahead here: `principle_decide` rubrics, committed `docs/ux-fit/*.ux-fit.json` evidence, the HTML-artifact spec format (§16 of `AGENTS.md`), and executable specs-as-tests are all instances of the pattern the article recommends adopting.
- **Deterministic enforcement.** The article's "delete the rule" advice presumes nothing else holds the line. DPF's hooks + CI gates already do, which is what makes deletion *safer here than at most shops* — see the criterion in §12d.

### 12c. Gap 1 — the harness-injected plane (CLOSED on this branch)

`manifest.alwaysOn` measures whole files that the **pointer** forces. It cannot see what the **harness** injects: Claude Code and Codex load every installed skill's frontmatter `name` + `description` into the system prompt of *every* session, while the skill *body* stays progressive-disclosure.

This is the same evasion manifest-closure blocks one layer up, and Phase 1 walks straight into it: Phase 1's plan is to **move procedure out of `AGENTS.md` and into skills**. Every such move creates pressure to make the destination skill's *description* more discriminating — so the ratchet would report a 60% reduction while the true always-on cost barely moved. A ratchet that can be satisfied by relocation is not a ratchet.

**Landed:** a second manifest tier, `alwaysOnExtracted`, measuring an *extracted portion* of a file glob rather than whole files (`scripts/check-instruction-plane-size.mjs`, `frontmatterFields` / `extractGroup`). It ratchets identically (shrink-only, baselined) and adds a per-item advisory (`maxExtractedItemChars`, 700) flagging descriptions that have grown into how-to prose. Six skills exceed it today, the worst at 1,054 bytes. Tests cover the relocation case specifically: growing an extracted group while the files shrink **fails**.

> **Phase 1 acceptance is amended:** the target is measured against the manifest total **including `alwaysOnExtracted`**, not the pointer-forced subtotal. Against the true 106,931-byte baseline, the ≤45,000 target is a 58% cut, not the 50% it would appear to be from `AGENTS.md` alone.

### 12d. Gap 2 — "let the model use judgement" is surface-asymmetric; the deletion criterion is enforcement, not model capability

**This is the founder's central question, and the article does not answer it — it is written by and for a single-surface product (Claude Code on Opus 5 / Fable 5).** DPF is explicitly four peer surfaces (`AGENTS.md` §17) plus in-portal coworkers, and the guidance's premise does not distribute evenly across them:

| Surface | Reads `AGENTS.md`? | Judgement premise holds? |
|---|---|---|
| Claude Code (Opus 5 / Fable 5) | yes, via pointer | **yes** — the population the article was evaluated on |
| Codex CLI | yes, via `AGENTS.md` natively | **unverified** — no DPF eval exists |
| Grok CLI | yes, via pointer | **unverified** |
| Build Studio / in-portal coworkers | no — prompts + seeded skills | **no** — the binding window is the ~24,576-token *local* served window and the ~15-tool selection cliff (`docs/architecture/context-engineering-standards.md`) |

Deleting a rule because "the model can now judge it" is therefore a bet placed on the **strongest** surface and paid for by the **weakest**. Since `AGENTS.md` is one shared file, a deletion that Opus 5 absorbs silently degrades the local-model path where DPF's founder strategy actually lives.

**The safe criterion is not model capability — it is enforcement.** DPF already has the discriminator the article lacks, and it is DPF's own §17 keystone (*governance approves evidence, not provenance*):

> **A rule may be shortened to a one-line statement + pointer when a hook, CI gate, or tool schema enforces it deterministically.** The enforcement is surface-agnostic by construction, so the shortening is safe on all four surfaces. A rule that is *not* mechanically enforced must keep enough prose for the **weakest** surface to comply, or be promoted to enforcement first (this spec's §5 guardify-twice-failed sub-rule).

This criterion is *more* aggressive than the article for DPF's enforced rules — `AGENTS.md` says "Enforced in CI" 16 times, and each such paragraph currently restates the rule, its rationale, its failure anecdote, and its BI number in always-on prose when the gate already blocks the PR. It is *less* aggressive than the article for unenforced judgement calls. Phase 1 should tier each section by this criterion rather than by prose length alone.

### 12e. Gap 3 — moving procedure into skills does not help unless the skills themselves are progressively disclosed

All **31** DPF skills are single-file monoliths: `packages/dpf-skill-pack/skills/*/` contains **exactly one file each**, 250,245 bytes total, largest 210 lines. There is no `reference/`, no sub-file, no `@`-mention tree — the article's specific recommendation for long skills ("divide it into many files and split them out").

Phase 1 moves `AGENTS.md` §4/§6/§8/§16 procedure *into* these files. Loading a 210-line skill to answer a two-line question is a smaller version of the problem this spec exists to fix. **Phase 1 should split any destination skill past ~150 lines into `SKILL.md` (trigger + decision spine) + `reference/*.md` (the steps)**, so the second disclosure level exists before procedure lands on it.

### 12f. Gap 4 — the ratchet is a byte gate with no behavioural counterpart

§4c is explicit that the ratchet is "deliberately dumb," and that is correct for what it does. But byte reduction and doctrine *compliance* are different quantities, and Phase 1 currently has no way to detect that it cut 58% and broke a rule. The article's own claim is framed as *"no measurable loss on our coding evaluations"* — the eval is what licenses the deletion. DPF has the substrate for the equivalent (`apps/web/lib/tak/context-economy-metrics.ts`, the golden-journey certification sweep) but points none of it at contributor sessions.

**Recommended Phase 1 acceptance addition:** a small compliance set — one task per commandment-tier rule (DCO sign-off, branch guard, no-hardcoded-colors, worktree-not-runtime, consult-scopes-before-asking) run against pre- and post-split doctrine on at least Claude Code **and** one non-Claude surface. Without it the 58% cut is unfalsifiable, and per §12d it is exactly the non-Claude surfaces that would absorb the regression.

#### 12f-i. Status (2026-07-31) — the gap splits in two; the deterministic half is BUILT

Framing this as one gap conflated two separable questions:

- **(a) Preservation — did the cut *drop* a rule?** Deterministic, and now gated. `scripts/check-instruction-plane-rule-coverage.mjs` (guard `instruction-plane-rule-coverage`) keys each load-bearing rule on its **kernel-principle anchor** — the `→ [kernel principle](docs/.../x.md)` target — rather than on prose, because Phase 1 is *supposed* to reword and relocate the prose. **46 anchors are baselined from the pre-split plane** (35 kernel + 11 flat profession-wiki). The invariant: every baselined anchor must remain referenced from an always-on file *or* from a registered `manifest.ruleDestinations` target. Relocation passes; deletion fails. This makes Phase 1's *"no rule statement lost (diff-reviewed against the commandment set)"* machine-checked instead of a hand diff-review across a 58% rewrite of a 90kB file — the review step most likely to decay into a rubber stamp precisely when it matters most.

  **Timing was the binding constraint:** the baseline is only trustworthy while the pre-cut plane still exists to be measured. Captured now, before Phase 1 moves anything.

  Two by-products worth carrying into Phase 1: the guard reports **7 duplicated anchors** in today's always-on prose (`worktree-is-source-control-not-runtime` is linked **3×**; `single-source-of-truth`, `all-changes-land-via-pr`, `mcp-is-the-coordination-plane`, `one-common-process-three-surfaces`, `organization-canonical-identity`, `schema-audit-before-features` twice each) — the same SSOT drift shape as Problem 2, advisory for now because fixing them is Phase 1's job. And the anchor pattern must admit *both* wiki shapes; an earlier draft required a directory under `wiki/` and silently dropped all 11 profession anchors — a false-green the guard's own test now pins.

- **(a-ii) Durability — does a rule stay correct across model releases?** Partly gated (2026-07-31). Anthropic's per-model prompting guidance shows the correct instruction *inverting* between adjacent releases: Opus 4.8 needed prompting to delegate to subagents, Opus 5 needs a cap; Opus 4.8 wanted verification instructions, Opus 5 documents that they cause over-verification and should be deleted — inverting the usual "ask the model to self-check" best practice. A `⟦model:⟧` marker convention (sibling to BI-ACC7A2B5's `⟦runtime:⟧`) now labels the two sites in `AGENTS.md` that are genuine model-behaviour compensation, and the guard hard-fails a malformed marker so `grep "⟦model:"` stays a complete index. **Only two sites qualified, and that is the finding**: `AGENTS.md`'s bulk is enforced procedure, not model-tuned prose — so §12d's enforcement criterion, not model-behaviour deletion, is the lever that shrinks this plane. What is *not* gated is noticing when a marked assumption has gone stale; that still needs the behavioural probes in (b).

- **(b) Efficacy — does a *shortened* rule still steer the agent?** **Still open, and not addressable deterministically.** This is the compliance set described above and it needs real model runs across surfaces. Nothing in (a) speaks to it: a rule can be perfectly reachable and still stop working once its rationale and worked example are gone, which is exactly what §12d predicts for the weaker surfaces. **A green rule-coverage run must not be read as "the cut was safe" — only as "the cut lost nothing outright."**

### 12g. Other optimizations worth considering (beyond the article)

1. **Directory-scoped `AGENTS.md`.** §3 of the root file notes subdirectory files "MAY extend this… none exist today." Both Claude Code and Codex load nested `AGENTS.md` by path proximity — a genuine, zero-cost progressive-disclosure channel that Phase 1 should use as a *destination tier* alongside skills: `apps/web/AGENTS.md` (§12 UI styling), `packages/db/AGENTS.md` (§3 enums, §11 stewardship, migration safety), `scripts/AGENTS.md`. Rules land closer to the code they govern and cost nothing to sessions working elsewhere.
2. **Residual restatement inside the doctrine plane.** "Worktree is source-control, not runtime" is stated in §4, §5, §6 and §14; the canonical worktree location in §4 (twice) and §17. The §8/§8a *advise-safe* duplicate is removed on this branch. The spec's Problem 1 concluded duplication was low — that holds for *principle links*, but not for these load-bearing operational rules, which are restated in different words each time (the §2 drift failure mode).
3. **Apply DPF's own `?tier=core` idea to prose.** The MCP surface already ships a curated core tier. The same shape fits doctrine: a core `AGENTS.md` plus named on-demand tiers, which is what Phase 1 builds — worth stating explicitly so the two surfaces stay conceptually aligned.
4. **`triggerPattern` regexes are the article's "examples" anti-pattern.** Every skill carries both a natural-language `description` (Surface A) and a hand-maintained `triggerPattern` regex (Surface B) — two encodings of the same routing intent, which can and do drift. The article's *design interfaces, don't give examples* argues for letting the description do the work on both surfaces. Worth a scoped follow-on, not Phase 1.
5. **Dual frontmatter (`allowed-tools` / `allowedTools`) is duplicated per skill.** Same SSOT hazard, and both are billed to the always-on plane now that §12c measures it.
6. **`SessionStart` hook output is always-on context too.** The janitor, freshness, governance-freshness and process-spine banners print into every session and are outside the manifest. Not urgent at current size, but it is the next unmeasured tier once §12c closes this one.

### 12h. Net assessment

The article does not change this spec's decision; it **independently converges on Option B** and supplies the outside-view argument for a target the founder was still weighing in §11 Q1 (the ~35k stretch now looks defensible, not aggressive). Its transferable core — *progressive disclosure, single statement per rule, design the interface instead of demonstrating it* — is structural and holds on every surface. Its headline move — *delete constraints and trust model judgement* — is **not** portable as stated, and adopting it verbatim would be a bet on Opus 5 charged to the local-model path. §12d's enforcement criterion is the portable form, and it is one DPF is unusually well-placed to apply because the enforcement already exists.

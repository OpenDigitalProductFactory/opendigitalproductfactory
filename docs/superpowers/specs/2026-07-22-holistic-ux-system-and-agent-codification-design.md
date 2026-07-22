# Holistic UX System — design system, agent codification, and enforced UX quality across all development surfaces

- **Status:** draft (research-backed; implementation phased via epic)
- **Date:** 2026-07-22
- **Epic:** EP-UX-SYSTEM (created with this spec) · tactical sibling: EP-UX-COGLOAD
- **Capsule:** WC-B895C366 · Epic-shape decision: `principle_decide` DI-14897C4D0792 (new-epic-two-track, high confidence, margin 2.59)
- **Related:** [`2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md`](2026-07-12-dpf-development-model-and-frontier-harness-positioning-design.md) §8/R8 · [`2026-07-12-ux-design-capability-stage-design.md`](2026-07-12-ux-design-capability-stage-design.md) · [`2026-05-16-ux-auditor-coworker-design.md`](2026-05-16-ux-auditor-coworker-design.md) (unbuilt) · [`2026-03-20-ux-usability-standards-design.md`](2026-03-20-ux-usability-standards-design.md) · `docs/platform-usability-standards.md`

## 1. Problem

Every iteration on the platform tends to add **more wall-of-text**, not a better human experience. The recent EP-UX-COGLOAD sweep fixed usability at the *functional* level (40 tactical per-surface items), but nothing prevents the next 40: UX design, consistency, and elegance have no holistic, systematic owner. The founder's framing, which this spec adopts as the acceptance bar:

> AI agents are notoriously not great at human interface design. We need a systematic approach so that this concern is effectively met by **any development surface**, and **tested in the system** once we have a target.

This is not a prompt problem to be patched with more prose. It is a missing **system**: the platform lacks (a) a design system that can express density/hierarchy/disclosure at all, (b) a codified, machine-readable definition of "good" that generation can be constrained by, and (c) evaluation that actually runs and actually blocks.

## 2. Live-state evidence (verified 2026-07-22 on the canonical install)

Three independent mechanisms in the existing UX-quality chain are **dark or toothless in production, silently**:

1. **The design brain is dark.** `search_design_intelligence` / `generate_design_system` return empty for *every* query (verified live: "dashboard" over the 99-row ux-guidelines domain → no results). Root cause: `apps/web/lib/design-intelligence.ts` reads CSVs from `join(process.cwd(), "apps/web/data/design-intelligence")`; the production image copies only the Next standalone output (no `outputFileTracingIncludes`, no Dockerfile COPY of `apps/web/data/`), and `loadDomain()` swallows the read failure with `catch { return [] }`. Build Studio's FRONTEND_ENGINEER prompt makes calling these tools **mandatory STEP 0 before writing any UI** — that step has been a silent no-op for every production build. Filed: **BI-018AE129**.
2. **Runtime UX evaluation is dark.** `evaluate_page` against the live login page returned `{findings: [], screenshot: null, visualCognitiveLoad: null}` with no error, while the healthy-looking `dpf-browser-use-1` sidecar logged its agent aborting (`BrowserStateRequestEvent` → None 6/6, "Stopping due to 5 consecutive failures") and **still returned 200 OK**. The screenshot LLM-judge (`visual-cognitive-load.ts`) and axe categorizer (`page-evaluator.ts`) exist in code but can never fire. The ship-gating `run_ux_test` rides the same sidecar. Filed: **BI-1BAA177C**.
3. **The named "UX" gates verify prose, not properties.** `check-ux-fit-decision.mjs` and `check-design-grounding-decision.mjs` pass on the *presence of a trailer/grounding text* (the UX-Fit script's own header calls it a "conscious-attestation MVP"). The Build Studio static UI scan (`runUiQualityGate` → `scanUiSource`) is real but **warn-never-block**, covers color/a11y smells only, and runs on the embedded surface only — external Claude/Codex/Grok builds never execute it.

The systemic pattern across all three: **UX quality signals degrade to "no findings" instead of failing loud.** The platform currently cannot distinguish "the UX is fine" from "UX checking is off." (`structural-verification-is-not-functional` applies to the checkers themselves.)

## 3. Current substrate — what exists, honestly classified

Enforcement legend: **prose** · **attestation** (trailer exists) · **static** (regex/diff scan) · **runtime** (executes against a rendered page).

| Layer | What exists | Level | Reality check |
|---|---|---|---|
| Color tokens | `--dpf-*` roles in `globals.css` (~174 lines: color, font-family, tap-target, loading keyframes) | static (ratchet guards) | Solid — but it is a **color system, not a design system**: no spacing scale, no type scale, no density tokens, no layout/grid primitives, no elevation |
| Status semantics | `statusColors.ts` intent registry (~60 domains → 6 intents) | static (`check-no-local-status-color`) | Genuinely centralized and enforced |
| Components | `report-kit/` (badges, KPI/stat cards, tables, filters, charts, empty states), `ui/form/` (a11y submit contract), `Dialog` | static-adjacent (guards ban the alternatives) | Real primitives, all tested; coverage stops at reporting/forms/dialogs |
| Hygiene guards | hex/status-map/hand-rolled-loading/native-dialog/dialog-in-transition ratchets via `check-guards.mjs` | static, blocking | Narrow, code-shaped invariants; nothing measures density/hierarchy/text mass |
| Standards | `platform-usability-standards.md` (contrast, forms, loading, disclosure constructs, readability tiers w/ Flesch-Kincaid policy, shell action-result contract) | prose | Comprehensive and current — and a document |
| Wall-of-text metric | `owner-first/ux-audit.ts`: `countWords/countControls/countSmallControls/countGenericDecisionLabels/hasOwnerFirstNextAction` + `OWNER_FIRST_SUMMARY_THRESHOLDS` (≤160 words, ≤12 controls, 0 tiny text, 0 generic labels, next-action required) | exercised by **2 unit tests** | **Exactly the metric the founder wants — orphaned.** Measures one summary band; no route sweep, no gate |
| Screenshot judge | `visual-cognitive-load.ts` (vision-LLM, 0–1 cognitiveLoad/visualDensity/controlCount; spike-verified 0.10 clean vs 0.75 dense) | runtime, best-effort | Gates nothing; currently can't run at all (BI-1BAA177C) |
| Design knowledge | design-intelligence CSVs (67 styles, 99 UX guidelines, 161 reasoning rules) + `ui-ux-pro-max` skill | prose/advisory | Dark in production (BI-018AE129); guidance partly **contradicts** the enforced guards (teaches `animate-pulse`, `bg-primary`, undefined `shadow-dpf-*` tokens) |
| UX auditor coworker | AGT-906 `ux-design-critic` + AGT-907 `ux-test-automator` spec (Hick/Fitts/Miller/Doherty + density lenses, deliberation pair, weekly shell audit) | prose | **Designed 2026-05-16, zero implementation**; AGT-903's specialist prompt was removed 2026-04-20 |
| Pipeline stage | `ui-quality-checks.ts` + `design-directions.ts` (propose-N) per the 2026-07-12 capability-stage spec | static, advisory | Warn-never-block; directions primitive unwired to ideate; **its epic/BI (EP-F7E35344/BI-66656F61) were never created in the live backlog — the R8 thread is orphaned** |
| Gating UX check | `run_ux_test` (browser-use, screenshots, blocks ship) | runtime, blocking | Verifies **acceptance criteria**, not design quality; rides the broken sidecar |
| Visual regression / axe in CI | — | — | **None** (explicit non-goal of the 2026-03-20 spec; never revisited) |

**Summary:** mature bottom layer (color/status/form/dialog hygiene, mechanically enforced), empty top layer (no codified, testable definition of good UX), and a middle layer that is either advisory, attestation-only, orphaned, or dark.

## 4. Root causes — why iterations add wall-of-text

- **RC1 — Nothing penalizes text mass.** Generation optimizes for completeness; no budget (words, choices, sections, actions) exists per screen, so prose accretes monotonically. The one threshold set that exists (`OWNER_FIRST_SUMMARY_THRESHOLDS`) is wired to two unit tests.
- **RC2 — The design system cannot express the problem.** Density, hierarchy, spacing, type scale, and disclosure have no tokens or primitives; "wall of text" is literally inexpressible in the enforced vocabulary, so no ratchet can catch it.
- **RC3 — Gates read attestations, not artifacts.** A PR carries a `UX-Fit-Decision:` trailer regardless of what the UI looks like; the only real scan is advisory and single-surface.
- **RC4 — No one looks at the screen before merge.** Review is code-diff-shaped; screenshots, visual regression, and the LLM judge are absent from the PR plane.
- **RC5 — The knowledge substrate is dark and self-contradictory.** The mandatory design-guidance call returns empty in production; where prose guidance exists it partly conflicts with the enforced guards (prompt-vs-reality drift).
- **RC6 — Fixes stay bespoke.** The owner-first/progressive-disclosure wave produced per-surface modules, not platform primitives with defaults, so every net-new surface regresses to the model's house style by default.
- **RC7 — Improvement threads lose their owner.** The R8 capability stage and the AGT-906 auditor were both designed and then orphaned (no live epic/BI, no implementation) — process evidence that UX quality work needs a durable epic home, not one-off specs.

## 5. Research & Benchmarking

Findings from an adversarially-verified deep-research pass (5 search angles, 23 sources, 111 extracted claims, 25 verified 3-vote — 25 confirmed / 0 refuted). Organized by the four-layer strategy the evidence supports.

### 5.1 Codify — what is genuinely machine-readable (high confidence)

- **Design tokens are now a standardized machine-readable artifact.** The W3C-community DTCG Design Tokens Format Module reached its first stable release (2025.10; 20+ editor orgs incl. Adobe, Google, Microsoft, Figma, Salesforce, Shopify): a JSON format for typed tokens with aliasing and composite types, explicitly built for tool interoperability. Material 3 operationalizes tokens in three tiers (reference → system → component) used identically in design tools and code. [designtokens.org/tr/2025.10, m3.material.io/foundations/design-tokens]
- **Token adherence is fully CI-enforceable today.** M3 prescribes the lintable rule ("component tokens should point to a system or reference token, and not contain hardcoded values"); IBM Carbon ships an official stylelint plugin enforcing token usage (color/theme, layers, spacing/layout, typography, motion ×2) with autofix and a CI workflow. DPF's existing color-only ratchets extend naturally to the full token surface. [github.com/carbon-design-system/stylelint-plugin-carbon-tokens]
- **The enforceable surface is narrow and well-demarcated.** DTCG covers property-value tokens only; Carbon's linter checks exactly six property-value rule areas; Material concedes "not every stylistic choice of a component will be able to be expressed as a token." **Layout composition, visual hierarchy, content density, and cognitive load sit outside the token-lintable surface** — they need the other three layers.

### 5.2 Why AI agents fail at interfaces — the evidence behind the premise (high confidence)

- **Layout and hierarchy, not syntax, is the dominant weakness.** Design2Code (NAACL 2025; 484 real webpages): frontier multimodal models "mostly lag in recalling visual elements … and generating correct layout designs" — text/color fidelity is comparatively strong. Apple's CHI 2026 study (1,500 designer annotations) independently concludes LLMs "are unable to reliably generate well-designed UIs": misaligned fields, overlapping text, poor information hierarchy. [arxiv.org/abs/2403.03163, arxiv.org/html/2509.16779]
- **Context adaptation is weak; a human-judgment residue is documented.** Expert evaluation of LLM-designed GUIs found models "could partially tailor interfaces … but lacked deeper contextual understanding," concluding they suit early-stage prototyping with human intervention remaining critical (single-preprint caveat, Jan-2025 models). [arxiv.org/abs/2601.22759]
- These are documented failure modes of tested model generations, improving over time — the framing is "cannot *reliably*," which is exactly why the answer is a system, not model trust.

### 5.3 Constrain generation — serve the system to the agent (practitioner evidence)

- **The default agent failure mode is off-system generation** — inventing components/styles instead of using the system ("unmergable slop: wrong props, bogus states"). Storybook's research: LLM use of design systems "improve[s] greatly when they have structured knowledge about what's available," quality scaling with metadata detail (descriptions, props, examples); their design-system-MCP experiment "produced significantly better components" than the uninstrumented agent. Figma's Dev Mode MCP articulates the same pattern commercially. [storybook.js.org/docs/ai/mcp, github.com/storybookjs/ds-mcp-experiment-reshaped]
- **The design-system-MCP pattern is emerging in open source** (better-design: MCP + shadcn registry serving tokens/components/review checklists to Claude Code/Cursor/Codex/Copilot) — illustrative, not yet effectiveness-proven.
- **High-investment lever (documented, deferred):** Apple CHI 2026 — ~1,460 annotations from 21 designers, distilled into reward models; sketch-feedback reward improved every baseline, and Qwen3-Coder-30B + reward beat GPT-5 on expert-judged arena (Elo 1,242 vs 1,121). "A small amount of high-quality expert feedback can efficiently enable smaller models to outperform larger proprietary LLMs in UI generation." The transferable insight for DPF: **a small curated founder/designer critique corpus is a high-leverage asset** — as judge grounding first, reward modeling later.

### 5.4 Evaluate and gate — what works, what is theater (mixed confidence)

- **LLM-as-judge UI critique is unusable zero-shot but workable grounded.** UICrit (UIST 2024): only 13.1% of zero-shot Gemini design comments were valid per professional designers; retrieval-augmented few-shot grounding in a curated human critique corpus + coordinate visual prompting improved quality 55% (0.48 → still below human 0.75). **A DPF screenshot-grading gate must be example-grounded in a curated critique corpus, not a bare rubric prompt.** [arxiv.org/html/2407.08850v2]
- **Syntactic a11y CI is necessary but cannot certify.** axe-core passes present-but-meaningless attributes (`alt="image"` passes every automated check); vendor Deque's own coverage report concedes ~57% issue coverage. Run axe in CI, and never call its green "accessible." [dl.acm.org/doi/10.1145/3772363.3799364, deque.com/automated-accessibility-coverage-report]
- **Verified-evidence gaps (treat as open):** *no surviving evidence* validated numeric cognitive-load proxies (words/screen, element density, choice count) against user outcomes — so DPF budgets are platform-owned calibration, enforced **advisory-then-ratchet**, never presented as science; and *no claims survived* on organizational governance patterns (design-QA cadence, exemption processes) — DPF must treat its own governance design as first-principles + measured iteration.

### 5.5 Benchmark positioning (per §10 design-research rule)

Open-source leaders read: **IBM Carbon** (token linter — adopted pattern), **Storybook MCP** (component-manifest-to-agent — adopted pattern), **better-design** (MCP+registry shape — pattern only), **shadcn registry** (component distribution manifest). Commercial: **Material 3** (token tiers — adopted), **Figma Dev Mode MCP** (design-context serving), **Chromatic/Percy** (visual regression as PR check — adopted pattern), **Vercel v0** (notably: optimizes *functional* success rate, not visual quality — evidence that even the leading commercial UI generator does not gate on design quality; DPF should not copy that). Anti-patterns identified: prompt-only design guidance (proven drift), zero-shot LLM judging (13.1%), attestation-only gates (our own §2 evidence), silent-empty evaluation chains (our own §2 evidence). Gap this design fills: no surveyed system connects budgets → generation constraints → rendered-DOM measurement → judged evaluation as one enforced loop across multiple agent surfaces.

## 6. Target architecture — seven layers, each with a named enforcement mode

The design principle: **every layer is either machine-readable data, a mechanically-enforced check, or an explicitly-named human judgment point — never prose that hopes.** Fail-loud is a cross-cutting invariant: a UX checker that cannot run must say so (capability probe), never return empty success (§2's three dark mechanisms are the counter-example this outlaws).

### L0 — Token foundation (extend color system → design system)

Extend `--dpf-*` beyond color to the full DTCG-shaped token surface, implemented CSS-first on the existing Tailwind v4.3 setup (`@theme` in `globals.css`, generating real utilities):

- **Spacing scale** (`--dpf-space-*`: 4-pt base progression) · **type scale** (`--dpf-text-*`: ~6 steps with paired line-heights; hierarchy becomes tokens, not ad-hoc `text-3xl font-bold`) · **density modes** (comfortable/compact context tokens the archetypes consume) · **elevation/radius** (defining the `shadow-dpf-*` tokens the FRONTEND_ENGINEER prompt already references but which do not exist — closing that drift) · **motion durations/easings** (the loading keyframes exist; name their scales).
- Canonical machine-readable token file in DTCG JSON (`apps/web/design/tokens.json` or equivalent) from which the `@theme` CSS is generated — the single source both the lint layer (L4) and the agent-serving layer (L3) read. Brand overrides keep working: runtime branding already overrides `--dpf-*` custom properties.

### L1 — Page archetypes and disclosure primitives (make the right structure the path of least resistance)

The owner-first wave proved the pattern per-surface; L1 promotes it to platform primitives — a small closed set of **page archetypes** as composable shells with disclosure built in, initially: `cockpit` (readiness + one next action), `worklist` (queue + item detail), `record-editor` (view-first, edit on intent), `settings` (3–5 essentials + deferred advanced), `wizard` (setup), `public-page` (customer storefront). Each archetype:

- computes its structure from an `OwnerFirstSummary`-style typed model (extends `owner-first/domain-summary.ts`), carries disclosure slots (`OwnerFirstDisclosure`, `CollapsibleList`, `ExpandableCard`) instead of free prose regions, stamps structural markers (the `data-owner-first-next-action` precedent) so measurement (L4) is DOM-checkable, and composes report-kit + `ui/form/` exclusively.
- **"Only legal way" rule, ratcheted like statusColors:** a new `app/**/page.tsx` renders through an archetype shell or appears in the migration baseline; the baseline only shrinks.

### L2 — The UX contract as data (budgets an agent can be held to)

One shared module (extending `owner-first/ux-audit.ts` + `OWNER_FIRST_SUMMARY_THRESHOLDS`) declaring **per-archetype budgets**: max words above the fold, max primary actions, max visible form fields (default-view 3–5 per existing doctrine), max choices per control (BI-0EC59231's lesson), min tap-target (`.dpf-tap-target` exists), readability tier (the Flesch-Kincaid policy in `lib/readability/` exists — wire it in), required next-action marker. Plus voice rules (archetype vocabulary via `resolveVocabularyKey` — already built). Per §5.4 the numeric values are **platform-owned calibration, versioned in code, enforced advisory-then-ratchet** — the mechanism is what matters: the SAME data feeds generation prompts (L3) and checkers (L4/L5), so "good" is defined once.

### L3 — Constrain generation on every surface (serve the system to the agent)

- **Design-system-as-skill** (strategy R8, finally owned): one versioned skill carrying tokens, archetype catalog, budgets, and anti-patterns — loaded by Build Studio UI dispatches (prompt injection), shipped in `dpf-platform` skill pack for Claude Code/Codex/Grok, pointed to from AGENTS.md §12. Kills the prompt-reality drift by **generating the skill's token/component sections from L0/L1 source** (single source of truth), and retires the contradictory guidance (`animate-pulse`, `bg-primary`, undefined tokens) from `specialist-prompts.ts` and the `ui-ux-pro-max` checklist.
- **Design-system MCP tools** (Storybook-pattern, extending the existing pack): repair the dark data plane (BI-018AE129), then evolve `search_design_intelligence`/`generate_design_system` into a component/archetype manifest server: `list_archetypes`, `get_component_manifest` (props, usage, examples from report-kit/README + tests), `get_ux_budgets(archetype)`. Quality scales with metadata detail — the manifests are generated from code, not hand-written.
- **Propose-N visual directions** at ideate for net-new surfaces: the primitive is built (`design-directions.ts`); wire its output into UX-Fit evidence, pick recorded as a `DecisionInteraction`.
- **Screenshot-in-the-loop self-check** during build: after the sandbox renders, the building agent looks at its own screenshot against the budgets before review (cheap; rides the repaired browser-use path).

### L4 — Mechanical gates (static + DOM-measured, ratcheted, all four surfaces)

- **Token lint, full surface** (Carbon precedent): extend the hex ratchet to spacing/type/motion — raw px paddings, ad-hoc text sizes, off-scale values flag against the L0 scales. Repo-loop guard (`check-guards.mjs`), so it binds Claude/Codex/Grok/BS identically via CI, not just the embedded pipeline.
- **`scanUiSource` goes repo-loop + ratchet:** the advisory BS-only scan becomes a `check-no-*` guard with a frozen baseline — new findings block, existing debt only shrinks. (Warn-never-block was §2's RC3.)
- **Route budget sweep — the wall-of-text gate:** promote `ux-audit.ts` from 2 unit tests to a rendered-DOM measurement harness: render changed routes (SSR string or sandbox DOM), measure against L2 budgets (words, controls, choices, tiny-text, next-action marker), compare to a per-route baseline. Advisory on introduction with the report attached to the PR; ratchet after calibration. **This is the check that makes "this iteration added a wall of text" a machine-visible diff instead of a founder observation.**
- **axe on rendered routes** in CI — necessary-not-sufficient per §5.4; its green is never reported as "accessible," and semantic a11y review stays in L5/L6.
- **UX-Fit gate upgrade, attestation → evidence** (strategy §7 direction, BI-65DEE968): the trailer must reference a persisted `DecisionInteraction` (propose-N pick, budget acknowledgment); the gate verifies the record exists and matches the diff, ending trailer-string theater.

### L5 — Judged evaluation (runtime, example-grounded, capability-probed)

- **Screenshot evidence on every UI PR:** multi-viewport (390px + desktop) × light/dark screenshot set from the repaired browser-use path (BI-1BAA177C) or Playwright, attached as PR evidence — humans and judges finally *see* the change.
- **Example-grounded LLM judge** (UICrit lesson): `visual-cognitive-load.ts` + a **DPF critique corpus** — seeded from the EP-UX-COGLOAD audit itself (40 findings with screenshots = retrieval examples of what-bad-looks-like-here and the founder's standard), grown by founder review notes (§5.3: small expert corpora are high-leverage). Rubric scores hierarchy/density/consistency per archetype; advisory with PR-visible scores first, ratcheting only after measured agreement with human verdicts (the gate-theater open question is answered with data, not optimism).
- **Visual regression for the system itself:** Playwright snapshots for report-kit + archetype shells (component-level, stable), catching silent drift in the primitives every surface composes.
- **Capability probes — checkers must prove they can fail:** every evaluator (design-intelligence load, browser-use eval, judge, axe run) runs a known-bad fixture on schedule/boot; empty-success from a checker that cannot detect the fixture is a red platform signal (`structural-verification-is-not-functional`, applied to the checkers). This is the systemic fix for §2's silent-degradation pattern.

### L6 — Human judgment residue (named, not hoped)

Per §5.2/§5.4 the residue is real: **direction picks** (propose-N at ideate — operator taste, recorded), **semantic a11y + fitness review** (does this screen serve *this* owner's next action), **budget calibration** (founder sets/adjusts L2 numbers from lived review), and **the critique corpus** (every founder UX review note is captured into the corpus — the flywheel that makes the judge better each quarter). Operationalized by reviving **AGT-906 `ux-design-critic`** (2026-05-16 spec, unbuilt) as the coworker that runs L4/L5 outputs, drafts the critique entries, and runs the weekly shell self-audit.

## 7. Scoped redesign going forward

Redesign = **migration to archetypes, worst-first, measured** — not a page-by-page patch wave (RC6's lesson) and not a big-bang rebrand:

1. **Baseline sweep first:** run the L4 route budget sweep across all owner surfaces → ranked league table of budget violations (words, controls, choices). This replaces opinion with measurement as the ordering function; publish on `/platform` (ops-visible).
2. **Migrate by archetype, not by page:** worst archetype cohort first (evidence to date: domain landing pages and settings/config surfaces — BI-3BCAF95F, BI-DA8BB376, BI-0EC59231, BI-2DD18122). Each migration PR: adopt shell, land inside budgets, screenshots attached, judge score recorded. Existing open EP-UX-COGLOAD items in a cohort become acceptance criteria of that cohort's migration rather than bespoke fixes.
3. **New surfaces born compliant:** from Phase 2 (§8) on, net-new `page.tsx` must use an archetype shell (ratchet) — the redesign converges because regression is blocked while the baseline shrinks.
4. **Done means measured:** the epic's exit criterion is every owner-facing route rendering through an archetype with budgets green (or a recorded per-route exception), not "we redesigned some pages."

## 8. Phasing & backlog coverage (EP-UX-SYSTEM)

| Phase | Items | Content |
|---|---|---|
| **0 — Repair the dark substrate** (immediately shippable bugs) | BI-018AE129 · BI-1BAA177C · BI-NEW-PROMPT-DRIFT | Ship design-intelligence data in the image + fail-loud; repair browser-use eval + degraded-run contract; reconcile FRONTEND_ENGINEER/ui-ux-pro-max guidance with enforced guards |
| **1 — Codify** | BI-NEW-TOKENS · BI-NEW-BUDGETS · BI-NEW-TOKEN-LINT · BI-NEW-ROUTE-SWEEP | L0 token scales + DTCG source; L2 budget module; L4 token lint extension; route budget sweep (advisory) — includes the baseline league table (§7.1) |
| **2 — Constrain** | BI-NEW-ARCHETYPES · BI-NEW-DS-SKILL · BI-NEW-DS-MCP · BI-NEW-PROPOSE-N | L1 archetype shells (2 first: cockpit, settings) + ratchet; design-system-as-skill on all four surfaces; manifest MCP tools; propose-N wired to UX-Fit evidence |
| **3 — Evaluate** | BI-NEW-SCREENSHOTS · BI-NEW-JUDGE · BI-NEW-PROBES · BI-NEW-UXFIT-EVIDENCE | Screenshot sets on UI PRs; example-grounded judge + critique corpus (seeded from the EP-UX-COGLOAD audit); capability probes; UX-Fit attestation→DecisionInteraction |
| **4 — Redesign** | BI-NEW-MIGRATE-1..N (cohort-sized) · AGT-906 revival | Worst-first archetype migrations per §7; ux-design-critic coworker operationalizes L6 |

Dependencies: Phase 0 unblocks L3's MCP serving and all of L5; Phase 1's sweep data orders Phase 4; Phase 2's shells are Phase 4's target substrate; ratchet flips (L4/L5 advisory→blocking) happen only after calibration evidence. BI ids are created at epic filing and backfilled here.

## 9. Non-goals

- **Not a visual rebrand** — brand/theming stays `Organization.designSystem` + runtime token overrides; this program is about structure, density, and consistency.
- **Not adopting an external component library** — report-kit + `ui/form/` remain the component substrate (the platform explicitly composes hand-rolled Tailwind on its own tokens); we adopt external *patterns* (Carbon's lint, Storybook's manifest-serving), not their components.
- **Not hard-gating on unvalidated numbers** — every numeric budget and judge score enters advisory, ratchets only with calibration evidence (§5.4's verified evidence gap).
- **Not reward-model fine-tuning now** — documented as the high-investment lever (§5.3) the critique corpus keeps open; judge grounding first.
- **Not per-worktree runtime harnesses** — all rendered-DOM/screenshot gates run via the shared local-CI sandbox lease or canonical install (§5/§17 doctrine).

## 10. Verification

- **The system tests the system:** every checker ships with known-bad fixtures it must flag (capability probes, L5) — a checker green on a fixture-fail is a red build. Budgets/archetypes/token modules carry unit tests; the route sweep and judge run against golden fixture pages (one deliberately-bad wall-of-text page stays in the fixture set forever).
- **Phase gates:** Phase 0 verified by the live install actually returning design-intelligence rows and a real evaluate_page screenshot (the two §2 probes re-run green); Phase 1+ verified per-BI through the standard build gate (§5 AGENTS.md), rendered-DOM gates via sandbox lease.
- **Program-level measure:** the §7.1 league table trend is the epic's scoreboard — median words-above-fold and controls-per-route on owner surfaces go down and stay down; new-route compliance stays at 100% (ratchet).
- **Evidence residue:** this spec + the research record are the epic's grounding artifacts; the deep-research citations live in §5; decisions recorded (`DI-14897C4D0792` epic shape; propose-N picks and budget calibrations as future `DecisionInteraction`s).

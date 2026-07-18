# UX Auditor Coworker — Heuristic, Agentic-AI, and Enterprise-Density Lenses

| Field | Value |
|-------|-------|
| **Epic** | EP-UX-AUDITOR (proposed) |
| **Status** | Draft — architect-reviewed 2026-05-16 (substrate corrections applied; see §0) |
| **Date** | 2026-05-16 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Architect** | Claude Opus 4.7 (chief-architect pass, 2026-05-16) |
| **Scope** | Two new sibling coworkers and their skills, both reusing existing substrate: (1) **`AGT-906 ux-design-critic`** — complements `AGT-903 ux-accessibility-agent` with heuristic-law, agentic-AI, and enterprise-density UX lenses; runs as a deliberation pair with AGT-903 in Build Studio Review and from `evaluate-page`. (2) **`AGT-907 ux-test-automator`** (§11) — converts audit findings and feature briefs into executable browser-use UX tests, maintains the platform's `tests/ux/` regression corpus, and plugs into the existing `build/review.verify` Inngest path with graceful degradation. First missions: a scheduled shell audit against the 2026-04-17 portal-nav-consolidation spec, plus a weekly regression run of the corpus. |
| **Companion specs** | [2026-04-27 persona audit](./2026-04-27-coworker-persona-audit-design.md), [2026-04-30 operator pattern](./2026-04-30-ai-coworker-operator-pattern.md), [2026-05-11 autonomous runtime](./2026-05-11-autonomous-coworker-runtime-design.md), [2026-04-17 portal-nav consolidation](./2026-04-17-portal-navigation-consolidation-design.md), [2026-04-25 Build Studio redesign](./2026-04-25-build-studio-redesign-design.md), [2026-05-10 visual control surface](./2026-05-10-ai-coworker-visual-control-surface-design.md), [2026-04-25 marketing coworker-led UX correction](./2026-04-25-customer-marketing-coworker-led-ux-correction.md), [2026-04-21 deliberation pattern framework](./2026-04-21-deliberation-pattern-framework-design.md), [2026-03-20 Build Studio UX streamlining](./2026-03-20-build-studio-ux-streamlining-design.md) |
| **Out of scope** | (a) Implementing the nav redesign itself — that belongs to the 2026-04-17 portal-nav spec; this spec turns that target into auditable invariants. (b) Rewriting the WCAG/accessibility audit — AGT-903 keeps that scope. (c) Build Studio shell layout — owned by the 2026-04-25 redesign spec. (d) Changing the persona file schema — uses the 2026-04-27 schema as-is. (e) Adding a new visual control surface — projects into the Operations Map per the 2026-05-10 spec. |
| **Primary goal** | When Mark (or any operator) looks at a DPF screen and says "this feels sloppy" or "the left nav takes too much space," a structured pair of coworkers can return a lens-grouped, evidence-backed audit of named violations with concrete fixes — and the same pair gates every Build Studio ship so future builds do not regress. |

---

## 0. Architect Review — 2026-05-16

Reviewed the draft against current substrate (`origin/main` HEAD `92353336`). The thesis, lens taxonomy, deliberation-pair invocation, and "first mission = audit DPF itself" framing are all sound and align with the platform's reuse-before-adding discipline. The following **substrate corrections** were applied inline — they are factual, not optional:

1. **AGT-ID collision.** `AGT-906` is already assigned to `documentation-specialist` in `packages/db/data/agent_registry.json` (line 2274) and reserved by the 2026-04-02 AI-workforce-consolidation spec §4. Renamed everywhere in this spec to **`AGT-906`** (next free slot after AGT-900/901/902/903/904/905).
2. **Verdict vocabulary vs finding-severity vocabulary disambiguated.** The shipped `UxFinding.severity` enum in `apps/web/lib/tak/page-evaluator.ts` is `"critical" | "important" | "minor"` — *not* `"critical" | "concerns" | "minor"` as v0 of this spec used. "concerns" is a coworker **verdict** word (per AGT-903's PASS/WARN/FAIL discipline and the Build Studio Reviewer-panel grammar), not a finding-severity word. Per-finding severity stays `critical | important | minor`; per-coworker verdict stays `pass | pass-with-minor | concerns | fail`. The Build Studio gate (§5.6) reads verdicts, not raw severities.
3. **DB model name.** No `DeliberationChain` model exists. The deliberation framework's tables are `DeliberationPattern`, `DeliberationRoleProfile`, and **`DeliberationRun`** (schema lines 7564–7604). All references corrected.
4. **`UxFinding` extension is additive, not a rename.** The shipped type has a `category` field with the existing axe-driven enum. Adding `lens` and `agentId` alongside `category` keeps every call site type-correct; `category` becomes a derived projection of `lens` for back-compat (e.g. `wcag-contrast → "contrast"`, all AGT-906 lenses → `"accessibility"` until the consumers fan out). §5.3 rewritten to make this explicit.
5. **Current AGT-903 runtime path.** `UX_ACCESSIBILITY_PROMPT` was removed from `specialist-prompts.ts` on 2026-04-20 (see header note in `apps/web/lib/integrate/specialist-prompts.ts:181`). Today's review-phase substrate is the Inngest handler `build/review.verify` at `apps/web/lib/queue/functions/build-review-verification.ts`, which drives `browser-use` against the live sandbox and writes `FeatureBuild.uxTestResults` + `FeatureBuild.uxVerificationStatus`; the gate is `checkPhaseGate`. AGT-906 must integrate at *that* seam, plus the universal `evaluate-page` MCP tool — not at the legacy `build-reviewers.ts` callsite that no longer drives UX. §1, §5.5, §5.6, and §7 updated.
6. **Canonical file paths.**
   - `apps/web/lib/build-reviewers.ts` is a re-export shim; canonical file is `apps/web/lib/integrate/build-reviewers.ts`.
   - `apps/web/lib/feature-build-types.ts` is a re-export shim; canonical file is `apps/web/lib/explore/feature-build-types.ts`.
   §7 corrected.
7. **Governed skill lifecycle.** `SkillRevision` and skill curator/lifecycle landed in PR #634/#638. The three new skill files MUST seed into `SkillDefinition` with a v1 `SkillRevision`, not bypass the governance loop. §5.4 updated.
8. **`AutonomousWorkRun` is a service, not a model.** The runtime is `apps/web/lib/tak/autonomous-work-run.ts`, and every audit run lands as a `TaskRun` row with the canonical `a2aMetadata` shape. References tightened in §5.5, §6.

The deliberation-pair recommendation and the choice of "one coworker with three skills" are both endorsed. The "first scheduled audit = DPF's own portal shell" mission is endorsed as the right way to dogfood the auditor and produce evidence the substrate works before opening it to feature builds.

**Open architect questions** (added to §10 with recommendations):

- Q8: Does AGT-906 inherit the same browser-use-on-live-sandbox path as AGT-903, or does it stay at the static-DOM `evaluate_page` layer? *Recommendation:* both — AGT-906's heuristic and density lenses can run on the static DOM via `evaluate_page`, but agentic-AI lenses (Intent Preview, Confidence Signal, Autonomy Dial) require interactive verification and should ride the same browser-use harness AGT-903 uses today.
- Q9: How does the auditor avoid duplicating findings AGT-903 already files (e.g. a Doherty-threshold spinner is also a `loading-state` WCAG concern)? *Recommendation:* AGT-906 dedupes against AGT-903's findings using `{ routeContext, element }` as the join key, then files only the lenses AGT-903 didn't claim. The merged report keeps both verdicts but each finding has exactly one `agentId`.

---

## 1. Problem Statement

DPF already has a real UX-audit substrate:

- `AGT-903 ux-accessibility-agent` — a cross-cutting WCAG 2.2 AA specialist (persona at [prompts/specialist/ux-accessibility.prompt.md](../../prompts/specialist/ux-accessibility.prompt.md), registry entry at [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json)). Its review-phase runtime is the Inngest handler `build/review.verify` ([apps/web/lib/queue/functions/build-review-verification.ts](../../../apps/web/lib/queue/functions/build-review-verification.ts)) which drives `browser-use` against the live sandbox and writes `FeatureBuild.uxTestResults` + `uxVerificationStatus`; `checkPhaseGate` reads those fields to block ship.
- `skills/universal/evaluate-page.skill.md` — universal skill any coworker can call to evaluate the current route.
- `apps/web/lib/tak/page-evaluator.ts` — shipped axe-core integration with `UxFinding` (severity `critical | important | minor`, category-typed) and `PageEvaluation` types. Pure-function module; live page interaction is the `evaluate_page` MCP tool.
- `skills/design/ui-ux-design-intelligence.skill.md` — 99-rule tactical reference for build-specialist.
- `docs/platform-usability-standards.md` — canonical CSS-variable + WCAG 2.2 AA standard.

What this substrate catches reliably: hardcoded colors, contrast violations, missing labels, broken keyboard navigation, semantic-HTML misuse, missing focus indicators.

What it does **not** catch — and what the platform's owner is consistently complaining about:

1. **Cognitive-load violations.** Nine top-level menu items, 14-tab Compliance, 10-tab Product detail. A page that "feels sloppy" usually means too many choices per layer, choice paralysis, or hidden state that requires recall.
2. **Predictability violations.** Conventions that diverge from common platforms (primary action in the wrong place, red where green is expected, unique navigation patterns).
3. **Error-resilience violations.** Destructive actions without confirmation, no undo, no preview before AI sends.
4. **Agentic-AI UX violations.** A coworker that takes action without an intent preview, AI output without confidence signals, no autonomy dial, no "why did I do this?" affordance. DPF is AI-native and has *zero* platform standard for these.
5. **Enterprise-density violations.** Object-fragmented UI (one logical object spread across many sibling tabs), demo-driven dashboards that lack drill-down, role-blind information density.
6. **Latency-perception violations.** Route changes and inference calls that exceed the Doherty threshold (~400ms) without skeleton screens.

The result: when the operator says "this is sloppy," there is no structured framework that grounds the complaint, names the violation, attributes it to a known law or principle, and turns it into evidence-backed backlog work. Each complaint becomes a one-off conversation, not a governed improvement loop.

This is the same gap the 2026-04-27 persona audit closed for coworker job descriptions and the routing-invariants audit closed for routing seeds: name the invariants, write the auditor, run it as a TaskRun, file the findings.

## 2. Goals

1. A **`ux-design-critic` coworker (AGT-906)** that applies heuristic-law, agentic-AI, and enterprise-density lenses to any DPF page or flow, complementing AGT-903's WCAG focus.
2. A **standard finding output format** — `⚠️ Violation / Observation / Risk / Fix` per Mark's research — emitted by both UX coworkers, renderable in Build Studio Reviewer-panel cards.
3. **Deliberation-pair invocation.** AGT-903 + AGT-906 run together as a UX deliberation pair (per [2026-04-21 deliberation framework](./2026-04-21-deliberation-pattern-framework-design.md) and the Reviewer-panel pattern from the [Build Studio redesign](./2026-04-25-build-studio-redesign-design.md)) in Build Studio Review and from user-invoked `evaluate-page`.
4. **First-class persistent work products** — `UxAuditReport`, `UxAuditFinding`, `UxAuditProceduralizationCandidate` — durable in the DB, surfaced in the Operations Map, not chat residue. (Per the [operator pattern](./2026-04-30-ai-coworker-operator-pattern.md): every coworker with operational responsibility produces durable work product.)
5. **TaskRun identity for every audit run** via `AutonomousWorkRun` (per [autonomous-runtime spec §5.1, Slice 1 SHIPPED](./2026-05-11-autonomous-coworker-runtime-design.md)) — interactive, scheduled, and build-triggered audits all land in the same governed work spine.
6. **Build Studio Review → Handover gate.** Both UX coworkers must reach a passing verdict for a build to ship; `concerns` opens a Reviewer-panel card; `fail` blocks. Minor findings file as backlog items automatically.
7. **First mission: audit DPF itself.** On landing, the auditor's first scheduled run audits the live portal shell (`/workspace`, `/business`, `/products`, `/platform`, `/knowledge`) against the [2026-04-17 portal-nav-consolidation spec](./2026-04-17-portal-navigation-consolidation-design.md). The output becomes the structured backlog Mark uses to evolve DPF's own UX — replacing one-off complaints with governed improvement work.

## 3. Non-Goals

- **No new substrate.** No new orchestration primitive, no new event grammar, no new visual control surface, no new persistence model beyond a possible JSON payload shape — everything projects into existing substrate per `autonomous-runtime §6.1` ("reuse before adding").
- **No deepening of WCAG.** AGT-903 owns accessibility audits and stays unchanged in this spec.
- **No nav redesign implementation.** The 2026-04-17 portal-nav-consolidation spec already prescribes the target shape (4-layer shell, 5 areas, ≤6 area-tabs). This spec only turns that prescription into auditable invariants. The implementation of those invariants is a separate downstream effort, fed by the audit findings.
- **No Build Studio shell layout changes.** The 2026-04-25 Build Studio redesign owns the two-pane conversational shell. This spec only adds Reviewer-panel cards for the new lenses; the card format itself is already defined there.
- **No persona schema changes.** This spec uses the 2026-04-27 persona audit schema (six body sections, required frontmatter) as-is.
- **No new fork of `evaluate_page`.** Reuses the shipped MCP tool and the `apps/web/lib/tak/page-evaluator.ts` engine.
- **No replacement of `ui-ux-design-intelligence` skill.** That skill stays as build-specialist's tactical reference. AGT-906 has its own lens-grouped skills.

## 4. Research & Benchmarking

### 4.1 UX Laws (heuristic lenses)

| Law | Source | DPF application |
|-----|--------|-----------------|
| **Hick's Law** | Hick (1952), Hyman (1953) | Choice time scales logarithmically with options. Apply to menu breadth, command palette, top-level nav, configurator pages. Target 4–6 destinations per layer (matches portal-nav §7.1). |
| **Fitts's Law** | Fitts (1954) | Time-to-acquire = f(distance, size). Apply to primary-action placement (bottom-right of form > top-left), touch targets (≥44px), button density vs whitespace. |
| **Miller's Law** | Miller (1956) | Working memory ≈ 7±2 chunks. Apply to navigation breadth at any one layer, tab counts, list item grouping, form field chunking. |
| **Doherty Threshold** | Doherty & Thadhani (IBM, 1982) | Productivity collapses above ~400ms response. Modern interpretation: above 400ms, use **skeleton screens**, not spinners. Apply to route changes, modal opens, AI inference responses. |
| **Jakob's Law** | Nielsen | Users spend most time on other sites; conventions matter. Apply to nav location (left rail, top utilities), color semantics (red ≠ save), iconography. |
| **Poka-Yoke** | Shingo (lean mfg, adapted to HCI) | Design out the error before it happens. Apply to destructive-action confirmation, undo affordance, form validation timing, AI intent preview. |

Canonical reference: [Laws of UX, Yablonski](https://lawsofux.com/) collates current source citations.

### 4.2 Process frameworks (the auditor's reasoning model)

- **Double Diamond** (UK Design Council, 2005) — Discover → Define → Develop → Deliver. Findings get positioned within a design-cycle stage so the fix lands at the right phase, not as a late patch.
- **Jobs-to-be-Done** (Christensen, Ulwick) — frame findings as missed jobs: *"When [situation], I want to [motivation], so I can [outcome]."* Stops findings from sliding into feature-request prose.
- **Fogg Behavior Model: B = MAP** (Fogg, 2009) — behavior requires Motivation, Ability, Prompt converging. Frame conversion/activation findings as the missing leg of MAP.

### 4.3 Agentic AI UX (new substrate, not in DPF standards today)

Sources: [Microsoft HAX Guidelines](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/), [Google People+AI Guidebook (Mental Models, Feedback+Control)](https://pair.withgoogle.com/), [Atlassian Rovo AI patterns](https://atlassian.design/patterns/rovo-ai), [Salesforce Einstein HITL](https://www.salesforce.com/blog/ai-and-human-touch/).

| Principle | Auditor invariant |
|-----------|-------------------|
| **Intent Preview** | Every AI-starting control shows what the coworker will do, which context will be used, what changes externally, before the user confirms. Reference implementation already exists in DPF: the `AgentWorkLauncher` 4-state pattern from [marketing coworker-led UX correction](./2026-04-25-customer-marketing-coworker-led-ux-correction.md) §4. Violation: any control that triggers `/api/agent/send` without an intermediate preview/confirm step. |
| **Confidence Signal** | When AI output is uncertain or generated, show it. Either quantified (`72% confident`), qualitative (`draft — please review`), or by visual treatment. Violation: AI-generated content that visually reads as deterministic system output. |
| **Autonomy Dial** | The user can choose Observe / Approve / Autonomous per coworker, per surface. DPF already has `executionMode: "proposal" | "act"` and `hitl_tier` — this lens enforces a *visible* per-surface control, not just admin config. |
| **Explainable Rationale** | "Why did I do this?" affordance reachable from every AI action. Backed by `ToolExecution.routeContext` + `ToolExecutionReceipt` + `TaskRun.a2aMetadata.sourceRef` (already audit truth per [autonomous-runtime §2.5](./2026-05-11-autonomous-coworker-runtime-design.md)). The lens enforces *exposure*, not new persistence. |

### 4.4 Enterprise density and role-aware disclosure

| Principle | Auditor invariant |
|-----------|-------------------|
| **Object-Oriented UX** (Voychehovski) | Interface organizes around domain objects, not pages. Compliance is one object; fragmenting it across 14 sibling tabs is an OOUX violation. Fix path: regroup per [portal-nav §7.2](./2026-04-17-portal-navigation-consolidation-design.md) into 6 lifecycle/domain tabs. |
| **Role-based progressive disclosure** | Analyst, manager, and executive see different densities. DPF already has `platformRole`; this lens flags screens that render identical content for every role. |
| **Demo-Driven UX trap** | A beautiful summary that cannot drill down. Lens flags any KPI tile, status chip, or summary card without an evidence-bound drill-in. The Operations Map and Authority views are the reference correct pattern. |
| **Density vs whitespace** | Operational software (which most of DPF is) tolerates higher density than marketing surfaces. The lens distinguishes by route class: `/workspace`, `/platform`, `/admin` get a higher density allowance than `/portal` (external) or onboarding/setup. |

### 4.5 Inclusive design (extension)

Three sub-lenses AGT-906 owns that AGT-903 does not:

- `prefers-reduced-motion` honored on every animation > 200ms.
- Plain-language scoring (Flesch-Kincaid ≥ 60 target) on body copy in non-developer routes.
- Clear, literal copy — flag schema-leaked labels (`sourceSummary`, `localityModel`) in user-facing surfaces. The 2026-04-25 marketing UX correction spec is the exemplar of this rule.

### 4.6 Patterns adopted / rejected

**Adopted:**
- Mark's research output format: `⚠️ Usability Violation: [Law/Heuristic]` / Observation / Risk / Fix. This is the canonical finding shape across AGT-903 and AGT-906.
- Paired-reviewer deliberation (existing DPF quality pattern, see [Build Studio redesign §"Refinement"](./2026-04-25-build-studio-redesign-design.md)).
- Per-lens severity rather than free-narrative summaries (matches AGT-903's existing PASS/WARN/FAIL discipline).
- Reuse-before-adding for persistence (matches [autonomous-runtime §6.1](./2026-05-11-autonomous-coworker-runtime-design.md)).

**Rejected:**
- Free-form prose audits ("this feels sloppy") — the failure mode the auditor exists to prevent.
- One mega-rule list — the 99-rule `ui-ux-design-intelligence` skill is the right shape for *build-specialist* tactical reference; AGT-906 needs lens grouping for *deliberation* clarity.
- Three separate coworkers (one per lens category) — triples invocation cost, splits the Reviewer-panel card, and defeats the deliberation-pair pattern (best at N=2).
- A new visual surface — projects into the Operations Map (per [2026-05-10 visual control surface](./2026-05-10-ai-coworker-visual-control-surface-design.md)) and Build Studio Reviewer-panel cards (per the 2026-04-25 redesign).

## 5. Design

### 5.1 New coworker — `AGT-906 ux-design-critic`

New entry in [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json) (insert after AGT-905 to keep numeric clustering with the other 9xx specialists):

```json
{
  "agent_id": "AGT-906",
  "agent_name": "ux-design-critic",
  "tier": "cross-cutting",
  "value_stream": "cross-cutting",
  "capability_domain": "Applies heuristic UX laws (Hick, Fitts, Miller, Doherty, Jakob, Poka-Yoke), agentic-AI UX principles (Intent Preview, Confidence Signal, Autonomy Dial, Explainable Rationale), and enterprise-density patterns (OOUX, role-aware disclosure, demo-driven trap) to evaluate routes and flows. Produces lens-grouped findings (Violation/Observation/Risk/Fix). Runs as a deliberation pair with AGT-903 in Build Studio Review and from the universal evaluate-page skill.",
  "human_supervisor_id": "HR-300",
  "hitl_tier_default": 3,
  "delegates_to": [],
  "escalates_to": "HR-300",
  "it4it_sections": [],
  "tool_grants": [
    "read_sandbox_file",
    "file_read",
    "evaluate_page",
    "backlog_write",
    "decision_record_create"
  ]
}
```

Tier and `hitl_tier_default: 3` mirror AGT-903's pattern: invoked during review, not user-addressed.

> **Architect note:** AGT-904 in the live registry is `documentation-specialist` (claimed by the 2026-04-02 AI-workforce-consolidation spec). AGT-906 is the next free 9xx specialist slot.

### 5.2 Persona file

New `prompts/specialist/ux-design-critic.prompt.md` following the [2026-04-27 persona schema](./2026-04-27-coworker-persona-audit-design.md) §3. Six required body sections:

1. **`# Role`** — "You are the UX Design Critic (AGT-906). Your domain is the cognitive-load, predictability, error-resilience, agentic-AI, and density properties of a screen — distinct from but complementary to AGT-903's WCAG focus."
2. **`# Accountable For`** — lens-grouped invariants (Hick's, Fitts's, Miller's, Doherty, Jakob's, Poka-Yoke, Intent Preview, Confidence Signal, Autonomy Dial, Explainable Rationale, OOUX, Role-Disclosure, Demo-Driven trap, Inclusive Design sub-lenses).
3. **`# Interfaces With`** — AGT-903 (paired reviewer), AGT-BUILD-FE (consumes findings), AGT-ORCH-300 (release gate), AGT-ORCH-000 / the COO (cross-platform recurring patterns), HR-300 (supervisor).
4. **`# Out Of Scope`** — fixing UI (filers, not implementers), aesthetic taste, WCAG/accessibility (AGT-903's lane), direct user conversation.
5. **`# Tools Available`** — mirrors registry `tool_grants` exactly (per the persona audit's PERSONA-007 invariant).
6. **`# Operating Rules`** — the lens checklist below, with pass/fail criteria each.

Per the persona schema, frontmatter requires `agent_id: AGT-906`, `reports_to: HR-300`, `delegates_to: []`, `value_stream: cross-cutting`, `hitl_tier: 3`, `status: active`.

### 5.3 Standard finding format

Extend the existing `UxFinding` in [apps/web/lib/tak/page-evaluator.ts](../../../apps/web/lib/tak/page-evaluator.ts) **additively** — keep `category` and `severity` exactly as shipped, layer `lens`, `agentId`, and the rich-finding fields on top. **No rename. No enum value changes.** Every existing call site keeps compiling without edits.

Shipped today (do not break):

```ts
// apps/web/lib/tak/page-evaluator.ts (current)
export type UxFinding = {
  severity: "critical" | "important" | "minor";
  category: "contrast" | "accessibility" | "focus" | "semantic-html"
          | "color-only" | "css-compliance" | "responsive";
  element: string;
  issue: string;
  recommendation: string;
  wcagRef?: string;
};
```

Extended shape:

```ts
export type UxFindingLens =
  // AGT-903 lenses (axe-driven; map to existing category enum for back-compat)
  | "wcag-contrast"
  | "wcag-semantic-html"
  | "wcag-keyboard"
  | "wcag-focus-order"
  | "wcag-label"
  | "wcag-touch-target"
  | "wcag-loading-state"
  | "wcag-color-only"
  | "wcag-other"
  // AGT-906 heuristic lenses
  | "hicks-law"
  | "fitts-law"
  | "millers-law"
  | "doherty-threshold"
  | "jakobs-law"
  | "poka-yoke"
  // AGT-906 agentic-AI lenses
  | "intent-preview"
  | "confidence-signal"
  | "autonomy-dial"
  | "explainable-rationale"
  // AGT-906 enterprise-density lenses
  | "object-oriented-ux"
  | "role-progressive-disclosure"
  | "demo-driven-trap"
  | "density-vs-whitespace"
  // AGT-906 inclusive-design lenses
  | "reduced-motion"
  | "plain-language"
  | "literal-copy";

export type UxFinding = {
  // Shipped fields — UNCHANGED:
  severity: "critical" | "important" | "minor";
  category: "contrast" | "accessibility" | "focus" | "semantic-html"
          | "color-only" | "css-compliance" | "responsive";
  element: string;
  issue: string;             // Existing field; aliased to `observation` in the rendered template.
  recommendation: string;    // Existing field; aliased to `fix` in the rendered template.
  wcagRef?: string;

  // New, optional, additive — populated by AGT-906 and the upgraded AGT-903 emitter:
  agentId?: "AGT-903" | "AGT-906";
  lens?: UxFindingLens;
  routeContext?: string;     // Required for AGT-906 emissions; AGT-903 will backfill in Slice 2.
  risk?: string;             // "Why this hurts the user" — distinct from `issue`/`observation`.
  evidenceRef?:
    | { kind: "axe-rule"; rule: string; helpUrl: string }
    | { kind: "code-line"; file: string; line: number }
    | { kind: "screenshot"; receiptId: string }
    | { kind: "spec"; specPath: string; section?: string };
};
```

`category` becomes a derived projection of `lens` for any new emitter — e.g.:

| lens | derived `category` |
|------|--------------------|
| `wcag-contrast` | `"contrast"` |
| `wcag-focus-order` / `wcag-keyboard` | `"focus"` |
| `wcag-semantic-html` | `"semantic-html"` |
| `wcag-color-only` | `"color-only"` |
| any AGT-906 lens (Slice 2) | `"accessibility"` (until consumers fan out) |

Existing axe-core categorization in `categorizeAxeViolation()` keeps producing today's shape; the wrapper writes `agentId: "AGT-903"` and the corresponding `lens` alongside. Severity vocabulary is **unchanged** at the finding layer — per-coworker verdict aggregation in §5.6 is where "concerns" and "fail" live.

Rendered output template — both coworkers emit findings in this shape. The template aliases existing field names where applicable, so no data-layer field rename is required:

```text
⚠️ Usability Violation: [Lens]                  ← finding.lens (fallback: finding.category)
Observation: <what the auditor sees>            ← finding.issue
The Risk: <why it hurts the user>               ← finding.risk (AGT-906) | derived narrative (AGT-903)
The Fix: <specific actionable change>           ← finding.recommendation
Evidence: <axe-rule | code-line | screenshot | spec-link>  ← finding.evidenceRef | finding.wcagRef
```

### 5.4 Skills

Three new skills assigned to AGT-906 (seeded into `SkillDefinition` with a v1 `SkillRevision` and a `SkillAssignment` row each — per AGENTS.md §2 and the governed-skill-lifecycle landed in PRs #634/#638). The new skills participate in the same revision/proposal/curator loop as every other skill — no bypass:

- **`skills/design/heuristic-ux-laws.skill.md`** — lens-by-lens checklist for Hick's, Fitts's, Miller's, Doherty, Jakob's, Poka-Yoke. Each lens has: invariant statement, pass/fail criterion, evidence shape, default severity (`critical | important | minor`), common fix paths.
- **`skills/design/agentic-ai-ux.skill.md`** — Intent Preview, Confidence Signal, Autonomy Dial, Explainable Rationale. Each lens references DPF's existing implementation (`AgentWorkLauncher`, `executionMode`, `ToolExecutionReceipt`, etc.) so the auditor compares against canonical patterns, not against external benchmarks.
- **`skills/design/enterprise-density.skill.md`** — OOUX, role-based disclosure, density-vs-whitespace, demo-driven trap. Includes route-class severity defaults (`/workspace` vs `/portal` get different density thresholds).

The existing `skills/universal/evaluate-page.skill.md` stays as the entry-point. Its `assignTo` remains `["*"]` (universal-callable), but the skill now dispatches AGT-903 + AGT-906 as a deliberation pair internally rather than running a single-agent walkthrough. The skill's revision history is updated through the curator loop, not by direct file edit.

### 5.5 Deliberation-pair invocation

Per the [2026-04-21 deliberation pattern framework](./2026-04-21-deliberation-pattern-framework-design.md) and the Reviewer-panel card pattern from the [2026-04-25 Build Studio redesign](./2026-04-25-build-studio-redesign-design.md) §"Refinement":

```text
trigger
  └─ AutonomousWorkRun service           (apps/web/lib/tak/autonomous-work-run.ts;
  │                                        per 2026-05-11 §5.1 / §10 Slice 1 — SHIPPED PR #468)
  └─ TaskRun row created                 (source="coworker",
  │                                        a2aMetadata.trigger ∈ {interactive | scheduled | build},
  │                                        a2aMetadata.sourceRef = { kind: "ux-audit", id: routeContext })
       └─ DeliberationRun                (pattern: ux-audit-pair; roles: ["AGT-903","AGT-906"])
            ├─ each runs evaluate_page MCP tool on the URL (heuristic + density lenses)
            ├─ agentic-AI lenses additionally drive browser-use via build/review.verify
            │   when invocation is build-triggered
            ├─ each emits UxFinding[] in the shape from §5.3
            └─ verdict per coworker: pass | pass-with-minor | concerns | fail
       └─ TaskArtifact (kind="ux-audit-report")  — merged findings
       └─ BacklogItemActivity (kind="ux-audit")  — one per finding category,
                                                   only for severity ∈ {critical, important}
```

`DeliberationRun` is the canonical model (schema lines 7604+; tables: `DeliberationPattern`, `DeliberationRoleProfile`, `DeliberationRun`). No `DeliberationChain` model exists.

Reviewer-panel card (per Build Studio redesign §"three new conversation cards"):

```text
I asked 2 reviewers to check this page.
  • AGT-903 UX Accessibility    ✓ pass (4 minor)
  • AGT-906 UX Design Critic    ⚠ concerns (1 critical, 3 concerns, 2 minor)
[See full reviews]
```

When both pass cleanly: collapses to a single green chip "2 UX reviewers signed off."
When they disagree on severity: opens a Deliberation card (existing pattern).

### 5.6 Verdict aggregation — Build Studio Review → Handover

Vocabulary disambiguation:
- **Finding-level severity** (per item, on the wire): `critical | important | minor`. Unchanged from §5.3.
- **Coworker-level verdict** (one per reviewer, per audit): `pass | pass-with-minor | concerns | fail`. Derived by the reviewer from its own finding set.
- **Gate decision** (Build Studio Review → Handover): one of `ship | ship-with-followups | open-deliberation | block`.

Verdict derivation rule (deterministic; both coworkers use this projection):

| Reviewer's finding set | Verdict |
|------------------------|---------|
| Zero findings, or only `minor` findings | `pass` (≤2 minor) or `pass-with-minor` (≥3 minor) |
| ≥1 `important` finding, no `critical` | `concerns` |
| ≥1 `critical` finding | `fail` |

The review-phase orchestrator (the Inngest handler `build/review.verify` at [apps/web/lib/queue/functions/build-review-verification.ts](../../../apps/web/lib/queue/functions/build-review-verification.ts), and the gate `checkPhaseGate` reading `FeatureBuild.uxTestResults` + `uxVerificationStatus`) merges the two reviewer verdicts:

| AGT-903 | AGT-906 | Gate decision |
|---------|---------|---------------|
| pass | pass | `ship` |
| pass | pass-with-minor | `ship-with-followups` — auto-file minor findings as backlog items |
| pass-with-minor | pass-with-minor | `ship-with-followups` |
| any | concerns | `open-deliberation` — Reviewer-panel + Deliberation card; user resolves before ship |
| any | fail | `block` — critical findings become required-fix backlog items linked to the build |
| fail | any | `block` — preserves existing AGT-903 behavior |

Backward compatibility for in-flight builds: if `uxTestResults` exists but only carries AGT-903 findings (no `agentId` field stamped), the merged-verdict layer treats the absent AGT-906 verdict as `pass` and gates on AGT-903 alone — preserving today's behavior. The merged verdict is **required** for builds created after Slice 3 of this spec merges.

### 5.7 Persistent work products

Per the [operator pattern §3.4](./2026-04-30-ai-coworker-operator-pattern.md), AGT-906 must produce durable work product. Following the [autonomous-runtime §6.1 "reuse before adding"](./2026-05-11-autonomous-coworker-runtime-design.md) rule:

- **`UxAuditReport`** — stored as a `TaskArtifact` keyed by the parent `TaskRun`. Shape: `{ routeContext, runTaskRunId, agentVerdicts: { "AGT-903": Verdict; "AGT-906": Verdict }, gateDecision: GateDecision, findings: UxFinding[], deliberationRunId?: string, createdAt }`.
- **`UxAuditFinding`** — embedded in the report's `findings` array. Each finding can also project to a `BacklogItemActivity` with `kind: "ux-audit"` when filed.
- **`UxAuditProceduralizationCandidate`** — per [autonomous-runtime §5.7](./2026-05-11-autonomous-coworker-runtime-design.md), when the same `{ lens, routeContext-prefix }` finding recurs across N audits, surface a proceduralization candidate. Stored in `TaskRun.a2aMetadata.cognitiveLoad.repeatedPatternKey` (the existing field).

No new DB tables in v1. Reassess after Slice 5 telemetry of the autonomous-runtime spec (per §6.2 of that spec).

### 5.8 First mission — audit DPF itself against the portal-nav-consolidation spec

On landing, AGT-906 gets a single `ScheduledAgentTask` (timezone UTC, weekly cadence to start, weekday morning):

| Field | Value |
|-------|-------|
| `taskId` | `dpf-shell-ux-audit-weekly` |
| `agentId` | `AGT-906` (orchestrator; AGT-903 invoked as deliberation peer) |
| `title` | `DPF Shell UX Audit` |
| `routeContext` | `/workspace` (entry point; audit walks `/workspace`, `/business`, `/products`, `/platform`, `/knowledge`, `/admin`) |
| `schedule` | `0 13 * * 1` (Monday 13:00 UTC) |
| `prompt` | "Run the UX deliberation pair against the live DPF portal shell. Compare findings against the invariants in [2026-04-17-portal-navigation-consolidation-design.md](./2026-04-17-portal-navigation-consolidation-design.md) §6 (shell hierarchy), §6.2 (5 primary areas), §7 (≤6 area tabs), §8 (setup decoupled from shell chrome), §9 (workspace = personal dashboard, not menu). File backlog items per finding category. Group similar findings; do not create one item per element." |

Expected initial findings (a hypothesis to validate, not a foregone conclusion — the auditor produces the actual evidence):

- **Hick's Law / Miller's Law violations** on any layer with > 6 destinations.
- **Doherty Threshold violations** on route changes that exceed 400ms without skeleton screens.
- **Object-Oriented UX violations** in any section where one logical object is fragmented across many sibling tabs (Compliance, Product detail, Admin per the portal-nav spec §3.4–3.5).
- **Intent Preview violations** on any AI-starting control that does not use the `AgentWorkLauncher` pattern.
- **Jakob's Law violations** against the Atlassian / Plane / Fluent benchmark conventions the portal-nav spec cites.
- **Density-vs-whitespace findings** on routes where the operator complaint "takes too much space" maps to measurable padding / typography / layout decisions.

The output is a structured backlog Mark uses to drive evolution — not a one-off review.

## 6. Data Model

Per [autonomous-runtime §6.1 "reuse before adding"](./2026-05-11-autonomous-coworker-runtime-design.md):

- **`TaskRun`** for each audit run. `source: "coworker"`, `a2aMetadata.trigger ∈ { "interactive" | "scheduled" | "build" }`, `a2aMetadata.sourceRef: { kind: "ux-audit", id: routeContext }`.
- **`TaskArtifact`** holding the `UxAuditReport` JSON payload.
- **`BacklogItemActivity`** with `kind: "ux-audit"` for findings filed against a route or feature build.
- **`ToolExecution`** for each `evaluate_page` tool call within the run.
- **`ToolExecutionReceipt`** for the verifiable audit result (axe-core run digest + AGT-906 lens summary).
- **`DeliberationRun`** (+ `DeliberationPattern` seed `ux-audit-pair`, + `DeliberationRoleProfile` rows for AGT-903 and AGT-906) for the review pair, per the 2026-04-21 framework. `TaskNode.deliberationRunId` carries the branch-node linkage already shipped.

No new tables in v1. Promotion to dedicated tables is deferred until either:
- Operations Map projection (per 2026-05-10) shows the JSON-path query as a hot bottleneck, or
- Slice 5 of the autonomous-runtime spec shows recurring proceduralization patterns that need indexed query.

## 7. Files Affected

**Registry, persona, skills:**
- Modify: [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json) — add AGT-906 per §5.1.
- Create: `prompts/specialist/ux-design-critic.prompt.md` — persona per §5.2.
- Modify: [skills/universal/evaluate-page.skill.md](../../../skills/universal/evaluate-page.skill.md) — switch from single-agent walkthrough to deliberation-pair dispatch; update output template to the standard `⚠️/Observation/Risk/Fix` shape.
- Create: `skills/design/heuristic-ux-laws.skill.md` — Hick's, Fitts's, Miller's, Doherty, Jakob's, Poka-Yoke.
- Create: `skills/design/agentic-ai-ux.skill.md` — Intent Preview, Confidence Signal, Autonomy Dial, Explainable Rationale.
- Create: `skills/design/enterprise-density.skill.md` — OOUX, role-disclosure, demo-driven, density-vs-whitespace, plus reduced-motion / plain-language / literal-copy sub-lenses.

**Runtime — page evaluator & review-verify pipeline:**
- Modify: [apps/web/lib/tak/page-evaluator.ts](../../../apps/web/lib/tak/page-evaluator.ts) — extend `UxFinding` **additively** per §5.3 (no rename of `category`; no severity-enum change); existing axe-core categorization stamps `agentId: "AGT-903"` and `lens: "wcag-*"` **alongside** the existing `category`.
- Modify: [apps/web/lib/queue/functions/build-review-verification.ts](../../../apps/web/lib/queue/functions/build-review-verification.ts) — wrap the current `browser-use` UX-test path in the AGT-903 + AGT-906 deliberation-pair dispatch via the `AutonomousWorkRun` service; persist the merged `UxAuditReport` as a `TaskArtifact`; emit one `verification:*` event per reviewer so the coworker panel and ReviewPanel both update live.
- Modify: [apps/web/lib/build-review-verification-trigger.ts](../../../apps/web/lib/build-review-verification-trigger.ts) — pass the deliberation-pattern key (`ux-audit-pair`) through the trigger event payload.
- Modify: `apps/web/lib/integrate/build-reviewers.ts` (canonical; `apps/web/lib/build-reviewers.ts` is a re-export shim) — update the design-review prompt's Accessibility checklist (lines 32–38) to acknowledge AGT-906's complementary scope so the design-doc reviewer stops re-asking for things AGT-906 will catch live.
- Modify: `apps/web/lib/explore/feature-build-types.ts` (canonical; `apps/web/lib/feature-build-types.ts` is a re-export shim) — extend `uxTestResults` to carry both coworker verdicts + the merged gate decision; preserve backward compatibility for in-flight builds per §5.6.
- Modify: `apps/web/lib/build-flow-state.ts` and the `checkPhaseGate` callsites — read the new merged gate decision; preserve the legacy fallback that gates on AGT-903 alone.
- Modify: Build Studio Reviewer-panel rendering (`apps/web/components/build/...`) — render the two-coworker Reviewer-panel card per [Build Studio redesign §"three new conversation cards"](./2026-04-25-build-studio-redesign-design.md).

**Scheduled task:**
- Modify: `packages/db/src/seed.ts` (or current scheduled-task seed location) — add the `dpf-shell-ux-audit-weekly` `ScheduledAgentTask` per §5.8.

**Documentation:**
- Modify: [docs/platform-usability-standards.md](../../platform-usability-standards.md) — add three sections (Heuristic Lenses, Agentic AI UX Lenses, Enterprise Density Lenses) with one-paragraph summaries linking back to this spec. Standards stay canonical; this spec stays the long-form rationale.

## 8. Testing Strategy

- **Persona audit** — the 2026-04-27 audit script must pass for the new persona (PERSONA-001 through -010).
- **Type safety** — `UxFinding` extension type-checks; existing axe-core paths continue to compile.
- **Unit tests** — finding categorization for each new lens: synthetic inputs produce the expected `lens` + `severity`.
- **Unit tests** — verdict aggregation matrix (§5.6) exhaustively covered.
- **Integration test** — Build Studio Review phase with a deliberately bad sandbox feature (e.g., 14 nav tabs, no skeleton screens, AI button that auto-sends) produces both AGT-903 and AGT-906 findings as Reviewer-panel cards, with the right gate decision.
- **Integration test** — user invokes `evaluate-page` on `/workspace`; receives merged findings from both coworkers; backlog filing only happens for `critical` and `important` severities; `minor` findings ride the `ship-with-followups` path.
- **Acceptance** — first scheduled run of `dpf-shell-ux-audit-weekly` completes and files at least one backlog item against the live shell.

## 9. Demo Story

Mark looks at `/workspace` and says: *"This feels sloppy and the left nav takes too much space."*

He opens the AI coworker panel and invokes `Evaluate this page`. The universal skill dispatches an `AutonomousWorkRun` with the AGT-903 + AGT-906 deliberation pair. About 20 seconds later, the merged report comes back as a Reviewer-panel card:

> **I asked 2 reviewers to check this page.**
>
> - **AGT-903 UX Accessibility** — ✓ pass (3 minor)
> - **AGT-906 UX Design Critic** — ⚠ concerns verdict (1 critical, 4 important, 2 minor)
>
> [See full reviews]

Expanding AGT-906's findings:

> ⚠️ **Usability Violation: Hick's Law** *(severity: critical)*
> **Observation:** Primary AppRail exposes 8 destinations at the top layer.
> **The Risk:** Scan time grows logarithmically with options; infrequent visitors cannot anchor to a smaller set of areas.
> **The Fix:** Regroup per [portal-nav-consolidation §6.2](./2026-04-17-portal-navigation-consolidation-design.md) into 5 areas — Workspace / Business / Products / Platform / Knowledge. Move secondary destinations into area-nav.
> **Evidence:** `apps/web/components/shell/AppRail.tsx`, lines 31–55; spec link: `2026-04-17-portal-navigation-consolidation-design.md#62-primary-app-rail`.
>
> ⚠️ **Usability Violation: Doherty Threshold** *(severity: important)*
> **Observation:** Route change `/workspace` → `/platform` shows a spinner for 800ms before content paints.
> **The Risk:** Above 400ms, perceived sluggishness; users assume a frozen page; some abandon.
> **The Fix:** Render skeleton placeholders for the area-nav strip and primary cards while data resolves. Existing `apps/web/components/shell/AttentionStrip.tsx` is the wrong artifact to leave in the spinner window.
> **Evidence:** screenshot receipt id `txr_abc123`.
>
> ⚠️ **Usability Violation: Object-Oriented UX** *(severity: important)*
> **Observation:** Compliance object is fragmented across 14 sibling tabs in `ComplianceTabNav.tsx`.
> **The Risk:** Operator holds the compliance object in working memory across many sub-pages; can't reason about it as a single thing.
> **The Fix:** Regroup per [portal-nav-consolidation §7.2](./2026-04-17-portal-navigation-consolidation-design.md) into 6 lifecycle/domain tabs (Overview / Library / Controls / Assurance / Risk / Operations).
> **Evidence:** `apps/web/components/compliance/ComplianceTabNav.tsx`.

Each finding becomes a backlog item (grouped by category, not one per element — per the existing `evaluate-page` skill's rule). Mark says *"Build fixes for these now"* — the existing handoff path assembles a `FeatureBrief` from the findings and launches Build Studio. The Reviewer-panel card surfaces both reviewers' verdicts on every subsequent build that touches the shell, so the auditor closes the loop on its own findings.

## 10. Open Decisions

1. **Should `UxAuditReport` be a new model or stay as `TaskArtifact` + `BacklogItemActivity`?**
   **Recommendation:** stay embedded for v1. Promote only after Operations Map projection (per 2026-05-10) or the Slice 5 metrics of the autonomous-runtime spec show JSON-path query as a hot bottleneck. This matches the "reuse before adding" rule in autonomous-runtime §6.1.

2. **Should AGT-906 be one coworker with three skills, or three sibling coworkers (one per lens category)?**
   **Recommendation:** one coworker. Three coworkers triples invocation cost, splits Reviewer-panel cards, and breaks the deliberation pair (best at N=2 per the framework). The three lens categories live as three skills assigned to the one coworker.

3. **Should the auditor enforce the portal-nav-consolidation spec as a hard invariant or as advisory findings?**
   **Recommendation:** start advisory (severity = `important` — produces a `concerns` verdict, opens a Deliberation card) in v1. Promote to `critical` / hard invariant after Phase 1–3 of the portal-nav spec land — at that point, regressions back to the old shape would be defects that should `fail` the build.

4. **Should there be a numeric Hick's Law threshold (e.g., max 5 nav items per layer)?**
   **Recommendation:** yes — bake the 4–6 target from portal-nav §7.1 into the audit rule as a default. Configurable per `platformRole` later if dense-operator roles need more.

5. **Where do per-lens severity defaults live so admins can tune them?**
   **Recommendation:** in the skill file frontmatter, so they ride the existing prompt/skill seeding path and become editable via Admin > Prompts. Inline overrides per audit run discouraged.

6. **Does this spec touch AGT-903's persona?**
   **Recommendation:** no content change to AGT-903's persona, but its `# Interfaces With` section should be updated to name AGT-906 as the deliberation peer. That is a follow-up under the 2026-04-27 persona audit's "PR 2..N backfill" pattern, not a v1 deliverable here.

7. **Should the first scheduled audit also walk Build Studio's own sandbox pages, or only the live portal shell?**
   **Recommendation:** portal shell only in v1. Build Studio gets audited per-feature already (Review phase). A self-audit of Build Studio's *own UI* is valuable but separate scope — file as follow-up.

8. **Static-DOM `evaluate_page` vs interactive `browser-use` for AGT-906?** *(architect-added)*
   **Recommendation:** both, layered by lens family. Heuristic lenses (Hick, Fitts, Miller, Jakob, Poka-Yoke) and density lenses run cheaply against the static DOM via `evaluate_page`. Doherty Threshold and the agentic-AI lenses (Intent Preview, Confidence Signal, Autonomy Dial, Explainable Rationale) require multi-step interaction and should ride the same `browser-use` harness AGT-903 uses today inside `build/review.verify`. The skill files declare per-lens runtime so the orchestrator picks the right tool.

9. **De-duplication between AGT-903 and AGT-906 on overlapping findings.** *(architect-added)*
   A Doherty-threshold spinner is also a `wcag-loading-state` concern; a missing focus indicator on an AI action is both AGT-903 and AGT-906 lanes.
   **Recommendation:** AGT-906 dedupes against AGT-903's emitted findings using `{ routeContext, element }` as the join key. AGT-906 emits only the lenses AGT-903 didn't claim. The merged report retains both reviewer verdicts but each individual finding has exactly one `agentId` — no double-filing of backlog items.

## 11. Companion Coworker — UX Test Automator (AGT-907)

The auditor pair (AGT-903 + AGT-906) *finds* violations. It does not *prove* the next build doesn't regress them. This section adds a sibling coworker — **`AGT-907 ux-test-automator`** — that converts findings and feature briefs into executable UX tests, runs them against the platform's automation harness, and maintains a living UX regression corpus.

### 11.1 Why a separate coworker (not folded into AGT-906)

| Concern | Auditor (AGT-906) | Tester (AGT-907) |
|---------|-------------------|------------------|
| Work product | `UxFinding[]` (transient, route-anchored) | Test plan files (`tests/ux/*.ux-test.md`), durable, PR-reviewed |
| Cadence | Per audit invocation (interactive / build / weekly) | Per feature build (test-gen) + per regression cycle (corpus run) |
| Tool surface | `evaluate_page`, browser-use *read* (extract/screenshot) | browser-use *run* (`browse_run_tests`), `file_write`, evidence-receipt write |
| Lifecycle | Point-in-time | Evolves over time; test corpus is versioned |
| Failure mode | Misses a violation | Misses a regression (different remediation: fix the lens vs. fix the test) |

Folding AGT-907 into AGT-906 would conflate **finding** (analytical) with **proving** (operational) and would force one persona's `# Out Of Scope` to lie. The 2026-04-30 operator-pattern explicitly says skills are workflows; these are different workflows.

### 11.2 Substrate it plugs into (existing — verified 2026-05-16)

- **Automation harness:** `browser-use` MCP server at `http://browser-use:8500/mcp`. Tools: `browse_run_tests`, `browse_open`, `browse_extract`, `browse_screenshot`. See [apps/web/lib/operate/browser-use-client.ts](../../../apps/web/lib/operate/browser-use-client.ts). The older `playwright-runner.ts` is a 2-line re-export shim — Playwright has been replaced by browser-use as the canonical AI-powered automation surface.
- **Review-phase entrypoint:** [apps/web/lib/queue/functions/build-review-verification.ts](../../../apps/web/lib/queue/functions/build-review-verification.ts) fires on `build/review.verify`, loads `brief.acceptanceCriteria`, calls `runBrowserUseTests(sandboxUrl, testCases, { buildId })`, persists `UxTestStep[]` to `FeatureBuild.uxTestResults`, and sets `uxVerificationStatus ∈ { "running" | "complete" | "failed" | "skipped" }`. `checkPhaseGate` reads those fields.
- **Existing test executor:** `AGT-BUILD-QA build-qa-engineer` runs typecheck + sandbox tests. Its persona at [prompts/specialist/qa-engineer.prompt.md](../../../prompts/specialist/qa-engineer.prompt.md) explicitly puts **"authoring tests"** out of scope — that gap is exactly what AGT-907 fills for the UX surface.
- **Evidence surface:** `FeatureBuild.uxTestResults` (`UxTestStep[]` with screenshot URLs), `ToolExecutionReceipt` for verifiable run digests, `BacklogItemActivity(kind="ux-regression")` for filed regression findings.

### 11.3 What's missing today

1. **No coworker generates UX-specific test plans.** Today, `brief.acceptanceCriteria` is the only input to `runBrowserUseTests`. Acceptance criteria are functional ("user can submit complaint"), not lens-specific ("nav layer has ≤6 destinations"). There is no audit-finding → test-case pipeline.
2. **No durable platform-wide UX regression suite.** Each `FeatureBuild` runs against its own brief. There is no persistent corpus of "tests that prove DPF's portal shell still meets its UX invariants" that runs independently of any one build.
3. **No per-lens test generators.** Hick's-count assertions, Doherty wall-clock measurements, Intent-Preview click-through patterns, and OOUX tab-count assertions are all expressible as browser-use natural-language tests, but no skill produces them today.
4. **No closed-loop from finding → test.** When AGT-906 files a `hicks-law` violation against `/workspace`, nothing produces the regression test that would catch the same violation next quarter.

### 11.4 Coworker definition

New entry in [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json):

```json
{
  "agent_id": "AGT-907",
  "agent_name": "ux-test-automator",
  "tier": "cross-cutting",
  "value_stream": "cross-cutting",
  "capability_domain": "Generates browser-use UX test plans from feature briefs and UxFinding[] inputs. Maintains the platform's UX regression test corpus under tests/ux/. Runs per-feature tests during Build Studio review and the full corpus during scheduled regression cycles. Records evidence as ToolExecutionReceipt and files regressions as backlog items. Sibling to AGT-BUILD-QA (which executes functional tests but explicitly does not author them).",
  "human_supervisor_id": "HR-200",
  "hitl_tier_default": 2,
  "delegates_to": [],
  "escalates_to": "HR-200",
  "it4it_sections": ["5.3 Integrate Value Stream", "5.3.3 Design & Develop", "5.3.5 Accept & Publish Release"],
  "tool_grants": [
    "read_sandbox_file",
    "file_read",
    "file_write_test_corpus",
    "evaluate_page",
    "browser_use",
    "backlog_write",
    "decision_record_create"
  ]
}
```

`file_write_test_corpus` is a **new narrowly-scoped grant** restricted to `tests/ux/**` (definition lives in the companion tool-grant spec referenced by the persona audit). AGT-907 must not have general `file_write` — its only write target is the test corpus, and even that goes through PR for v1 (see §11.7).

### 11.5 Persona

New `prompts/specialist/ux-test-automator.prompt.md` following the 2026-04-27 schema. Six required sections:

1. **`# Role`** — "You are the UX Test Automator (AGT-907). You convert UX findings and feature briefs into executable browser-use test plans, and you maintain the platform's UX regression corpus. You do not review the UI yourself — that is AGT-903 and AGT-906's job. You do not fix the UI — that is AGT-BUILD-FE's job. You prove that the UI does or does not behave the way the auditor said it should."
2. **`# Accountable For`** — Per-feature test generation from `brief.acceptanceCriteria` + audit findings. Corpus authorship under `tests/ux/<route>.ux-test.md`. Test execution via `browse_run_tests`. Evidence recording as `ToolExecutionReceipt`. Regression filing as `BacklogItemActivity(kind="ux-regression")`. Lens→assertion mapping discipline (every test names the lens it covers).
3. **`# Interfaces With`** — AGT-906 (consumes `UxFinding[]` to seed regression tests), AGT-903 (consumes WCAG findings the same way), AGT-BUILD-QA (peer — AGT-BUILD-QA owns functional/typecheck tests, AGT-907 owns UX tests; both report to HR-200), AGT-BUILD-FE (consumes failing test reports), AGT-ORCH-300 (release gate consumer), HR-200 (supervisor).
4. **`# Out Of Scope`** — Reviewing the UI (AGT-903/906). Fixing the UI (AGT-BUILD-FE). Functional / unit / typecheck tests (AGT-BUILD-QA). Auto-promoting a generated test into the corpus without PR review (v1). Conversational user interaction.
5. **`# Tools Available`** — Mirrors registry `tool_grants` per the PERSONA-007 invariant.
6. **`# Operating Rules`** — The lens→test mapping table (§11.6.2 below) is the audit-ready rubric; the test file format (§11.7) is the authoring contract.

Frontmatter: `agent_id: AGT-907`, `reports_to: HR-200`, `delegates_to: []`, `value_stream: cross-cutting`, `hitl_tier: 2`, `status: active`.

### 11.6 Skills

Three new skills under a **new `skills/testing/` category** (separate from `design/` because these are operational, not advisory). Seeded into `SkillDefinition` with v1 `SkillRevision` per the governed skill lifecycle (PR #634/#638).

#### 11.6.1 `skills/testing/generate-ux-test-plan.skill.md`

**Inputs:** A `FeatureBuild` brief (or a free-form `evaluate-page`-style invocation), plus optional `UxFinding[]` from a prior AGT-903/906 audit.
**Output:** An array of browser-use-compatible natural-language test cases, each tagged with the lens it asserts and the expected pass condition.
**Invocation:** Called by the Build Studio review-phase orchestrator (§11.8) before `runBrowserUseTests`, and on-demand when AGT-906 finishes an audit that produced critical/important findings.

#### 11.6.2 `skills/testing/run-ux-regression-suite.skill.md`

**Inputs:** Optional route-prefix filter (default: all routes in `tests/ux/`).
**Output:** `UxTestStep[]` per test file, evidence receipts, and `BacklogItemActivity(kind="ux-regression")` rows for failures.
**Invocation:** Scheduled `dpf-ux-regression-weekly` task (§11.9), and ad-hoc via the universal skill surface.

Lens→assertion mapping rubric (also lives verbatim in the persona's Operating Rules):

| Lens | Assertion shape (browser-use natural language) |
|------|-----------------------------------------------|
| `hicks-law` | "Open `<route>`. Count visible primary-nav items. Pass if ≤ N." |
| `millers-law` | "Open `<route>`. Count items in `<container>`. Pass if ≤ 7." |
| `fitts-law` | "Open `<route>`. Locate the primary action. Measure its bounding-box size in px and distance-from-viewport-center. Pass if size ≥ 44×44 and distance ≤ V." |
| `doherty-threshold` | "Click `<link>`. Measure time from click to first-content-paint. Pass if ≤ 400ms OR a skeleton screen is visible within 100ms of click." |
| `jakobs-law` | "Open `<route>`. Verify primary-action color matches accent token (not red/destructive). Verify nav location matches platform convention." |
| `poka-yoke` | "Click `<destructive-action>`. Pass if a confirmation modal appears before the side effect runs." |
| `intent-preview` | "Find every element with `data-ai-action`. For each: click. Pass if NO `/api/agent/send` POST fires until a confirm button is pressed (the AgentWorkLauncher pattern)." |
| `confidence-signal` | "Find every element rendering AI-generated content. Pass if each has a visible confidence indicator or 'AI-generated' affordance." |
| `autonomy-dial` | "Open `<surface>` with an active coworker. Pass if Observe/Approve/Autonomous control is visible and persists across reload." |
| `explainable-rationale` | "Find every AI-actioned element. Pass if 'Why did I do this?' affordance is reachable within 2 interactions." |
| `object-oriented-ux` | "Open `<section>`. Count sibling tabs. Pass if ≤ 6." |
| `role-progressive-disclosure` | "Open `<route>` as role A and role B. Pass if rendered density (visible items, controls) differs." |
| `demo-driven-trap` | "Open `<surface>` with KPI/status chips. For each: click. Pass if drill-in shows evidence (not a dead chip)." |
| `density-vs-whitespace` | Route-class-dependent; e.g. `/portal` allows lower density, `/platform/*` allows higher. Skill carries the route-class severity table." |
| `reduced-motion` | "Set OS prefers-reduced-motion. Reload `<route>`. Pass if animations > 200ms are reduced or removed." |
| `plain-language` | "Extract visible body copy. Compute Flesch-Kincaid. Pass if ≥ 60 on non-developer routes." |
| `literal-copy` | "Extract visible labels. Pass if none match schema-leak patterns (`sourceSummary`, `localityModel`, raw enum values)." |

#### 11.6.3 `skills/testing/record-ux-test-evidence.skill.md`

**Inputs:** `UxTestStep[]` from a browser-use run.
**Output:** `ToolExecutionReceipt` rows linking back to screenshot URLs (existing `/api/build/<id>/evidence/<file>` route for build-anchored evidence; new `/api/regression/<runId>/evidence/<file>` route for corpus-anchored evidence — symmetric implementation).
**Invocation:** Always — every test run produces a receipt, never raw chat.

### 11.7 Test corpus location and file format

The regression corpus lives at `tests/ux/`, flat directory, one file per route:

```text
tests/ux/
  workspace.ux-test.md
  business.ux-test.md
  platform-ai-build-studio.ux-test.md
  customer-marketing.ux-test.md
  README.md           # explains the format, links to AGT-907 persona
```

Each file is a browser-use plan with frontmatter:

```markdown
---
route: /workspace
lenses: [hicks-law, doherty-threshold, intent-preview, object-oriented-ux]
agent_id: AGT-907
revision: 1
last_run_taskrun_id: null
---

# /workspace UX Regression

## Test 1 — Hick's Law: nav breadth (≤6 destinations)
Open /workspace as the test user. Count visible primary-nav items in the AppRail.
Pass if the count is ≤ 6.

## Test 2 — Doherty Threshold: route change feedback
Click each primary-nav link in sequence. For each transition, measure the time from
click to first-content-paint (or skeleton-screen visibility).
Pass if every transition either renders content within 400ms OR shows a skeleton
screen within 100ms of click.

## Test 3 — Intent Preview: AI-starting actions
Find every element with data-ai-action="true" on the page. For each: click once.
Pass if NO POST to /api/agent/send fires until a separate confirm button is
pressed (the AgentWorkLauncher pattern).
```

**Why markdown not Playwright .ts:** browser-use ingests natural-language test cases (its `browse_run_tests` tool literally takes `tests: string[]`). Markdown is the right authoring surface, and it is reviewable in PRs the same way specs are. If a downstream consumer ever needs Playwright .ts emission, AGT-907 can generate it from the same markdown source — but the markdown is the source of truth.

**v1 corpus authorship:** AGT-907 generates the markdown but **does not auto-commit it**. It writes a draft, opens a PR (using the existing `contribute_to_hive` style integration), and waits for human review. Auto-commit gets unlocked in v2 once the false-positive rate is known.

### 11.8 Invocation paths

1. **Build Studio Review phase — per-feature tests.** Today the Inngest handler `build/review.verify` (§11.2) reads only `brief.acceptanceCriteria`. The update: before `runBrowserUseTests`, dispatch AGT-907 via `AutonomousWorkRun` with the build's findings (`AGT-903 + AGT-906`'s most-recent audit of the affected routes) and the brief. AGT-907 produces an augmented `testCases` array. `runBrowserUseTests` then runs against the augmented array. `uxTestResults` carries the merged outcome.

2. **Scheduled regression run.** New `ScheduledAgentTask`:

   | Field | Value |
   |-------|-------|
   | `taskId` | `dpf-ux-regression-weekly` |
   | `agentId` | `AGT-907` |
   | `title` | `DPF UX Regression Suite` |
   | `routeContext` | `/platform/ai/operations` (run-view anchor) |
   | `schedule` | `0 14 * * 1` (Monday 14:00 UTC, after the §5.8 audit) |
   | `prompt` | "Run the full UX regression corpus under tests/ux/ against the live install. For each failure, file a BacklogItemActivity(kind='ux-regression') linked to the route. Group failures by lens; do not file one item per assertion." |

3. **Post-audit handoff.** When AGT-906's audit produces critical/important findings, the deliberation pair includes AGT-907 as a third participant for **test-generation only**: AGT-907 proposes regression test additions for the new findings, gated by PR review before they enter the corpus.

### 11.9 Gate update (additive to §5.6)

No new gate. The existing Review → Handover gate already reads `uxVerificationStatus`. AGT-907's contribution is **richer test cases inside the same flow**:

- If AGT-907 fails to generate any tests (silent), the gate falls back to today's behavior (run against `brief.acceptanceCriteria` only). This is a degraded mode, never a block — AGT-907 should never be able to block a ship by being unavailable.
- If AGT-907 generates tests and they fail in `runBrowserUseTests`, `uxVerificationStatus` becomes `failed` and the existing gate blocks ship. Same control path as today.

### 11.10 Data model

Per [autonomous-runtime §6.1](./2026-05-11-autonomous-coworker-runtime-design.md) — reuse before adding:

- **Test corpus:** git files at `tests/ux/`, not DB. PR-reviewable. Schema is the markdown frontmatter.
- **Per-build test results:** `FeatureBuild.uxTestResults` (existing). No new field.
- **Regression-run results:** new `BacklogItemActivity(kind="ux-regression")` rows. Activity payload: `{ routeContext, runTaskRunId, lens, failingAssertion, screenshotReceiptId }`. No new table.
- **Evidence receipts:** `ToolExecutionReceipt` (existing). Each browser-use run produces one receipt.
- **TaskRun identity:** every AGT-907 run lands as a `TaskRun` via `AutonomousWorkRun`. `a2aMetadata.trigger ∈ { "scheduled" | "build" | "interactive" }`, `a2aMetadata.sourceRef: { kind: "ux-regression" | "ux-test-gen", id: routeContext | buildId }`.

### 11.11 Files affected (additive to §7)

- Modify: [packages/db/data/agent_registry.json](../../../packages/db/data/agent_registry.json) — add AGT-907 entry.
- Create: `prompts/specialist/ux-test-automator.prompt.md` — persona per §11.5.
- Create: `skills/testing/generate-ux-test-plan.skill.md`, `skills/testing/run-ux-regression-suite.skill.md`, `skills/testing/record-ux-test-evidence.skill.md` — three skills per §11.6, each seeded with v1 `SkillRevision`.
- Create: `tests/ux/` directory + `tests/ux/README.md` + first exemplar `tests/ux/workspace.ux-test.md`.
- Modify: [apps/web/lib/queue/functions/build-review-verification.ts](../../../apps/web/lib/queue/functions/build-review-verification.ts) — dispatch AGT-907 to augment `testCases` before `runBrowserUseTests`. Degrade gracefully if AGT-907 unavailable.
- Modify: scheduled-task seed — add `dpf-ux-regression-weekly`.
- Modify: tool grants — add `file_write_test_corpus` and `browser_use` to `TOOL_TO_GRANTS` in `apps/web/lib/agent-grants.ts` and the `PERMISSIONS` table.
- Create: `app/api/regression/[runId]/evidence/[file]/route.ts` — auth-gated evidence serving for corpus-anchored screenshots (symmetric with the existing `/api/build/[id]/evidence/[file]/route.ts`).
- Modify: [docs/platform-usability-standards.md](../../platform-usability-standards.md) — add a "UX Regression Corpus" section pointing at `tests/ux/` and AGT-907.

### 11.12 Testing the tester

A coworker that authors tests must itself be tested. Strategy:

- **Unit:** lens→assertion mapping (§11.6.2) is exhaustively covered — each lens has a synthetic input that produces the expected browser-use natural-language output.
- **Integration:** generate tests against a fixture build with known findings; assert the output includes the right lens coverage.
- **Smoke:** the `dpf-ux-regression-weekly` task runs once after merge against `/workspace` and produces at least one passing and one failing test (the seed `workspace.ux-test.md` is engineered to have a known passing assertion and a known failing one to prove the pipeline works end-to-end). After the first run, the failing assertion gets a corresponding backlog item.
- **Persona audit:** the 2026-04-27 audit script must pass for AGT-907 (PERSONA-001..010).
- **Skill governance:** all three skills carry valid v1 `SkillRevision` rows and pass the skill curator's lifecycle check (PR #634/#638).

### 11.13 Open decisions (new, additive to §10)

- **Q10. When does an audit finding become a regression test?** Recommendation: automatically queued as a draft PR by AGT-907 for findings of severity `critical`. `important` and `minor` findings stay as backlog items only until promoted. This prevents corpus bloat from minor findings while still closing the loop for the things that matter.
- **Q11. How does AGT-907 coexist with AGT-BUILD-QA?** Recommendation: peer coworkers with disjoint scope. AGT-BUILD-QA owns typecheck + functional/unit tests; AGT-907 owns UX tests. Both report to HR-200. Build Studio review-phase invokes both in parallel; their results merge into `uxTestResults` (UX tests) and existing test-result fields (functional). Update AGT-BUILD-QA's `# Interfaces With` section to name AGT-907 as a UX-test peer (defer to persona-audit backfill, not v1 of this spec).
- **Q12. Should the corpus be machine-generated or PR-reviewed?** Recommendation: PR-reviewed for v1. Auto-commit gated on six months of low false-positive evidence (defined as <5% of generated tests being rolled back within 30 days).
- **Q13. Should AGT-907 also generate Playwright .ts files for engineering visibility?** Recommendation: no in v1 — markdown is the source of truth and browser-use is the executor. If a downstream consumer (e.g., CI parallelization tooling) ever needs .ts emission, that becomes a separate generator that reads the markdown corpus. Two surfaces, one source of truth.

### 11.14 Demo Story (extends §9)

Mark's `/workspace` audit (§9) produced three critical findings: Hick's Law violation (8 nav items), Doherty Threshold violation (800ms route change), Object-Oriented UX violation (14 Compliance tabs).

The deliberation pair completes. AGT-907 picks up the critical findings via the post-audit handoff (§11.8.3) and proposes three regression-test additions:

```markdown
# tests/ux/workspace.ux-test.md (proposed addition)

## Test — Hick's Law: AppRail destination count
Open /workspace. Count primary-nav items rendered by AppRail.
Pass if count ≤ 6 (per 2026-04-17 portal-nav-consolidation §6.2).

## Test — Doherty Threshold: route-change feedback
Click /platform. Measure click→first-content-paint.
Pass if ≤ 400ms OR skeleton-screen visible within 100ms of click.

## Test — Object-Oriented UX: Compliance tab count
Open /compliance. Count sibling tabs in ComplianceTabNav.
Pass if ≤ 6 (per 2026-04-17 portal-nav-consolidation §7.2).
```

AGT-907 opens a PR adding these tests to the corpus. Mark reviews and approves.

Next Monday at 14:00 UTC, `dpf-ux-regression-weekly` runs. All three tests **fail** against the current shell (which is exactly the state Mark's complaint described). The failures become `BacklogItemActivity(kind="ux-regression")` rows linked back to the portal-nav-consolidation spec.

Mark now has three durable, executing-every-week regression tests that will keep firing until the nav redesign actually ships. Once the redesign lands, the same tests pass — and the regression suite then protects against future regressions silently sliding the count back up.

---

## 12. Acceptance Criteria

- [ ] AGT-906 entry added to `agent_registry.json`. The 2026-04-27 persona audit passes for AGT-906 (PERSONA-001 through -010).
- [ ] `prompts/specialist/ux-design-critic.prompt.md` exists with all six required body sections and matching frontmatter.
- [ ] Three new skill files (`heuristic-ux-laws`, `agentic-ai-ux`, `enterprise-density`) exist, seed into `SkillDefinition`, are assigned to AGT-906.
- [ ] `apps/web/lib/tak/page-evaluator.ts` `UxFinding` type extended **additively** with optional `lens`, `agentId`, `routeContext`, `risk`, `evidenceRef`; `category` and `severity` enums unchanged; existing axe-core call sites compile without change; existing categorization stamps `agentId: "AGT-903"` and the right `wcag-*` lens alongside `category`.
- [ ] `build/review.verify` Inngest handler dispatches AGT-903 + AGT-906 as a deliberation pair via `AutonomousWorkRun`; Reviewer-panel renders both verdicts; Deliberation card renders on disagreement.
- [ ] Review → Handover gate (§5.6) blocks ship when either coworker returns `fail` and opens a Deliberation card on `concerns`. Gate decision is one of `ship | ship-with-followups | open-deliberation | block`.
- [ ] User-invoked `evaluate-page` on any route returns merged findings from both coworkers in the standard `⚠️/Observation/Risk/Fix` shape, with evidence references.
- [ ] `ScheduledAgentTask` `dpf-shell-ux-audit-weekly` exists, runs at least once after merge, and files at least one backlog item against the current portal shell with a link back to the 2026-04-17 portal-nav-consolidation spec.
- [ ] `docs/platform-usability-standards.md` updated with three new sections (Heuristic Lenses, Agentic AI UX Lenses, Enterprise Density Lenses), each linking back to this spec.
- [ ] No new DB tables introduced; all artifacts ride existing `TaskArtifact`, `BacklogItemActivity`, `ToolExecution`, `ToolExecutionReceipt`, `DeliberationPattern`/`DeliberationRoleProfile`/`DeliberationRun`.

### 12.A Additional acceptance — UX Test Automator (AGT-907)

- [ ] AGT-907 entry added to `agent_registry.json`. The 2026-04-27 persona audit passes for AGT-907 (PERSONA-001..010).
- [ ] `prompts/specialist/ux-test-automator.prompt.md` exists with all six required body sections and matching frontmatter.
- [ ] Three new skill files (`testing/generate-ux-test-plan`, `testing/run-ux-regression-suite`, `testing/record-ux-test-evidence`) exist, seed into `SkillDefinition` with v1 `SkillRevision`, assigned to AGT-907, and pass the skill curator's lifecycle check.
- [ ] `tests/ux/` directory exists with a `README.md` and at least one exemplar (`workspace.ux-test.md`) carrying the frontmatter schema from §11.7.
- [ ] `build/review.verify` Inngest handler dispatches AGT-907 to augment `testCases` before `runBrowserUseTests`. Degradation path proven: when AGT-907 is unavailable or empty-returns, the handler still runs with `brief.acceptanceCriteria` alone (no block on AGT-907 outage).
- [ ] `ScheduledAgentTask dpf-ux-regression-weekly` exists, runs at least once after merge, and either passes against the current shell or files at least one `BacklogItemActivity(kind="ux-regression")` row linked to a route.
- [ ] `file_write_test_corpus` and `browser_use` grant categories added to `TOOL_TO_GRANTS` and `PERMISSIONS` with appropriate role mapping; AGT-907's grants are strictly scoped (no general `file_write`).
- [ ] `/api/regression/[runId]/evidence/[file]/route.ts` exists, is auth-gated symmetrically to the existing `/api/build/[id]/evidence/[file]/route.ts`.
- [ ] First post-audit handoff produces a draft PR adding regression tests for AGT-906's critical findings; PR is human-reviewable; auto-commit is disabled in v1.
- [ ] AGT-BUILD-QA's `# Interfaces With` section names AGT-907 as a UX-test peer (tracked under persona-audit backfill, not a v1 deliverable here but called out as follow-up).

## 13. Recommended Next Step

With this spec approved and committed (per Mark's standing process: approved spec → commit to `main` → feed to `writing-plans`), the implementation plan should slice as follows:

1. **Slice 1 — Persona, registry, skills.** AGT-906 entry (slot AGT-906, NOT AGT-904 — collision with documentation-specialist), persona file at `prompts/specialist/ux-design-critic.prompt.md` with frontmatter matching AGT-903's shape, three skill files seeded into `SkillDefinition` + a v1 `SkillRevision` each via the governed-skill-lifecycle path. Persona audit passes (PERSONA-001..010). No runtime behavior change yet. *(One PR; governance-bounded; safe to land without affecting any existing flow.)*
2. **Slice 2 — Finding shape + page-evaluator extension.** Extend `UxFinding` **additively** with optional `lens`, `agentId`, `routeContext`, `risk`, `evidenceRef`. Keep `category` and `severity` enums exactly as shipped. Existing axe-core path stamps `agentId: "AGT-903"` and the matching `wcag-*` lens alongside today's `category`. *(One PR; type-only + categorization update; zero-breaking-change for in-flight reviewers.)*
3. **Slice 3 — Deliberation-pair wiring inside `build/review.verify`.** Wrap the current `browser-use` UX-test path in an `AutonomousWorkRun` that dispatches a `DeliberationRun` against the `ux-audit-pair` pattern (roles: AGT-903, AGT-906). Persist the merged `UxAuditReport` as a `TaskArtifact`. Apply the §5.6 gate decision via `checkPhaseGate`. Preserve the legacy-fallback path that gates on AGT-903 alone for in-flight builds. *(One PR; runtime change; covered by integration tests against a deliberately-bad sandbox feature.)*
4. **Slice 4 — Reviewer-panel rendering.** Build Studio Reviewer-panel card shows both verdicts; Deliberation card appears on disagreement. *(One PR; UI change in Build Studio; depends on Slice 3.)*
5. **Slice 5 — Universal skill update + scheduled audit.** Switch `evaluate-page` to dispatch the pair via `AutonomousWorkRun`. Seed `dpf-shell-ux-audit-weekly` `ScheduledAgentTask`. Watch first-run output and file the resulting backlog. *(One PR; closes the loop on the spec's primary mission.)*

The slice ordering is intentionally safe-to-land-incrementally: Slices 1–2 are inert (no runtime behavior change), Slice 3 carries the legacy-fallback that protects in-flight builds, Slice 4 adds UI on top of an already-working backend, and Slice 5 is the dogfooding payoff.

**Slices 6–9 — UX Test Automator (AGT-907):** These can land in parallel with Slices 4–5 because they touch a different seam (build-review-verification.ts and the new `tests/ux/` corpus) and a different coworker.

6. **Slice 6 — AGT-907 persona, registry, skills, grants.** AGT-907 entry, persona file at `prompts/specialist/ux-test-automator.prompt.md`, three skill files under `skills/testing/` seeded with v1 `SkillRevision`. Add `file_write_test_corpus` and `browser_use` grant categories to `TOOL_TO_GRANTS` + `PERMISSIONS`. Persona audit passes. *(One PR; inert until Slice 7 wires the dispatch.)*
7. **Slice 7 — Build-review-verification integration with degradation.** In [build-review-verification.ts](../../../apps/web/lib/queue/functions/build-review-verification.ts), dispatch AGT-907 via `AutonomousWorkRun` to augment `testCases` before `runBrowserUseTests`. Catch any dispatch error and proceed with `brief.acceptanceCriteria` alone — AGT-907 is never allowed to block ship by being unavailable. Persist evidence as `ToolExecutionReceipt`. *(One PR; runtime change; integration tests with a fixture brief + fixture finding set.)*
8. **Slice 8 — Test corpus + regression suite + evidence route.** Create `tests/ux/` with `README.md` + first exemplar `workspace.ux-test.md` (engineered with one known-passing and one known-failing assertion to prove the pipeline). Implement `/api/regression/[runId]/evidence/[file]/route.ts` symmetric to the build-evidence route. Seed `dpf-ux-regression-weekly` `ScheduledAgentTask`. *(One PR; lands the operational substrate; first scheduled run produces evidence.)*
9. **Slice 9 — Post-audit handoff.** Wire the AGT-906 → AGT-907 handoff so AGT-906's critical findings trigger AGT-907 to draft a PR adding regression tests. PR review remains human-gated for v1 (per Q12). *(One PR; closes the audit→test loop; depends on Slices 5 + 8.)*

The §11.14 demo story is the integration acceptance for Slices 6–9 together: an audit finds violations, AGT-907 turns the critical ones into draft regression tests, the corpus runs weekly, and a regression two months later (when someone adds a tenth nav item) is caught and filed automatically.

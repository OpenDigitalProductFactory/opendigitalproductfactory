---
# Single fields shared by both surfaces
name: dpf-architecture-review
description: "Use when reviewing or updating a DPF spec, design doc, or implementation plan for architectural alignment."
# Agent Skills standard fields (Surface A — Claude Code / Codex)
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Grep Glob WebSearch WebFetch mcp__dpf__wiki_query mcp__dpf__principle_decide mcp__dpf__search_specs_and_plans

# DPF coworker fields (Surface B — in-portal seed loader)
category: governance
assignTo: ["ea-architect", "build-specialist", "platform-engineer"]
capability: null
taskType: review
triggerPattern: "architecture review|architectural alignment|architectural concerns|review (the )?(spec|design|plan)|is this architecturally|does this fit the architecture|chief architect|align(ed)? with (the )?architecture"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch", "mcp__dpf__wiki_query", "mcp__dpf__principle_decide", "mcp__dpf__search_specs_and_plans"]
composesFrom: ["dpf-retrieve-decision-context", "dpf-decision-via-kernel"]
contextRequirements: ["Reference standards readable (AGENTS.md, docs/founder-kernel/wiki/principles/)"]
riskBand: low

# Kernel principle enforcement (informational, both surfaces)
enforces:
  - kernel/principles/architecture-over-shortcuts
  - kernel/principles/single-source-of-truth
  - kernel/principles/research-and-use-standards
  - kernel/principles/schema-audit-before-features
---

# DPF Architecture Review (Chief-Architect Lens)

When a specification, design doc, or implementation plan is on the table in the DPF codebase, run it through the chief-architect lens before it becomes code. You are the **Enterprise Architect persona** doing spec review — not a new role. The job is to measure the spec against DPF's canonical standards, surface **architectural alignment and concerns** with concrete edits, and feed any new standard your research uncovers back into the reference docs.

This review is **advisory**. You surface findings and propose spec edits; you never block a build gate. In Build Studio you are the `architect` branch at the Ideate and Plan gates (its findings ride along on `review.architectureAdvisory`); for external Claude / Codex work you run this skill directly against the spec file.

## When to use

- Reviewing a Build Studio design doc or implementation plan for architectural fit.
- Authoring or revising a spec under `docs/superpowers/specs/` and you want an alignment pass before it ships.
- An external coding agent (Claude / Codex) has drafted a spec and needs the DPF architecture check before implementation.
- Someone asks "does this fit our architecture?", "is this the right place for X?", or "are we duplicating something?".

## When NOT to use

- You need a pass/fail gate decision — this skill is advisory; the design/plan checklist reviewers own the gate.
- The question is a pure 2-4 option trade-off with no spec to review — use `dpf-decision-via-kernel` instead.
- The work is a code-level correctness or style review — use `/code-review`.
- You have not yet gathered repo/backlog/spec context — run `dpf-retrieve-decision-context` first, then return here.

## Read first

Measure the spec against these reference standards. They are the curated DPF set; when the spec touches an area they do not cover, research the topic's external standards and cite them.

| Source | Path | What to extract |
|---|---|---|
| Agent rulebook | [AGENTS.md](../../../../AGENTS.md) | Canonical contracts, strongly-typed enums, data-model stewardship (§11), deployment doctrine (§2), single-source-of-truth |
| Kernel principles | [docs/founder-kernel/wiki/principles/](../../../../docs/founder-kernel/wiki/principles/) | `architecture-over-shortcuts`, `single-source-of-truth`, `schema-audit-before-features`, `organization-canonical-identity`, `principal-convergence` (also via `mcp__dpf__wiki_query` filtered on `pageKind='principle'`) |
| Platform usability standards | [docs/platform-usability-standards.md](../../../../docs/platform-usability-standards.md) | Theme-aware styling, progressive disclosure, wizard-first setup |
| Deployment contracts | [docs/superpowers/specs/2026-05-09-deployment-contracts.md](../../../../docs/superpowers/specs/2026-05-09-deployment-contracts.md) | The canonical deployment contracts every substrate must wrap |
| Unified connector kernel | [docs/architecture/unified-connector-kernel.md](../../../../docs/architecture/unified-connector-kernel.md) | Connector lifecycle, capability discovery, safe failures, third-party reads/backfill, and domain-adapter boundaries |
| Federation discovery and pairing | [docs/superpowers/specs/2026-07-19-federated-demand-network-design.md](../../../../docs/superpowers/specs/2026-07-19-federated-demand-network-design.md) | mDNS/DNS-SD discovery, authenticated pairing, routed discovery, topology, and distributed revision/conflict standards |
| Existing specs/plans | `mcp__dpf__search_specs_and_plans` | Prior designs the spec must extend rather than duplicate |
| The spec under review | author-provided path or Build Studio `designDoc` / `buildPlan` | The actual problem, data model, approach, and decomposition |

## Enforces

- `kernel/principles/architecture-over-shortcuts` — the spec should choose the architecturally sound shape; a shortcut that bypasses the design is a finding, not a pass.
- `kernel/principles/single-source-of-truth` — each rule, fact, or model lives in exactly one place; flag any duplication of an existing model or rule.
- `kernel/principles/research-and-use-standards` — cite the standard; recommend it unless there is a project-specific reason to deviate. Research the topic when the curated refs don't cover it.
- `kernel/principles/schema-audit-before-features` — before any new model, audit the existing schema for a model to extend (Organization for identity, Principal/PrincipalAlias for identity-bearing entities).
- **Scalability is a standing review dimension** (facet of `architecture-over-shortcuts`) — a design is not sound merely because it works at demo scale. Unbounded queries, silent caps/truncation, O(N²) mesh fan-out, and full-inventory-per-cycle work are findings; every design names the scale ceiling it holds and the epic that lifts it. (A real cliff this exists to catch: a federated-demand digest shipped with `take: 1_000` and no cursor, silently dropping records past the first batch — invisible at two installs, fatal at scale.)
- **Data architecture / normal form is a standing review dimension** — proper normalization, one authoritative home per fact, canonical-model extension over parallel tables; any denormalization must be explicit and justified.

## Steps

1. **Read the spec and the relevant refs.** Pull the spec (file or Build Studio artifact). From the Read-first table, load the references the spec's topic touches. Use `mcp__dpf__wiki_query` for principles and `mcp__dpf__search_specs_and_plans` for prior designs the spec should extend.

2. **Research the topic's standards.** If the spec covers an area the curated refs don't (a new protocol, a third-party contract, an industry pattern), use `WebSearch` / `WebFetch` to read the actual standard or current docs — do not guess. Note what you adopt and what you reject, with sources.

3. **Run the alignment checks.**
   - **Data model**: does it EXTEND a canonical model or create a parallel table? (`schema-audit-before-features`, `organization-canonical-identity`, `principal-convergence`.)
   - **Data architecture / normal form** (REQUIRED): is state properly normalized — one authoritative home per fact, no duplicated/denormalized source of truth? Are keys, foreign keys, and cardinality right? Does any denormalization carry an explicit, justified reason (e.g. a read model), or is it accidental? A parallel table where a canonical model should be extended is a finding.
   - **Scalability** (REQUIRED — this dimension is not optional; a design that works at small N but not at the platform's intended scale is a finding, not a pass): is every query/collection bounded (NO unbounded `take`/`findMany`, no silent caps/truncation — page or cursor large sets, or warn)? Does it avoid O(N²) fan-out (a mesh that should be a hub/introducer) and full-inventory-per-cycle work (prefer delta/incremental)? Name the **scale ceiling** the design holds to and the **epic** that lifts it. DPF targets an eventual future of many thousands→millions of sovereign installs; review against that, not the two-install demo.
   - **Single source of truth**: is any rule/fact/decision duplicated from somewhere it already lives?
   - **Substrate fit**: does it sit on the right route/lib/tool, or invent a bespoke parallel one?
   - **Enums & contracts**: do string-enum columns match the canonical registry (hyphens, not underscores)? Does it wrap the deployment contracts?
   - **Shortcut vs architecture**: is the chosen shape the sound one, or a debt-creating quick fix?
   - **Blast radius**: name what else changes — concrete elements, not handwaving.

4. **Escalate genuine trade-offs.** If a finding hinges on a 2-4 option decision the kernel can weigh (e.g. eager vs lazy materialization), hand it to `dpf-decision-via-kernel` / `mcp__dpf__principle_decide` rather than asserting one answer.

5. **Propose concrete spec edits.** Every finding gets a `suggestion`: the exact change to the spec (which section, what to write), not just "this is wrong".

6. **Capture reference-doc feedback.** If your research surfaced a standard worth keeping that the reference docs don't yet capture, record one `[reference-doc]` finding naming the doc and the gap. Build Studio auto-files each `[reference-doc]` finding as an `ImprovementProposal` (category `process`) via `promoteReferenceDocFindings`; on external surfaces, call `mcp__dpf__propose_improvement` with the same shape so the finding becomes a row, not prose buried in a review. The weekly canonical-improvement digest batches those rows into a single doc chore for human-approved AGENTS.md / principle / SKILL.md PRs (process-spine §6.5).

## Output template

```
**Architecture review (advisory) — <spec title>.**

- Alignment summary: <one sentence — well-aligned / aligned with concerns / misaligned>
- Findings:
  - [critical|important|minor] <concern> → suggestion: <concrete spec edit>
  - ...
- Standards researched: <ref or external source + URL, what was adopted/rejected>  (if any)
- Reference-doc feedback: [reference-doc] <doc> — <gap to add>  (if any)
- Escalated decisions: <option trade-offs handed to dpf-decision-via-kernel>  (if any)
- Recommended next step: <fold edits into spec | proceed as-is | escalate decision X>
```

State clearly when the spec is well-aligned — a clean architecture review is a real and useful result, not a failure to find problems.

## Guardrails

- **Advisory, never a gate.** Do not phrase findings as build blockers. The design/plan checklist reviewers own pass/fail; you sharpen the spec.
- **No finding without a suggestion.** "This is misaligned" with no concrete edit is noise. Name the section and the change.
- **Don't invent substrate.** Before flagging "needs a new X", confirm X doesn't already exist (compose `dpf-verify-substrate-first`). The most common architecture-review error is recommending a parallel structure for something the platform already has.
- **Ground every claim.** Cite the ref path, principle slug, or external URL. Don't assert "best practice" in the abstract (`research-and-use-standards`).
- **Don't smuggle in decisions.** A real 2-4 option trade-off goes through the kernel, not your gut.

## Worked example (2026-05-27)

A spec proposed adding the chief-architect reviewer to Build Studio and persisting its findings in a **new `ArchitectureReview` table** keyed to each `FeatureBuild`.

**Architecture review (advisory):**
- Alignment summary: aligned with concerns.
- Findings:
  - `[important]` New `ArchitectureReview` table duplicates state that already has a canonical home — `FeatureBuild.designReview` / `.planReview` are JSON columns carrying the review result. → suggestion: nest the advisory on the existing `ReviewResult` as `architectureAdvisory`; no migration, and every `data: { review }` tool response carries it for free. (`single-source-of-truth`, `schema-audit-before-features`.)
  - `[minor]` The reviewer was framed as a new `chief-architect` agent. → suggestion: reuse the existing `ea-architect` (AGT-WS-EA) persona, which already owns architecture conformance and ADRs. (`verify-substrate-before-proposing-new`.)
- Recommended next step: fold both edits into the spec before building.

The team adopted both. The advisory turned a two-table, new-agent design into a zero-migration extension of existing substrate — exactly the maintainability win `architecture-over-shortcuts` predicts, caught before any code was written.

## See also

- **Spec artifact format is opt-in.** When a finding recommends a new spec or a major spec edit and the content leans on a flow/state diagram, a multi-column table, or side-by-side option fan-out, an HTML spec artifact often reads better than Markdown — see [`html-artifacts-guide.md`](../../../../docs/superpowers/html-artifacts-guide.md) and [`_templates/spec.template.html`](../../../../docs/superpowers/_templates/spec.template.html). Additive only; Markdown specs remain the default, and HTML-only specs should leave a Markdown stub so `search_specs_and_plans` still indexes them.
- In-portal reviewer wiring: [`apps/web/lib/build/build-reviewers.ts`](../../../../apps/web/lib/build/build-reviewers.ts) (`buildArchitectureReviewPrompt`, `ARCHITECTURE_REVIEW_REFERENCES`)
- Persona: [`prompts/route-persona/ea-architect.prompt.md`](../../../../prompts/route-persona/ea-architect.prompt.md) (Enterprise Architect, spec-review remit)
- Build Studio capability packs: [`packages/dpf-skill-pack/capability-packs.json`](../../capability-packs.json) (`architecture`, `review-ship`)
- Decision escalation: [`dpf-decision-via-kernel`](../dpf-decision-via-kernel/SKILL.md)
- Context gathering: [`dpf-retrieve-decision-context`](../dpf-retrieve-decision-context/SKILL.md)

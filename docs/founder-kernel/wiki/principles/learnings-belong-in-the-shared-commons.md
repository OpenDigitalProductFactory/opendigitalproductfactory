---
title: Learnings belong in the shared commons
slug: learnings-belong-in-the-shared-commons
pageKind: principle
status: published
abstract: A learning confirmed by any agent — Claude, Codex, a Build Studio coworker, or the local model — is a team asset. Route every durable learning to the shared commons (WWMD principle / WWWD org fact / WSID technique / code+AGENTS.md) and contribute it to the hive. Local, client-only storage is reserved for genuinely install-specific config; local-only knowledge is a defect.
principleTier: core
principleDirection: Route every durable learning to the shared commons (WWMD / WWWD / WSID / code+AGENTS.md) and contribute it to the hive; reserve local, client-only storage for install-specific config — local-only knowledge is a defect.
principleDimensionVector: {"reusability": 1.0, "long_term_maintainability": 0.9, "schema_grounding": 0.6, "evidence_density": 0.5, "operational_independence": 0.4, "human_cognitive_load": -0.5, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters need to know that DPF treats a learning confirmed by any agent as shared infrastructure — captured once, surfaced to every agent and every install through governed review — rather than a private note trapped in one client. Knowing this is how the platform "gets robust on its own" is a reason to adopt it.
authoredAt: 2026-06-16
authoredBy: mark-bodman
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

# Learnings belong in the shared commons

A learning confirmed by **any** agent — Claude, Codex, a Build Studio coworker, or the local model — is a **team asset**, not the property of the client that happened to discover it. The default destination for a durable learning is the **shared commons**: the founder kernel (WWMD), the organization's platform knowledge (WWWD), the profession corpus (WSID), or the repository and `AGENTS.md` (code contracts). From there it is surfaced server-side to every agent on the install and contributed to the hive so other installs inherit it.

Storing a learning where only one client can use it is a **defect**, in the same way that running two systems of record over the same data is a defect (`[[principles/one-data-model]]`) and delegating a capability to a separate product is a defect (`[[principles/native-cohesion-over-interfacing]]`). This is the knowledge-layer sibling of those two principles: the commons is the one place a fact, rule, or technique lives, and everything else points at it (`[[principles/single-source-of-truth]]`).

## Rule

When a finding is confirmed and durable, route it to the shared commons and contribute it to the hive. Reserve local, client-only memory (a Claude Code `~/.claude` memory file, a Codex note, an undocumented runtime tweak) for genuinely **install-specific configuration** — secrets, host paths, this machine's GPU count. Everything else is shared knowledge and must leave the client through a governed channel.

## Why

The platform's promise is that it "gets robust on its own": a problem solved once should never have to be solved again, by anyone. That only holds if knowledge **propagates**. When a learning lands in one client's local memory:

- **It is selfish by construction.** The next agent — a different client, a Build Studio coworker, the local model, or the same client after a reinstall wipes its cache — re-derives the same finding from scratch, or worse, repeats the mistake the learning would have prevented.
- **It cannot be reviewed, versioned, or trusted.** A local note carries no provenance, no evidence link, no review gate. The commons does: WWMD principles are PR-ratified, WWWD pages go draft → review → publish, WSID techniques seed as governed skills. Governance approves on **evidence, not provenance** (`[[principles/governance-approves-evidence-not-provenance]]`), so a finding from the local model is as promotable as one from Claude.
- **It cannot cross the install boundary.** The hive (`contribute_to_hive` → upstream PR → `run_hive_scout_ingest`) is the only path by which a learning on one install becomes inherited knowledge on the next. A local file never reaches it.

Local memory is therefore at most a **staging/origin record** — where a finding is first noted before it is routed — never the resting place for durable knowledge.

## Applies To

In-platform coworkers, external coding agents (Claude Code, Codex CLI, Grok), and human operators — symmetric across all three because the commons is queried server-side by all of them. The boundary is between **durable shared knowledge** (a decision rule, an org/platform fact, a role technique, a code contract) and **install-specific config** (this install's secrets, paths, hardware). The former must be routed to the commons; the latter legitimately stays local.

## How To Apply

At any task or session boundary, for each confirmed finding, **classify then route** — the `dpf-route-learning-to-commons` skill operationalizes this and is the path of least resistance:

| If the learning is a… | Route it to (WWxD) | Via |
|---|---|---|
| Decision rule / durable judgment ("when X, prefer Y") | **WWMD** — founder kernel principle | PR a kernel principle page, or `dpf-capture-kernel-gap` when the kernel can't yet answer |
| Durable org / platform fact ("X is true about this platform") | **WWWD** — platform knowledge | `propose_improvement` / a `WikiPage` overlay draft → publish, or `doc_save` |
| Role / profession technique ("how a dispatcher does Z") | **WSID** — profession corpus | `propose_skill_improvement`, or author a `SKILL.md` |
| Code contract / invariant | **repo + AGENTS.md** | file a BI and PR the code + doc together |

Then **contribute it to the hive** (`contribute_to_hive`, or `escalate_feedback_upstream` for feedback) so other installs inherit it. Do not invent a parallel store; reuse the governed tools above. If a finding is genuinely install-specific config, say so explicitly and leave it local — that is the one correct local outcome.

## Decision Dimensions

- `reusability: 1.0` — the entire point. A learning in the commons serves every agent and every install; in local memory it serves one. Maximum weight.
- `long_term_maintainability: 0.9` — knowledge that propagates compounds; knowledge that silos decays and is re-derived. Second only to reusability.
- `schema_grounding: 0.6` — the commons has canonical homes (WikiPage, kernel, SkillDefinition) that can be linted, versioned, and queried; a local note cannot.
- `evidence_density: 0.5` — the governed channels attach provenance and an evidence-reviewed gate; local memory attaches neither.
- `operational_independence: 0.4` — a robust shared corpus lets the local model and offline installs act on accumulated knowledge without a frontier round-trip.
- `human_cognitive_load: -0.5` — sharing removes the re-derivation tax: no operator or agent has to rediscover what another already confirmed.
- `speed_to_value: -0.3` — routing through a governed channel costs a little more up front than scribbling a local note; the principle accepts that cost, exactly as `[[principles/native-cohesion-over-interfacing]]` accepts a slower native build.

## Examples

- **Positive:** The local model confirms that single-GPU local inference must be serialized to avoid build timeouts. The agent routes it as a WWWD platform fact (a `WikiPage` overlay draft / `propose_improvement`), links the evidence, and contributes it to the hive. The next Build Studio build on this install — and on every other install after ingest — reads the constraint instead of timing out again.
- **Positive:** Claude confirms the rule "check tool return values before blaming the model." It is a decision rule, so it routes to **WWMD** as a kernel principle (here, `[[principles/check-tool-signals-first]]`), retrievable by `principle_decide` for every agent.
- **Counterexample:** An agent learns the DPF portal-driving technique (real keystrokes for React inputs, verify mutations via DB not the UI) and writes it only into its client-local memory file. The Codex CLI session next week, and the Build Studio coworker, and every other install, never see it — they rediscover the same friction. The correct route was a **WSID** technique / `SKILL.md`, contributed to the hive.

## When this does not apply

- **Install-specific configuration** — secrets, bearer tokens, host paths, this machine's GPU count, `COMPOSE_PROJECT_NAME`. These are correctly local and must never be contributed to the commons or the hive.
- **Situational, non-durable notes** — a single session's scratch state or a dated reminder belongs in execution evidence or backlog comments, not the principle layer (see `[[principles/selective-memory-not-total-recall]]`).

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)

## See also

- Data-layer sibling: `[[principles/one-data-model]]`
- Capability-layer sibling: `[[principles/native-cohesion-over-interfacing]]`
- Single canonical home: `[[principles/single-source-of-truth]]`
- Review gate that makes any-agent learnings promotable: `[[principles/governance-approves-evidence-not-provenance]]`
- What stays local instead: `[[principles/selective-memory-not-total-recall]]`
- Hive as the cross-install propagation plane: `[[principles/mcp-is-the-coordination-plane]]`

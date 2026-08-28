---
name: dpf-elicit-tacit-knowledge
description: "Use when durable DPF knowledge lives only in a human's head — a decision rationale, the why behind a choice, a profession technique, domain context a build depends on."
disable-model-invocation: false
user-invocable: true
allowed-tools: Grep Glob mcp__dpf__wiki_query mcp__dpf__search_knowledge mcp__dpf__search_code_graph mcp__dpf__doc_save mcp__dpf__save_build_notes
category: governance
assignTo: ["documentation-specialist", "doc-specialist", "platform-engineer", "external-coding-agent"]
capability: null
taskType: elicitation
triggerPattern: "interview me|grill me|pick my brain|debrief me|extract (what|everything) I know|capture my (knowledge|thinking)|brain ?dump|knowledge dump|get .* out of my head|it's all in my head|tacit knowledge|elicit|onboard .* (domain|business) (knowledge|context)|why did we (decide|choose)"
userInvocable: true
agentInvocable: true
allowedTools: ["Grep", "Glob", "mcp__dpf__wiki_query", "mcp__dpf__search_knowledge", "mcp__dpf__search_code_graph", "mcp__dpf__doc_save", "mcp__dpf__save_build_notes"]
composesFrom: ["dpf-route-learning-to-commons"]
contextRequirements: ["A human (founder / operator / SME) available to answer questions", "A topic or decision whose rationale is not yet in the system and cannot be found by research"]
riskBand: low
enforces:
  - kernel/principles/elicit-tacit-knowledge
  - kernel/principles/shape-knowledge-for-retrieval
  - kernel/principles/findability-is-part-of-capture
  - kernel/principles/selective-memory-not-total-recall
  - kernel/principles/do-the-work-dont-task-the-operator
  - kernel/principles/learnings-belong-in-the-shared-commons
---

# DPF Elicit Tacit Knowledge

Draw knowledge out of the person who holds it and into the system. The bottleneck in a knowledge platform is **acquisition** — getting tacit expertise out of a head — not retrieval. DPF already recalls well (wiki, semantic search, code graph, ontology graph); what it cannot do is recall a rationale, constraint, or technique nobody ever captured because nobody asked. This skill is the asking, done with discipline.

It is the **predecessor** to [`dpf-route-learning-to-commons`](../dpf-route-learning-to-commons/SKILL.md): this skill produces the captured knowledge; that one routes it to the right commons lane and the hive. It is a sibling of [`dpf-brainstorming`](../dpf-brainstorming/SKILL.md) — brainstorming generates *options the agent invents*; this elicits *knowledge the human already holds*.

## When to use

- A build, design, or decision depends on context that is genuinely in someone's head — operator rationale, a hard-won constraint, the real shape of a business process, why a past choice was made.
- Onboarding a new domain, profession, or customer where the tacit "how it actually works" isn't written anywhere.
- Growing a specific decision scope's source from the human who holds it: the founder kernel (WWMD), a freshly-installed organization's own "what would we do" (WWWD — usually still template-seeded and cold), or a trade's technique (WSID profession corpus). The scope that owns the knowledge is where it lands (`kernel/principles/decisions-belong-to-their-scope`).
- You catch yourself about to **guess** past a gap, or about to ship on an assumption you could close with a question.

## When NOT to use

- The answer is discoverable by research — in code, specs, the wiki, or the live DB. Find it yourself first (`do-the-work-dont-task-the-operator`); this skill governs only the gap research cannot close.
- The knowledge is ephemeral scratch state (today's build status, a one-off value). That is not worth eliciting or capturing (`selective-memory-not-total-recall`).
- You only need to choose between already-known options — go to `dpf-decision-via-kernel`.

## Enforces

- `kernel/principles/elicit-tacit-knowledge` — the principle this skill operationalizes: actively draw out tacit knowledge instead of waiting or guessing.
- `kernel/principles/shape-knowledge-for-retrieval` — decide the retrieval question before capturing, so the form fits the future query.
- `kernel/principles/findability-is-part-of-capture` — capture isn't done until the result can be found again.
- `kernel/principles/selective-memory-not-total-recall` — store the decision and rationale, not the interview transcript.
- `kernel/principles/do-the-work-dont-task-the-operator` — research first; spend the human's attention only on the genuinely-tacit gap.
- `kernel/principles/learnings-belong-in-the-shared-commons` — the captured knowledge ends in the commons, not a local note.

## Steps

1. **Frame the topic in one sentence** and confirm it is worth capturing: is this durable and evergreen (worth keeping in a year), or ephemeral (don't elicit it)? Name who holds the knowledge.

2. **Research before you ask.** Sweep what the system already knows so you ask only for the genuine gaps and never make the human re-tell captured facts:
   - `mcp__dpf__wiki_query` for kernel principles / prior stances on the topic.
   - `mcp__dpf__search_knowledge` and `mcp__dpf__search_code_graph` for platform facts and existing implementation.
   - `Grep` / `Glob` for specs, docs, and code that already encode part of the answer.
   Write down what you found, and the specific gaps that research could NOT close. Those gaps — and only those — are the interview.

3. **Decide the retrieval shape first** (`shape-knowledge-for-retrieval`). State the question a future agent will ask to retrieve this knowledge. That determines the capture form (whole-document vs. typed entry vs. corpus technique) and which commons lane it will land in — and therefore what you need to ask.

4. **Interview in rounds, over a decision tree.** Map the gaps as a tree: every decision branches into the decisions that hang off it. The **frontier** is every decision whose prerequisites are already settled — ask only those. Settling a frontier decision exposes the next one, so the tree is worked in rounds rather than read as a fixed list.

   Each round is a short **numbered list with candidate answers**:

   ```
   1. Who does the after-hours call reach first?
      A. The on-call tech directly
      B. A dispatcher who triages, then pages
      C. An answering service that only takes a message
   2. What overrides SLA tier?
      A. Nothing — tier is the order
      B. Life-safety, always
      C. Geography when the tech is already nearby
   ```

   The human answers `1B, 2B, 3-none of these` in seconds. Cheap answers get answered; a paragraph-per-question interview quietly does not happen, and an interview that does not happen captures nothing.

   Candidates must be **real competing positions**, not one obvious answer padded with strawmen — a candidate the human rejects teaches as much as one they pick, and "none of these" is the most informative reply on the list. Always leave it open. Keep a round to roughly 3-6 questions, and open the next round by drilling on anything answered "none of these" or accepted with a caveat.

   Stop when the frontier is empty, or when a round stops surfacing new knowledge — the well is dry, not when a quota is hit.

   This shape also survives a weak model. Composing six numbered questions with candidates is one bounded generation task; conducting an adaptive question-by-question interview is multi-turn planning, which is what low context retention breaks first. See the local-model priors in `packages/db/src/local-model-capabilities.ts`.

5. **Capture in the retrieval shape, not the transcript** (`selective-memory-not-total-recall`). Write the decisions, rationale, and constraints — dense and structured for the query you named in step 3 — via `mcp__dpf__doc_save` (managed knowledge) or `mcp__dpf__save_build_notes` (build-context capture). Tag it with the role, phase, and topic the future query will filter on.

6. **Prove it is findable** (`findability-is-part-of-capture`). Confirm the captured knowledge would surface for the retrieval question you named — right slug, right tags, reachable lane. If it would not, fix the routing before you call it captured.

7. **Hand off to the commons.** Invoke [`dpf-route-learning-to-commons`](../dpf-route-learning-to-commons/SKILL.md) to classify the captured knowledge (WWMD / WWWD / WSID / code), route it through the governed channel, and `contribute_to_hive` so every agent and every install inherits it. Elicited knowledge that stays local is only half-captured.

## Guardrails

- **Research is the price of admission.** If you ask the human something the system already knows, you have violated `do-the-work-dont-task-the-operator`. Ground every question in what you could not find.
- **Ask the frontier, not the tree.** A round holds only decisions whose prerequisites are settled. Questions that depend on an unanswered question get shallow answers, because the human is guessing at their own premise.
- **Candidates, never a bare questionnaire.** A wall of open questions gets abandoned or answered thinly. The same questions with real candidate answers get answered — and the rejections carry as much signal as the picks. Never omit "none of these".
- **Capture the judgment, not the chatter.** The output is decisions + rationale + constraints, not the raw Q&A. Re-derivable detail stays in its primary source.
- **Durable only.** Don't elicit or capture knowledge that will be stale next week — that is noise, not memory.
- **Bounded by the well, and by respect.** Stop when answers stop adding knowledge; never grind the operator past usefulness. Elicitation is sanctioned tasking of the operator *because the knowledge is genuinely impossible for the agent to get otherwise* — the moment it isn't, stop asking.
- **Don't leave it local.** Finish at the commons (step 7). A captured-but-unrouted learning is a defect (`learnings-belong-in-the-shared-commons`).

## Worked example

A coworker is about to build an after-hours dispatch flow. Research (step 2) finds the storefront archetype, the existing on-call schema, and a prior spec — but nothing on *how this operator actually triages calls*, which the build depends on. That is the gap. The coworker names the retrieval question (step 3): "How does a dispatcher triage after-hours calls for this archetype?" → a WSID profession technique, queried by the dispatcher corpus slug. It interviews (step 4): round one asks who the call reaches first and what overrides SLA tier, each with three candidate answers. The operator answers `1B, 2-none of these` in one line — and that rejection is the finding, because it says tier is not the top of the order. Round two drills exactly there and the real rule emerges: life-safety → contractual SLA tier → geography, which no code revealed. It captures the rule and its rationale, structured for that query (step 5), confirms a search for "after-hours escalation" surfaces it (step 6), and hands to `dpf-route-learning-to-commons`, which routes it to the profession corpus and contributes it to the hive (step 7). The next build on any install reads the operator's real triage logic instead of guessing it.

## See also

- Successor: [`dpf-route-learning-to-commons`](../dpf-route-learning-to-commons/SKILL.md) — routes the captured knowledge to the commons + hive.
- Sibling: [`dpf-brainstorming`](../dpf-brainstorming/SKILL.md) — generates invented options (vs. eliciting held knowledge).
- Composes with: [`dpf-verify-substrate-first`](../dpf-verify-substrate-first/SKILL.md) — research the substrate before deciding a gap is genuinely tacit.
- Principle: `docs/founder-kernel/wiki/principles/elicit-tacit-knowledge.md`.

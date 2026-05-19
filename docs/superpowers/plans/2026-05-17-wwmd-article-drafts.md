# WWMD / WWWD — Article Working Drafts

| Field | Value |
| --- | --- |
| Date | 2026-05-17 (revised 2026-05-19 with live build metrics) |
| Status | Living draft — architecture shipped, gate has not yet caught a real decision; first live build metrics captured |
| Source spec | `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` |
| Source unlock map | `docs/superpowers/plans/2026-05-17-wwmd-decision-perspective-kernel-implementation.md#marketing-article-unlock-map` |

## Publication Checklist

Before either piece is published, the following `[PENDING IMPLEMENTATION]` markers must be resolved with real feature evidence:

- [ ] **Decision Ledger screenshot** — needs the Build Studio gate panel and ledger UI to exist
- [ ] **Gate-in-action example** — needs a real WWMD invocation from a live Build Studio build
- [ ] **Confidence delta example** — needs a real session where the gate was overridden and confidence dropped
- [ ] **"defer" outcome example** — needs a real deferral event from a coverage gap
- [ ] **Principle conflict example** — needs a real `principleConflict: true` interaction row showing the escalation outcome and human resolution; the v1 story is escalation-and-capture, not weighted vector synthesis (that is v2)

Pre-publication accuracy check:

- [ ] **V1/V2 accuracy** — Draft B's principle contradiction section describes v1 escalation-and-capture behavior. Before publishing, confirm the shipped feature matches this description. If weighted synthesis has shipped in the meantime, update the section to reflect the actual shipped behavior and remove the v1/v2 framing.
- [ ] **Market positioning table** — Claims in "The market gap this addresses" must be source-verified before marketing use; the underlying sweep was done in May 2026. Verify currency before publication.

Everything else in both drafts is ready to finalize now.

---

## DRAFT A — LinkedIn

**Suggested title:** What Would We Do? The AI Question Every Company Needs to Answer

**Target length:** ~1,100 words  
**Tone:** Humble, practical, architectural. Accessible to non-engineering executives.

---

Someone asked me recently if I'd built a digital version of myself.

In a way, I had. A few months ago I shared a scoped GPT built from years of my thinking about product design, platform architecture, and how to build AI systems that actually work. The reaction was stronger than I expected. People were using it. More than a few said: "It's like having you in the room."

That's flattering. It's also a little alarming.

Not because the tool didn't work — it did. But because "a digital version of Mark" is not a product. It's a party trick. And the question it actually raised was far more interesting than any answer it could give.

**The question organizations actually need answered isn't "what would Mark do?" — it's "what would we do?"**

---

Most AI tools are retrieval systems dressed up as advisors. You put documents in, you ask questions, and you get answers. The quality depends on how much text is in the system and how well the question is phrased.

That's useful. But it's not how organizations actually make decisions.

Organizations make decisions through a combination of:

- **Doctrine** — the accumulated judgment of people who've earned authority over time
- **Evidence** — facts gathered about the specific situation
- **Conflict** — competing perspectives that surface the real trade-offs
- **Escalation** — knowing when the decision is too big or too ambiguous to make without the right person in the room

A retrieval system handles the second bullet reasonably well. It mostly ignores the other three.

What DPF is building with WWMD and WWWD is different. It's a **decision perspective service** — a governed layer that can hold a profile of how a specific person or organization approaches decisions, and apply that profile to ambiguous situations in a way that preserves accountability, evidence, and honest doubt.

---

**WWMD** is "What Would Mark Do" — the seed profile for the DPF platform itself. For this install, it's tightly scoped to platform and product decisions: how to prioritize, what architecture to trust, when to push forward, when to escalate.

**WWWD** is "What Would We Do" — the generalization. Every organization that runs DPF can build its own WWWD profile from the accumulated decisions, corrections, rationales, and principles of its own leadership.

The goal isn't to impersonate anyone. It's to preserve how decisions get made so that work doesn't stall every time a question reaches a junction that requires judgment.

---

The key doctrine in our design is this:

> **Confidence is earned in drops and lost in buckets.**

Most AI systems present with uniform confidence. Everything sounds equally certain. That's one of the core reasons people don't trust AI recommendations for anything consequential.

WWMD/WWWD works differently. Confidence is an operating state — not a static score, and not a model's internal probability estimate. It is derived from: how strong the source material is, whether the rationale has held up across prior similar decisions, how well the current context fits, and what happened the last time the system recommended something in this domain.

When a human overrides a recommendation, confidence in that domain drops. When recommendations prove correct over time, confidence earns back slowly.

The system has four possible outputs when it encounters an ambiguous situation:

- **Recommend** — with evidence, trade-offs, and a confidence level
- **Arbitrate** — make a low-risk call and keep work moving, with a decision record
- **Escalate** — route the decision to the accountable human when stakes or uncertainty are high
- **Defer** — surface a gap in the profile's coverage, rather than fabricate a recommendation

That last one matters a lot. A system that knows what it doesn't know is more trustworthy than one that fills every gap with a confident-sounding answer.

---

One pattern that most people don't expect to see in an AI system is **constructive conflict**.

In a real team, disagreement is healthy. A good advisor challenges assumptions. A good review process looks for holes in a plan before the plan ships.

We're building that in. Before the WWMD gate recommends or escalates, it can run a structured deliberation — multiple perspectives, competing claims, evidence grading — and synthesize the result into a recommendation that shows where the debate landed and what remained unresolved.

The goal isn't to hide disagreement. It's to surface it with enough structure that a human can act on it.

Stalemates escalate to a person. Real conflicts get records. The human's resolution becomes candidate material for improving the profile.

---

The first place this lives is Build Studio — DPF's AI development environment, where autonomous coworkers plan, build, review, and ship features. Build Studio is full of moments where work stalls on judgment calls: Is this plan ready to move forward? Should we accept this design trade-off? Is the evidence strong enough to proceed?

Those are exactly the moments where a governed decision perspective earns its keep — not by replacing the decision, but by framing it, sourcing it, and routing it to the right person when needed.

`[PENDING IMPLEMENTATION: Insert a real example from a Build Studio session showing the WWMD gate panel in action — options presented, evidence cited, outcome reached.]`

---

What we're really building here is the **embodiment of a way of thinking.**

That phrase matters. An organization's accumulated judgment isn't a database of past answers — it's a *method*. How evidence gets weighed. Which conflicts get escalated and which get arbitrated. When confidence should grow and when it should drop. What gets deferred because the profile doesn't yet have enough coverage to frame the question honestly.

Most AI systems try to capture decisions. WWMD/WWWD tries to capture the method that produced them.

The difference matters when ambiguity shows up in an agentic workflow — which it always does. An autonomous coworker hitting an underspecified piece of work doesn't need an answer from a black box. It needs the question routed through the organization's actual way of deciding. When that routing exists as a governed substrate — versioned, evidenced, auditable — ambiguity stops being a stall point and starts being a place where the method actually does its work.

That's the bet. The decisions are downstream. The way of thinking is the thing.

---

This is not a solved problem. Not in DPF, and not in the industry.

We surveyed the commercial AI landscape as part of designing this. Microsoft, Salesforce, Google, IBM — they all have multi-agent orchestration, knowledge retrieval, and governance toolkits. None of them have a governed decision perspective profile with confidence tracking, deliberation integration, and principle traceability. None of them let an organization define, version, and audit the principles that governed a specific recommendation.

That's the white space we're building in.

---

Two influences worth naming. **Scott Page**'s work on cognitive diversity — and his diversity-prediction theorem in particular (collective error equals average individual error minus the diversity of perspectives) — is the formal reason DPF runs multi-perspective deliberation before WWMD synthesizes a recommendation. Diverse models reduce collective error in a way no single smart model can; the math is older than the LLM era and still holds. **Nate B. Jones**, an analyst writing about practical LLM patterns, has been arguing for a while that "when intelligence is abundant, context becomes the scarce resource" and that "agent infrastructure is 80% plumbing." His Open Brain project (OB1) makes the same architectural bet on the context side that DPF is making on the decision side: treat the substrate as the work, not the prompt.

---

Full autonomy isn't one leap. It's a long series of accountable decisions, each one slightly better than the last, each one traceable to evidence, each one correctable when it goes wrong.

WWWD is how we build that for every organization that runs DPF — not as a personality clone, but as a governed reflection of how that organization earns the right to move faster.

If your AI coworkers had to answer "what would we do here?" — what sources, decisions, and leadership principles would they need to earn your trust?

I'd genuinely like to know.

---
*Mark Bodman is the founder of DPF, an open-source AI operating platform for digital product delivery.*

---
---

## DRAFT B — Substack

**Suggested title:** Confidence Is Earned in Drops: Building a Decision Kernel for AI Coworkers

**Subtitle:** Why retrieval isn't enough, what deliberation adds, and how the WWMD/WWWD pattern works in practice

**Target length:** ~2,200 words  
**Tone:** Architectural and honest. For product and AI leaders who want the real design, not the pitch.

---

### The moment that reframed the problem

A few months ago I shipped a scoped GPT built from years of my writing, product thinking, and platform decisions. I shared it on LinkedIn. The reaction was unexpectedly strong — people were using it, quoting it back to me, saying it felt like having me in the room.

It was gratifying. It was also a signal I needed to think about carefully.

Because what they were reacting to wasn't the tool — it was the recognition that **accumulated judgment has value**, and that the reason it usually disappears is that we have no good way to make it durable, governed, or available when it's needed without the person being there.

That's the real problem. Not "how do I clone Mark." It's: how does an organization preserve how it decides?

---

### Why retrieval isn't enough

Most enterprise AI systems today are retrieval systems with a reasoning layer on top. You embed your documents, you run RAG over them, and you get answers. The quality of the answer depends on how good the retrieval is and how much signal is in the corpus.

This works well for factual lookup. It works poorly for:

**1. Judgment under ambiguity.** When the situation doesn't match the existing corpus, retrieval gives you the nearest match rather than a principled extrapolation. The system doesn't know that it's guessing.

**2. Competing priorities.** Retrieval systems don't have a principled way to resolve a situation where two stored documents point in different directions. They synthesize. They average. They paper over conflict.

**3. Confidence calibration.** The system presents with roughly uniform confidence whether it retrieved a perfect match or is speculating from a thin corpus. There's no operating state for "I should probably not be making this call."

**4. Earned trust.** If the system gets a recommendation wrong, there's no mechanism to reduce its confidence in that domain until it proves itself again. Corrections don't teach anything durably.

These four failures are why people don't trust AI recommendations for consequential decisions — and rightfully so. The system doesn't model its own limitations.

---

### What a decision perspective profile is

WWMD and WWWD are built around a concept we're calling a **Decision Perspective Profile**.

A profile is not a chatbot persona and not a knowledge base. It's closer to a governed operating policy for a specific decision domain, with explicit:

- **Owner** — who has authority over this perspective
- **Scope** — which domains, routes, and risk tiers it applies to
- **Source material** — articles, rationales, prior decisions, corrections, principles, and approved guidance — with evidence grades and freshness states
- **Confidence state** — per decision class, earned through track record and lost through corrections
- **Autonomy policy** — what the profile can decide alone, what it must recommend, what it must escalate
- **Escalation route** — who gets called when the profile is stuck

The profile is versioned. Every decision interaction links to the snapshot of the profile that was active at the moment it ran. This matters for audit: three months from now, you can look at any decision and see exactly which version of the organization's doctrine governed it.

---

### The four gate outcomes

When the WWMD/WWWD gate is invoked — either by a Build Studio phase gate, a coworker conflict, or an explicit call — it returns one of four outcomes:

**Recommend.** The profile has sufficient coverage and medium-or-higher confidence. It proposes a direction with evidence, trade-offs, and a confidence score. The operator can accept, modify, or override.

**Arbitrate.** High confidence plus low risk. The gate makes the call and keeps work moving, writing a decision record. No human input required. Confidence in this class grows fractionally with each correct arbitration.

**Escalate.** Low confidence, high risk, or unresolved conflict between principles. The gate routes the decision to the accountable human with a structured brief: the question, the options, the evidence, and what's unresolved. The human's response is captured — answer, criteria, rationale, and whether the reasoning should become candidate profile material.

**Defer.** This one is the most underrated. The profile lacks coverage for the domain. Not "I'm uncertain" — *"I don't have the material to even frame this question reliably."* The gate surfaces a coverage gap, queues the question as candidate material, and does not fabricate a recommendation.

A system that knows what it doesn't know is more trustworthy than one that fills every gap with a confident-sounding answer.

---

### Confidence as an operating state

The core doctrine:

> **Confidence is earned in drops and lost in buckets.**

Confidence in WWMD/WWWD is not a model-level probability estimate. It's a governed operating state per decision class, derived from:

- Source quality (is this material well-evidenced or thin?)
- Pattern history (has the profile been reliable in this class before?)
- Context fit (does the current situation actually match the profile's scope?)
- Risk tier (even high confidence gets escalated above a risk threshold)
- Outcome feedback (was the last recommendation correct, or was it overridden?)

When a human overrides a recommendation, confidence in that domain decreases immediately. It rebuilds slowly through subsequent correct recommendations. There's no shortcut back.

This is different from how most AI systems work — where corrections are a logging event, not a learning signal for future behavior in that domain.

`[PENDING IMPLEMENTATION: Insert a real confidence delta example — a domain where the gate was overridden twice in a row and its behavior visibly shifted toward escalation.]`

---

### Temporal decay and the danger of stale doctrine

Perspective material expires. This is a design constraint that's easy to overlook.

A 2023 article representing a position that Mark has since reversed is actively harmful if the profile weights it equally with a 2026 rationale. The same applies to any organization's WWWD profile: a founding-era decision rule may be right for year one and wrong for year five.

Every piece of perspective material in the profile carries a freshness state: `current`, `stale`, `superseded`, or `contradicted`. Material decays on a schedule by type — articles decay faster than confirmed decisions; principles decay slowest. When new material is promoted into the profile and it conflicts with existing material, the conflict is surfaced for human resolution. The older source transitions to `superseded` or `contradicted` only on explicit human confirmation.

Stale sources get downweighted. Contradicted sources contribute zero confidence weight. The system never silently keeps outdated doctrine alive at full strength.

---

### Deliberation before recommendation

The gate doesn't just retrieve and synthesize. For higher-stakes or higher-ambiguity decisions, it can run — or consume the output of — a structured deliberation.

DPF already has a Deliberation Pattern Framework (a separate design published earlier this year) that supports multi-perspective review, structured debate, evidence grading, and synthesis with explicit claim tracking. The WWMD gate integrates with this: if a `DeliberationRun` has already produced a `DeliberationOutcome` for the current context, the gate consumes it as structured evidence. If it needs one, it can invoke the framework before synthesizing a recommendation.

The result is that recommendations from the gate arrive with visible reasoning structure:
- what evidence was cited
- which perspectives were considered
- what objections remain unresolved
- what confidence grade the evidence earned

This isn't performative. An unresolved objection in the deliberation output can be the factor that tips a `recommend` to an `escalate`. The synthesis is honest about the debate that preceded it.

---

### Principle contradiction resolution

Organizations have principles. Principles sometimes conflict on specific decisions.

When two active principles in the profile pull in different directions on the same question, the gate does not pick a winner. It escalates — surfaces the conflict to the accountable human with a structured brief showing which principles are in tension and on which domain. The decision record flags `principleConflict: true` and the human's resolution becomes candidate material for improving the profile. The system learns which principle takes precedence in that class of decision, from real human judgment, rather than fabricating a resolution.

Principle conflict is never hidden or averaged away.

This is the v1 behavior: escalate on conflict, capture resolution, accumulate real conflict data. The weighted vector aggregation model — where principles carry directions and weights that can be resolved mathematically — is the v2 target, built on the conflict ledger that v1 produces. Publishing v2 as if it's v1 would be inaccurate. The v1 story is already strong: a system that knows it can't resolve two equally-weighted principles is more trustworthy than one that quietly picks a side.

`[PENDING IMPLEMENTATION: Show a real principle conflict from the decision ledger — two principles in tension, the escalation outcome, the `principleConflict: true` flag, and the human resolution captured in the record.]`

---

### Where this lives in the product

V1 is embedded in Build Studio — DPF's AI development environment where autonomous coworkers plan, design, implement, and ship features.

The first gate is the **plan advancement decision**: the point where Build Studio must decide whether a plan is ready to move into implementation. This is the highest-value ambiguity point in the build lifecycle — wrong plan wastes a full build cycle, the quality signal is often borderline, and the operator is already watching this gate.

When the gate fires, the operator sees:

- the ambiguity being resolved
- the options under consideration
- the WWMD recommendation or escalation prompt
- evidence sources and confidence tier
- which profile version is active
- any unresolved deliberation objections

Every invocation writes to the decision ledger, which operators can inspect over time to see: how often the gate recommended vs escalated, where confidence has grown, where corrections have clustered, and what profile-drift alerts are waiting for review.

`[PENDING IMPLEMENTATION: Insert a screenshot of the Build Studio WWMD gate panel and the decision ledger inspector showing a real session.]`

---

### Embodying a way of thinking

There is a category mistake at the center of most enterprise AI projects, and it shows up most visibly when a company tries to "codify its best people" or "capture institutional knowledge."

The mistake is treating decisions as data.

They aren't. A decision is the *application of a method to a situation*. The situation is specific; the method is what was actually worth preserving. The decision itself is just the residue.

A retrieval system can store decisions and look them up. It cannot reconstruct the method from the decisions — at least not reliably, and not in a way that generalizes to situations the original decision-maker never saw. Ask a RAG-over-meeting-notes system "what would we do here?" and it will give you a plausible-sounding paraphrase of the nearest past case. That is not how organizations actually decide, and it is not what an autonomous coworker should be doing when it hits ambiguity in real work.

WWMD/WWWD is built on a different proposition: what an organization should preserve is **how its leaders weigh evidence, where they escalate, when they defer, and what they treat as principle versus what they treat as preference.** The decisions emerge from that. They aren't the thing itself.

When you capture the method instead of the decisions, three useful things happen.

**1. New situations get principled answers.** The substrate doesn't need to have seen the exact case before. It applies the encoded method — the four-outcome framing, the confidence rules, the deliberation pattern, the escalation route — to a situation that may not match any prior decision. The novelty is preserved; the method is portable.

**2. Corrections improve the method, not just the case.** When a human overrides a recommendation, the override doesn't just resolve the current question. It teaches the substrate something about *when* its method needs adjustment — about which domain classes are drifting, which sources are stale, which principles need re-weighting. A patched single case is a logged event. A patched method is a learning signal that scales across every future decision in that class.

**3. Audit becomes possible.** Three months later, you can ask not just "what did we decide?" but "why did we decide it that way, given what we knew then, and which principle governed?" That is the difference between an AI system you can trust with consequential work and one you can't. The decision ledger answers the first question. The profile version snapshot answers the second.

This is what it means to embody a way of thinking. Not store decisions. Not impersonate a person. **Encode the method as governed structure** — versioned, evidenced, auditable, correctable — and let the decisions follow.

### Why this matters for ambiguity

Ambiguity in agentic workflows is the place where this distinction stops being philosophical and becomes operational.

Every autonomous coworker hits ambiguity. A plan has a gap. A design choice is underspecified. A trade-off has competing principles. The standard failure mode is well-known: the model asks a clarifying question, gets an answer, and then either re-asks it five minutes later in a sibling task or guesses at a synthetic answer that propagates downstream as if it were authoritative.

That failure mode happens because the conversation is the only place the answer lives. Conversation is brittle — it rotates out of context windows, doesn't carry across tasks, and isn't versioned. Asking a coworker to remember an answer is asking the wrong layer to do the wrong job.

The substrate is the right layer. When ambiguity arrives at the gate, the method runs:

- Is the profile's coverage sufficient to recommend?
- Is the confidence high enough, given the risk tier?
- Are there competing principles? If so, this becomes an escalation, not a synthesis.
- Has the human resolved a similar question in this domain class before? If so, that resolution is the answer.
- If none of the above, defer honestly — surface the coverage gap as candidate material rather than guessing.

That sequence isn't a clever prompt. It's the organization's way of thinking, encoded as code, applied to a moment of ambiguity, with an auditable record at the end. The coworker doesn't need to remember anything. The substrate remembers.

Honest current state: the gate code, schema, seed, and UI shipped on 2026-05-17. The first profile is seeded with six pieces of perspective material. The integration point — the plan-advancement gate in Build Studio — is wired. The `DecisionInteraction` ledger has not yet recorded its first real invocation; the builds currently in flight advanced before the UI surface shipped, and the builds in ideate phase haven't yet reached the plan-advancement boundary. The first catch is days away.

The architecture is in place. The method is encoded. The first ambiguity the gate catches will be the first real test of whether the embodiment actually works as designed. If it does, the next coworker that hits a question in the same domain class will find the answer in the ledger before it asks anyone — because the method, not the conversation, is now where the organization's thinking lives.

---

### The market gap this addresses

We surveyed the commercial landscape before finalizing this design. Microsoft Copilot Studio, Salesforce Agentforce, IBM watsonx Orchestrate, Google's Enterprise Agent Platform — all have multi-agent orchestration, knowledge retrieval, and governance toolkits. None of them have:

- A customer-owned decision perspective profile (customers define their own doctrine, not the vendor)
- Confidence as a governed operating state per decision class
- Principle traceability (which principle governed this specific recommendation, in this specific interaction)
- Profile versioning linked to decision records (so auditing is possible as doctrine evolves)
- Deliberation-first architecture before recommendations at high-stakes gates

The closest conceptual analog is Anthropic's Constitutional AI — but that's a model-level compliance layer applied by the vendor, not a customer-controlled profile that the organization defines, evolves, and audits. Those are fundamentally different things.

The white space is real. The absence of principle traceability in commercial platforms is particularly notable: governance toolkits exist, but they block bad actions rather than tracing which organizational principles governed a specific recommendation. Audit requires traceability, and traceability requires the profile to be versioned and linked.

---

### Intellectual lineage

This design didn't come from nowhere. Two threads, from outside the LLM mainstream, did most of the conceptual work.

**Scott Page**, the University of Michigan complexity scholar, has spent two decades arguing that cognitive diversity is not a soft virtue but a measurable force. In *The Difference* (2007) and *The Diversity Bonus* (2017) he formalizes what he calls the diversity-prediction theorem: on complex problems, **the collective error of a group equals the average individual error minus the diversity of perspectives.** Diversity is subtractive against error. It is not a tiebreaker, not a fairness argument, not an aesthetic — it is a quantity that improves the answer.

That theorem is the formal foundation under DPF's deliberation framework. When the platform runs two or three structured perspectives (review, skeptic, synthesizer) before WWMD synthesizes a recommendation, the bet is Page's math. If the perspectives are genuinely different — different models, different role prompts, different reasoning paths — they cancel each other's blind spots. If they aren't genuinely different, the deliberation framework records that honestly rather than pretending to independence it didn't earn.

**Nate B. Jones** writes about practical LLM production patterns and agent design, primarily from the engineer-in-production seat rather than the model-research seat. Two of his framings shape this design directly:

> When intelligence is abundant, context becomes the scarce resource.

That is the entire reason scoped task context exists. The model isn't the bottleneck. The signal-to-noise ratio inside the context window is.

> Agent infrastructure is 80% plumbing.

That is the entire reason WWMD is built as a governed substrate — a decision ledger, a profile model, a versioned snapshot, an idempotency key — rather than a smarter prompt or a cleverer chain. The 80% that determines whether the system works is the part that doesn't look glamorous in a demo.

Jones's **Open Brain (OB1)** project crystallizes the context-as-architecture thesis at the agent-tooling layer. It treats context not as something the model holds in memory but as something the system holds in a structured substrate the model queries. DPF is making the same architectural bet, applied to the decision side: the substrate, not the prompt, is where governance and durability live.

These two threads — diversity as a measurable force, intelligence as abundant and context as scarce — sit underneath everything in this design.

---

### What comes after v1

Once the Build Studio gate proves itself through real decisions, the pattern extends:

- Other coworkers can invoke the gate when their own ambiguity or conflict warrants it
- Customer WWWD profiles start from the same framework, with their own leadership material, escalation routes, and confidence states
- The decision ledger enables proactive profile improvement — when a domain shows consistent override patterns, the system surfaces candidate edits to the perspective material for human review
- A standalone "Ask WWMD" advisory surface generalizes the pattern for non-Build-Studio contexts — but it must use the same governed profile, the same evidence rules, and the same confidence model. It can't be a forked chatbot.

---

### The underlying bet

The bet behind WWMD/WWWD is that **full autonomy is not a destination you arrive at — it's a trust relationship you earn over many accountable decisions.**

The platform's job is to make each decision traceable, correctable, and durable. The organization's job is to keep the profile honest. The gate's job is to know when it's ready to move and when it needs a person.

That's a better model than "AI handles it" or "human handles it." It's a model where the division of responsibility is explicit, the evidence is visible, and the confidence has to prove itself before it grows.

If you're building autonomous AI systems for your organization, I'd ask you one question:

When your AI coworkers answer "what would we do here?" — what sources, decisions, and principles should they be drawing on? And how would you know if they got it wrong?

Those two questions are the whole design problem.

---
*Mark Bodman is the founder of DPF, an open-source AI operating platform for digital product delivery.*

---
---

## Implementation Watch Log

This section tracks which features have shipped and which article markers can be resolved. Update as features land.

### Snapshot 2026-05-19 19:55Z — WWMD substrate state

Direct observation of WWMD-relevant state. Build-runtime metrics (rate-limit storms, dispatch retry patterns) are out of scope for this article — see the "Out of scope" section below.

| Metric | Value | Reading |
|---|---|---|
| `DecisionPerspectiveProfile` rows | 1 | `Mark / DPF Platform` seeded correctly |
| `PerspectiveMaterial` rows | 6 | Starter principles loaded from platform doctrine |
| `DecisionInteraction` rows | 0 (last verified 2026-05-18 05:45Z; admin_query_db unavailable in current session) | **Gate has not yet fired on a plan→build transition** |
| `EscalationCapture` rows | 0 | No human resolutions captured yet |
| `DeferralCapture` rows | 0 | No coverage gaps logged yet |
| Builds in `plan` phase | 0 (most recent check) | No advancement-gate candidate in flight |
| Builds in `ideate` phase | 2 | Will reach the gate boundary in coming days |
| Builds in `build` phase | 3 | Advanced before UI surface shipped at 16:51Z 2026-05-17 |

**Reading.** The substrate exists. The seed is intact. The first catch is pending. The article's empirical claim — that ambiguity, once routed through the encoded method, stops repeating across sibling tasks — is not yet measurable, and the drafts have been written to acknowledge that honestly. The next plan→build transition is the first real test.

### Marker resolution status

| Marker | Feature | Status | PR / Notes |
| --- | --- | --- | --- |
| Decision Ledger screenshot | Build Studio WWMD gate panel + ledger inspector | infra-shipped, no real session yet | Backlog item #1; gate UI is live but no `DecisionInteraction` row exists to render |
| Gate-in-action example | Build Studio plan advancement gate integration | infra-shipped, no invocation yet | Backlog item #3; awaiting first plan→build advancement since UI surface (16:51Z 2026-05-17) |
| Confidence delta example | Confidence scoring + demotion rules | infra-shipped, no overrides yet | Backlog item #8; requires gate to fire and human to override |
| Principle conflict example | `principleConflict: true` interaction row from evaluator + gate integration (v1 = escalate; v2 weighted synthesis is deferred) | infra-shipped, no conflict yet | Backlog item #4 / spec §5.7 |
| Defer outcome example | Deferral capture and coverage gap surfacing | infra-shipped, no deferral yet | Backlog item #7 |

### Out of scope for this article — captured for a future piece

The 54-attempt rate-limit storm and 151-minute quiet window on `FB-71FB3A53` are real, measurable, and worth writing about. **They are not this article.**

This article is about the embodiment of a way of thinking — encoding decision-making method as governed substrate, applied to ambiguity in agentic workflows. The retry storm is a different problem class: provider rate-limit cascades and context regrowth on retry. Conflating them weakens both stories.

**Captured for a future article:**

- Build `FB-71FB3A53` (formal-deliberation feature): 7/9 tasks complete, 54 dispatch attempts in 10 minutes, 100% `usage-limit` failure axis, 151 minutes of subsequent silence before operator intervention.
- Pattern: rate-limit failures cascade through the provider fallback chain (chatgpt → anthropic-sub → gemini → codex), with each retry resending growing context.
- Compound effect: prompt size grows on retry → rate limits hit faster → more retries → eventual operator stall.
- Proposed future article: "Why your autonomous build paused for 151 minutes — retry storms, prompt-size regrowth, and rate-limit cascades in agentic loops."
- Proposed backlog item: cap context regrowth on retry, throttle dispatch cascade, surface rate-limit-exhaustion state to operator earlier.

The WWMD article should be allowed to make its argument cleanly. The retry-storm article will have its own evidence and its own thesis. They are siblings in the substrate-vs-conversation family but should not share a piece.

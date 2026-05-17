# WWMD / WWWD — Article Working Drafts

| Field | Value |
| --- | --- |
| Date | 2026-05-17 |
| Status | Living draft — not for publication until implementation markers are resolved |
| Source spec | `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md` |
| Source unlock map | `docs/superpowers/plans/2026-05-17-wwmd-decision-perspective-kernel-implementation.md#marketing-article-unlock-map` |

## Publication Checklist

Before either piece is published, the following `[PENDING IMPLEMENTATION]` markers must be resolved with real feature evidence:

- [ ] **Decision Ledger screenshot** — needs the Build Studio gate panel and ledger UI to exist
- [ ] **Gate-in-action example** — needs a real WWMD invocation from a live Build Studio build
- [ ] **Confidence delta example** — needs a real session where the gate was overridden and confidence dropped
- [ ] **"defer" outcome example** — needs a real deferral event from a coverage gap
- [ ] **Principle traceability example** — needs the decision interaction record to show which principle governed a recommendation

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

This is not a solved problem. Not in DPF, and not in the industry.

We surveyed the commercial AI landscape as part of designing this. Microsoft, Salesforce, Google, IBM — they all have multi-agent orchestration, knowledge retrieval, and governance toolkits. None of them have a governed decision perspective profile with confidence tracking, deliberation integration, and principle traceability. None of them let an organization define, version, and audit the principles that governed a specific recommendation.

That's the white space we're building in.

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

When two active principles in the profile pull in different directions on the same question, the gate applies a weighted vector synthesis — each principle has a direction, weight, and domain applicability. Contradictory principles on the same domain are resolved mathematically into a net vector. The decision record shows which principles were in play, how they were weighted, and what the resolution was.

If the net confidence is below threshold — the principles are evenly matched, or the weights are too close to call — the gate escalates rather than fabricating a synthesis. Principle conflict is never hidden.

`[PENDING IMPLEMENTATION: Show a real principle conflict from the decision ledger — two principles in play, the weighted resolution, and the resulting gate outcome.]`

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

| Marker | Feature | Status | PR / Notes |
| --- | --- | --- | --- |
| Decision Ledger screenshot | Build Studio WWMD gate panel + ledger inspector | `not started` | Backlog item #1 |
| Gate-in-action example | Build Studio plan advancement gate integration | `not started` | Backlog item #3 |
| Confidence delta example | Confidence scoring + demotion rules | `not started` | Backlog item #8 |
| Principle conflict example | Principle traceability in decision interaction record | `not started` | Backlog item #4 / §5.7 |
| Defer outcome example | Deferral capture and coverage gap surfacing | `not started` | Backlog item #7 |

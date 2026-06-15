# The DAP Experience Layer — design depth

**Date:** 2026-06-09
**Status:** Design companion / direction-setting. Not a build spec. Feeds the §8 item-8 backlog item of the parent assessment.
**Audience:** Operator (Mark), platform architects, anyone building the operator-facing surface of a long-running process.
**Parent:** [`2026-06-09-long-running-agentic-process-architecture.md`](2026-06-09-long-running-agentic-process-architecture.md) — the parent establishes *that* the experience layer must be generalized (§3.2, §5 criteria 13–17, §6 layer 6, §8 item 8). This companion is *how*, grounded in the HCI literature and current agent-product practice (citations in §10).
**Scope:** The UX design of "layer 6" — the operator-facing surface that renders the durable process of Decision A and feeds its HITL gates. Decisions A (orchestration) and B (model economics) are in the parent.

---

## 0. The thesis, stated once

The hard problem of a long-running autonomous process is **not the progress bar.** It is the human's **trust, attention, and situational awareness** when they supervise something that runs for hours-to-days and only enters their attention at a gate. Get the engine of Decision A perfect and you can still ship a process that is *ignored* (notification fatigue) or *babysat* (defeating the autonomy you built). The experience layer is where the durable engine becomes either an asset or a liability for a **non-technical operator who makes decisions but does not run the system** ([`never-ask-user-to-run-commands`](../founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)).

The literature converges on one architecture: **ambient by default, interrupt by exception, with honest uncertainty, and the human kept in the loop *at the gate* even though they were out of it during the run.** The nine subsections below are that architecture; §8 is the concrete state→affordance spec; §9 is what to instrument so we know it works.

A reframe worth holding throughout: DPF already built ~80% of the *mechanics* (ProcessGraph, TruthSourceBadge, DecisionPerspectiveGatePanel, StallEventHistoryStrip, agent-event-bus, a notifications API — parent §3.2). What is missing is not widgets. It is the **policy** that decides what reaches the operator, when, at what altitude, and with what context — and the **generalization** of those widgets off `FeatureBuild` onto a `kind`-agnostic run.

---

## 1. Core reframe — ambient by default, interrupt by exception

Calm Technology (Weiser & Brown 1996; Case 2015) gives the spatial model: status lives in the **periphery** (what we are attuned to without attending — the engine-noise-while-driving example), and a thing moves to the **center** of attention only when it genuinely needs us, then recedes.

This sharpens parent criterion 15 ("notify, don't poll") into a **two-sided contract**:

- The **human never polls a log.** Status is radiated continuously and glanceably — a state chip, a side-rail of phase progress, a quiet-agent indicator. Checking "is it still alive?" must never require reading a transcript.
- The **agent never spams.** A notification is an **escalation event**, not a status feed. The agent radiates ambient status and interrupts discretely *only* at a decision or a failure.

DPF already has the ambient half (quiet-agent watchdog, `ProcessGraph`, truth-source badges). It is missing the escalation half — the notification transport is wired only for self-upgrade (parent §3.2). Building that half is not "add notifications"; it is "add notifications *governed by §3's policy*," or it becomes the alarm-fatigue failure below.

---

## 2. The supervisor is structurally out-of-the-loop — design the gate for awareness *and* calibrated trust

This is the subsection that most changes how the gate should look.

**The out-of-the-loop problem is structural, not a UX nicety.** Bainbridge's *Ironies of Automation* (1983): humans are poor at passively monitoring a reliable automated system for rare failures, yet are asked to take over at precisely the hardest moments — and the skills to do so atrophy from disuse. An operator who checks in only at gates has **near-zero retained context** by design. So a bare "Approve?" is the wrong gate: it asks the least-informed person to make the most consequential call.

**The gate must rebuild situational awareness across Endsley's (1995) three levels:**

| SA level | The gate must answer | DPF substrate today | Gap |
|---|---|---|---|
| **L1 — Perception** | What is the decision; what is the current state | `DecisionPerspectiveGatePanel`, `ProcessGraph` | mostly present |
| **L2 — Comprehension** | How this fits the run's goal; **what changed since you last looked** | `UnifiedEvidenceTimeline` (raw) | needs a *digest*, not a replay (§6) |
| **L3 — Projection** | What approving vs. rejecting will **cause downstream** (blast radius) | `explain_blast_radius` exists as a tool | not surfaced at the gate |

This maps almost one-to-one onto Microsoft's **HAX guidelines** (Amershi et al., CHI 2019): **G11** make clear why; **G16** convey the consequences of the user's action; **G1/G2** make clear what the system can do and how well; **G10** scope/escalate when in doubt; **G9** make correction efficient; **G17** global controls (pause/abort); **G18** notify about changes between check-ins.

**Calibrated trust is the other half of the same gate.** Lee & See (2004): the goal is *appropriate reliance* — trust calibrated to the system's true competence — **not maximal trust.** Parasuraman & Riley (1997): the two failure modes are **over-trust → complacency** (the operator rubber-stamps) and **false-alarm-driven disuse** (the operator stops reading the gate). Two design moves keep trust calibrated:

1. **Show per-task-type reliability, not a generic "AI confidence."** The WWMD outcome (`recommend / arbitrate / escalate / defer`) + confidence already produces this; surface it at the gate *with a track record* ("design-review has caught N issues in the last M builds"). Generic confidence scores train complacency; competence-specific signals train calibration.
2. **Keep the cost of intervening below the cost of doing it yourself** (Apple HIG for ML; Google PAIR "Feedback + Control"). If correcting the agent is harder than doing the work, the operator disengages. Approve / reject / correct must be one click; the plan must be editable in place (§5).

This is the operational meaning of the kernel's *governance approves evidence, not provenance*: the gate ratifies **evidence quality**, and the UX's whole job is to make that quality **legible** to a non-technical decider.

---

## 3. Attention economics — a notification *policy*, not a notification feed

The strongest evidence base in the entire review is **alarm fatigue.** In clinical monitoring, **72–99% of alarms are false or non-actionable**; the documented result is clinician desensitization, *missed actionable alarms, and patient deaths* (AHRQ *Making Healthcare Safer III*; Sendelbach & Funk 2013; The Joint Commission made it a National Patient Safety Goal in 2014). The lesson transfers exactly: **a platform that fires one alert per process per event will train a non-technical operator to ignore all of them — including the deploy approval and the financial sign-off that actually matter.** Over-notifying is not "keeping the operator informed"; it actively destroys their response to the critical moment.

So the notification transport (§1, parent §8 item 8) must ship *with a policy*, not just a channel:

- **Classify every agent event on the IRC model** (McCrickard & Chewar 2003 — Interruption / Reaction / Comprehension):
  - an **approval gate** = high-I / high-R / high-C → push + modal + full L1/L2/L3 context;
  - a **failure that blocks** = high-I / high-R → push + recovery affordances;
  - **"step done" / "phase advanced"** = low / low / low → **ambient only, never a push.**
- **Interrupt immediately only when the decision is blocking AND the cost of delay is high** (Horvitz's cost-of-interruption modeling). Otherwise **defer to a task breakpoint or batch into a digest** (Iqbal & Bailey 2008 — deferring to breakpoints lowered frustration and reaction time vs. immediate delivery). Every pull-in also carries a hidden **resumption-lag** tax on the operator's *other* work (Mark, Gudith & Klocke, CHI 2008), so frequency itself is a cost.
- **Rate-limit and suppress aggressively; reserve the high-salience channel (mobile push) for the genuinely blocking.** The contract the operator should be able to trust is: *"I only ping you when I genuinely need a decision."*

This is precisely the design behind the parent's `HitlNotificationEvent.riskClass` field — **`riskClass` is the IRC channel-selector**, not a label. Wire it that way: riskClass determines push-vs-ambient and modal-vs-inbox, deterministically.

> Integrity note for anyone citing this: the popular "it takes 23 minutes to recover from an interruption" figure has **no peer-reviewed source** (it traces to a 2006 interview). Cite the resumption-lag *concept* (Mark et al. 2008), not that number.

---

## 4. Progressive disclosure is the organizing principle

The experience layer renders a **six-layer process** (parent §6) to a non-technical operator. Progressive disclosure (Nielsen 2006) is the canonical resolution and should be named as the layer's governing pattern: *"initially show only the few most important options; offer the larger specialized set on request."* Its documented benefits — better learnability, lower error rate, and efficiency for experts — are exactly what a multi-layer process surface needs.

Concretely: **surface only the decision and its rationale; defer the engine internals** (the step journal, tool traces, intermediate artifacts, raw stdout/stderr) behind an on-demand drill-down. This is already the altitude split in parent criterion 16 (operator's altitude vs. the engine's step), and the substrate already embodies it (`ProcessGraph` node → inspector → raw dispatch; `BuildDispatchHistoryCard` shows the classified root cause first and tucks raw output behind a disclosure). The work is to make it the **explicit, enforced** pattern for every `kind`, because it simultaneously simplifies the operator's view *and* preserves the expert override path — and it is the platform's own design DNA.

---

## 5. The cross-process inbox is the real new information architecture

This is the single most important *new* surface the DAP generalization creates, and the parent only gestures at it ("cross-process inbox").

Once build + campaign + close are all DAPs, the operator no longer supervises *a* process — they supervise **N concurrent long-running processes**, each occasionally needing them. The primary question stops being "how is this build doing?" and becomes **"across everything running, what needs me right now?"** That is a portfolio/triage problem, and current practice has converged on one answer: the **inbox-of-interrupts**.

- **LangChain Agent Inbox** (shipping, 2025): an inbox whose items are *the moments an agent paused for a human*, each resolved with a **fixed verb set — Accept / Edit / Respond / Ignore.** Productized as **LangSmith Fleet** (2026) "mission control" — review/approve/reject actions for *all* your agents from one place, role-gated, with every decision in a searchable trace. This is the "ambient agents" model: many agents in the background, surfacing to a human only when they need a decision.
- **Adopt it for DPF as one inbox across all `kind`s.** Each item = a process at a gate, showing the ask + L1/L2/L3 context + the proposed action, resolved with verbs that map onto WWMD: **accept ≈ recommend, edit ≈ amend-the-plan, respond ≈ arbitrate/answer-elicitation, ignore/escalate ≈ defer/escalate.** This is where the existing `AgentCoworkerPanel` busy-state and the realtime-HITL spec's **Paused-Work surface** converge — they are the same surface seen from two angles.

**A trap to design around, verified in the wild:** Claude Code today fires the *same* notification for "an agent needs my input" and "all background work is idle" — it cannot disambiguate them ([open issue #45781](https://github.com/anthropics/claude-code/issues/45781), requesting a distinct `BackgroundTasksIdle` event). For a multi-process operator this is the difference between "act now" and "nothing to do." The `HitlNotificationEvent` **must** distinguish a *blocking elicitation* from a *completion* from an *idle-fleet* state. Bake the distinction in from day one.

---

## 6. Re-entry is a digest, not a replay; review is by evidence, not diff

**Returning.** When the operator comes back after hours, **do not replay the activity stream.** Context-aware computing (Dey & Abowd) and the returning-user digest pattern say: present a **ranked "what changed / what needs you" summary — decision-first, importance-ordered, not chronological.** The `agent-event-bus` + `UnifiedEvidenceTimeline` already hold the raw material; the missing piece is a **summary projection** — the same compaction discipline the parent cites for context engineering (§2.3), turned toward the *human* instead of the model. The re-entry digest is the agent's model of "what you need to know to decide," and it is what populates L2 ("what changed since you last looked") at the gate (§2).

**Reviewing.** For the consequential terminal gate (ship / publish / sign-off), the review cost *is* the bottleneck on long runs. Current practice has moved from "read the diff" to **evidence-first review** — Cursor attaches **video demos, screenshots, and logs** ("demos over diffs"); Codex surfaces test results; Devin Review restructures large PRs into explained diffs. The human is shown evidence the change *works*, not merely *what changed*. DPF already has every piece — scoped verification, preview URLs, the dynamic-analysis report — and the platform already holds the principle that *dynamic analysis is the evidence, not screenshots* ([`structural-verification-is-not-functional`](../founder-kernel/wiki/principles/structural-verification-is-not-functional.md)). The experience layer should **compose these into an evidence-first review surface** at the gate, so approving is reviewing the *behavior*, not auditing a patch.

---

## 7. Adopt a shared vocabulary (and the accountability model)

Every DAP should narrate the same way, so the operator learns one language across build, campaign, and close. Standardize on **Linear's Agent Interaction model**, which is the most mature formal vocabulary shipping:

- **Session states** — `pending · active · awaiting-input · error · complete · stale`. DPF's `TaskRun` status enum maps cleanly; the parent already adopts `working / awaiting-input / error / stale` as the cross-domain status.
- **Five activity types** — `thought · action · elicitation · response · error`. The agent-event-bus already emits thought/action/response/error analogs. The one DPF most lacks as a *first-class* concept is **`elicitation`** — "the agent is asking the operator." That is exactly what the inbox (§5) triages and the notification (§3) escalates; making it a typed activity rather than a chat message is what lets the UI render "needs you" distinctly from "still thinking."
- **Agent Plans** — a session-level checklist whose steps carry status; this is the editable-plan surface (parent criterion 17 / Cursor Plan Mode / the AX "Intent Preview").

Borrow the **Agent Experience (AX)** design language as scaffolding (Biilmann 2025; Nudelman, *Secrets of Agentic UX*, 2025): **Autonomy Dial** (how much to ask), **Intent Preview** (the editable plan), **Action Audit** (the timeline), **Escalation Pathway** (the inbox interrupt), **Asynchronous Feedback Loop**, and **Graduated Evidence Presentation** (≈ progressive disclosure, §4).

Keep Linear's **delegate-not-assignee** accountability model: the operator stays the **named owner**; the agent acts *on their behalf*, never as the owner. This is the UX encoding of the kernel's **Propose → Acknowledge → Reassign** principle — the human's ownership is a visible, persistent fact in the UI, not an implicit assumption.

---

## 8. State → affordance map (the spec layer 6 must satisfy, for every `kind`)

The contract: each cross-domain status renders the same way regardless of `kind`, with the domain phase shown inside it. Channel column follows the §3 policy.

| Status | What the operator sees | Channel | Affordances |
|---|---|---|---|
| **working** | ambient phase chip + side-rail progress; **indeterminate but milestone-labeled** ("Step 4 of ~7: analyzing scrape") — never a fake % | periphery only | open · pause · abort (G17) |
| **awaiting-input** (`elicitation`) | inbox item: the ask + L1/L2/L3 context (decision, what-changed, blast radius) + proposed action + competence signal | **push, riskClass-gated** | accept · edit-plan · respond · escalate · defer |
| **error** | inbox item: what happened **in plain language** + what it cost + what-now; raw trace behind disclosure (§4) | push **iff** blocking | retry · abandon · escalate · edit-plan |
| **stale** | inbox item: "quiet N min; last action was X" with deep-link to that action | push **after threshold** | resume · abandon · investigate |
| **complete** | re-entry digest: what was done + **evidence** (demo/tests/preview) + the consequential gate | push | review-by-evidence · ship/publish/sign-off · reject |

**Honest-progress rule (Maister 1985; NN/g):** perceived wait is driven by uncertainty and unexplained delay, not clock time. For the `working` state, **reduce uncertainty, not just elapsed time** — occupy the wait (show what the agent is doing now), explain it (phase name), and when the ETA is genuinely unknown show an **indeterminate, informative** state, never a fabricated countdown. A dishonest progress bar costs trust the first time it's wrong (§2).

---

## 9. What to measure (UX acceptance criteria)

Do not ship the experience layer without instrumenting whether it actually calibrates attention and trust. Each metric ties to a failure mode above:

| Metric | Detects | Healthy direction |
|---|---|---|
| **Time-to-decision at gates** (notify → operator acts) | re-entry cost; out-of-the-loop (§2, §6) | down over time |
| **Gate dwell / read-rate** (did they open the evidence before deciding?) | **complacency / rubber-stamping** (§2) | not near-zero |
| **Notification precision** = acted-on ÷ sent | **alarm fatigue** (§3) | high; alert if it falls |
| **Override / correction rate + direction** | trust *calibration* (over- vs under-trust, §2) | stable, low-but-nonzero |
| **"Appeared dead" incidents** (process running, operator believed it stalled) | the visibility failure (§1) | → zero |
| **Re-entry digest sufficiency** (did the operator drill past the digest to decide?) | digest quality (§6) | digest usually sufficient |

These are also the eval signals the parent's §8 item-7 (observability) should carry, so the experience layer is replayable and improvable like any other DAP surface.

---

## 10. References (verified 2026-06-09; UX/HCI — complements the parent §10)

**Trust in automation / calibration**
- Lee, J. D., & See, K. A. (2004). *Trust in Automation: Designing for Appropriate Reliance.* Human Factors 46(1), 50–80. https://journals.sagepub.com/doi/10.1518/hfes.46.1.50_30392
- Parasuraman, R., & Riley, V. (1997). *Humans and Automation: Use, Misuse, Disuse, Abuse.* Human Factors 39(2), 230–253. https://journals.sagepub.com/doi/10.1518/001872097778543886

**Situational awareness / out-of-the-loop**
- Bainbridge, L. (1983). *Ironies of Automation.* Automatica 19(6), 775–779. https://www.sciencedirect.com/science/article/abs/pii/0005109883900468
- Endsley, M. R. (1995). *Toward a Theory of Situation Awareness in Dynamic Systems.* Human Factors 37(1), 32–64. https://journals.sagepub.com/doi/10.1518/001872095779049543
- Endsley, M. R., & Kiris, E. O. (1995). *The Out-of-the-Loop Performance Problem and Level of Control in Automation.* Human Factors 37(2). https://journals.sagepub.com/doi/10.1518/001872095779064555

**Human–AI interaction guidelines (industry)**
- Amershi, S., et al. (2019). *Guidelines for Human-AI Interaction.* CHI 2019. https://www.microsoft.com/en-us/research/blog/guidelines-for-human-ai-interaction-design/ (DOI 10.1145/3290605.3300233)
- Google PAIR, *People + AI Guidebook* — Mental Models / Explainability + Trust / Feedback + Control / Errors + Graceful Failure. https://pair.withgoogle.com/guidebook/
- Apple, *Human Interface Guidelines — Machine Learning / Generative AI.* https://developer.apple.com/design/human-interface-guidelines/machine-learning

**Interruption science / attention management**
- Horvitz, E., et al. *BusyBody: Creating and Fielding Personalized Models of the Cost of Interruption.* CSCW 2004. https://www.interruptions.net/literature/Horvitz-CSCW04-p507-horvitz.pdf
- Horvitz, E., Jacobs, A., Hovel, D. *Attention-Sensitive Alerting.* UAI 1999. https://arxiv.org/abs/1301.6707
- Mark, G., Gudith, D., Klocke, U. *The Cost of Interrupted Work: More Speed and Stress.* CHI 2008. https://ics.uci.edu/~gmark/chi08-mark.pdf
- McCrickard, D. S., & Chewar, C. M. *Attuning Notification Design to User Goals and Attention Costs.* CACM 2003. https://cacm.acm.org/research/attuning-notification-design-to-user-goals-and-attention-costs/
- Iqbal, S. T., & Bailey, B. P. *Effects of Intelligent Notification Management on Users and Their Tasks.* CHI 2008. https://interruptions.net/literature/Iqbal-CHI08.pdf

**Alarm / notification fatigue**
- AHRQ, *Making Healthcare Safer III* — Alarm Fatigue. https://www.ncbi.nlm.nih.gov/books/NBK555522/
- Sendelbach, S., & Funk, M. *Alarm Fatigue: A Patient Safety Concern.* AACN Adv Crit Care 2013. https://pubmed.ncbi.nlm.nih.gov/24153215/

**Calm / ambient technology**
- Weiser, M., & Brown, J. S. (1996). *The Coming Age of Calm Technology.* https://calmtech.com/papers/coming-age-calm-technology
- Case, A. (2015). *Calm Technology: Principles and Patterns for Non-Intrusive Design.* O'Reilly. https://principles.design/examples/principles-of-calm-technology

**Waiting psychology / progress**
- Maister, D. H. (1985). *The Psychology of Waiting Lines.* https://www.columbia.edu/~ww2040/4615S13/Psychology_of_Waiting_Lines.pdf *(propositions paraphrased; hosted PDF did not yield verbatim text)*
- Nielsen Norman Group, *Progress Indicators Make a Slow System Less Insufferable.* https://www.nngroup.com/articles/progress-indicators/
- Nielsen Norman Group, *Skeleton Screens 101.* https://www.nngroup.com/articles/skeleton-screens/

**Progressive disclosure**
- Nielsen, J. (2006). *Progressive Disclosure.* Nielsen Norman Group. https://www.nngroup.com/articles/progressive-disclosure/

**Re-entry / context restoration**
- Dey, A. K., & Abowd, G. D. *Context-aware computing.* Interaction Design Foundation encyclopedia. https://www.interaction-design.org/literature/book/the-encyclopedia-of-human-computer-interaction-2nd-ed/context-aware-computing-context-awareness-context-aware-user-interfaces-and-implicit-interaction

**Agent-supervision product practice (2025–2026)**
- Linear, *Agent Interaction* (AgentSession, six states, five activity types, delegate-not-assignee). https://linear.app/developers/agent-interaction
- Cursor, *Cloud Agents / Plan Mode* ("demos over diffs", editable plan). https://cursor.com/cloud ; https://cursor.com/docs/agent/plan-mode
- LangChain, *Agent Inbox* (accept/edit/respond/ignore). https://github.com/langchain-ai/agent-inbox ; LangSmith Fleet — https://www.langchain.com/blog/introducing-langsmith-fleet
- Claude Code notification disambiguation gap — https://github.com/anthropics/claude-code/issues/45781
- Biilmann, M. (2025). *Introducing AX (Agent Experience).* https://biilmann.blog/articles/introducing-ax
- Nudelman, G. (2025). *Secrets of Agentic UX.* UX Magazine. https://uxmag.com/articles/secrets-of-agentic-ux

---

*Design companion to the parent assessment. Nothing here authorizes feature code; it scopes the §8 item-8 backlog item — filed as `BI-BC8F667E` (epic `EP-COWORKER-INTERACTIVITY`, status: triaging) — the generalized, `kind`-agnostic experience layer + cross-process inbox + notification policy, and the UX acceptance criteria it must meet.*

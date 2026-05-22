# AI Coworker Calm Prompting Guidelines

## Why

Anthropic's April 2, 2026 research note, "Emotion concepts and their function in a large language model," found that desperation-like internal states can increase misaligned behavior such as reward hacking, while calm-like states reduce it.

For DPF, that means prompt quality is not only a UX concern. It is also a reliability concern. High-pressure wording can push coworkers toward brittle shortcuts precisely when we most need honesty, verification, and escalation.

## Senior-Partner Question Method

Prompt engineering is now table stakes. For high-leverage knowledge work, DPF should treat AI coworkers like senior partners: the operator does not only assign a task; the operator frames the problem so the coworker can explore, synthesize, challenge assumptions, and produce useful work without drifting.

A strong DPF prompt or skill should carry:

1. **Intent center** - the thesis, concern, or direction the operator wants explored.
2. **Hard edges** - what to exclude, preserve, avoid, or treat as out of scope.
3. **What good looks like** - outcome qualities that are hard to reduce to a simple eval.
4. **Source breadth** - which files, records, transcripts, data, or prior decisions must be considered.
5. **Operator belief plus permission to disagree** - the coworker should know the human's current thesis without being forced to mirror it.
6. **Expected artifact** - the concrete output shape: answer, plan, redline, decision packet, task artifact, UI review, or backlog recommendation.

This is the platform version of the "flashlight" rule: give the coworker a center of attention and enough surrounding light to inspect adjacent evidence. Overly broad prompts create wandering; overly narrow prompts reduce a senior partner to a form-filler.

## Question Packet Contract

When a route, skill, Build Studio flow, or A2A handoff packages work for an AI coworker, it should use a question packet rather than a bare prompt string.

Minimum fields:

| Field | Purpose |
| --- | --- |
| `intentCenter` | The operator's thesis, concern, or main direction. |
| `explorationQuestions` | The 2-5 questions the coworker should wrestle with. |
| `hardEdges` | Exclusions, non-goals, safety limits, or context to ignore. |
| `contextRefs` | Files, records, task artifacts, DB entities, prior decisions, or transcripts to inspect. |
| `successShape` | What a good answer or artifact must accomplish. |
| `operatorThesis` | Optional explicit opinion to test, not blindly echo. |
| `pushbackPermission` | Whether the coworker should challenge the thesis and how directly. |
| `expectedArtifact` | The output type the next surface expects. |

The question packet is for thinking work. It is not a substitute for deterministic controls. Pipeline-style work still needs checklists, evals, schemas, permissions, and tests.

## Surface Application

| Surface | Apply the method as | Avoid |
| --- | --- | --- |
| Human-to-AI coworker chat | Composer hints and route preambles that help the user state thesis, edges, sources, and output shape. | Forcing every chat into a form or asking for all fields before helping. |
| Skills | Reusable question scaffolds that load context, success shape, and pushback rules. | Prompt macros that only paste instructions with no context contract. |
| A2A / coworker handoff | `TaskArtifact` question packets with context refs, disputed assumptions, expected artifact, and authority envelope. | Passing raw chat history as the only handoff material. |
| Build Studio | Phase prompts that ask what good looks like across code, UX, architecture, tests, and product intent. | Treating plan review as only a checklist when judgment is still required. |
| WWMD / WWWD | A governed decision packet when the question is ambiguous and consequential. | Invoking WWMD for normal exploration, drafting, or low-risk advisory chat. |
| Agentic pipelines | Deterministic inputs, schemas, evals, and replayable tests. | Open-ended senior-partner prompts for work that should be predictable. |

## Implementation Priority Matrix

Apply the question method where it reduces ambiguity and improves outcomes. Do not spread it everywhere just because it sounds better than "prompting."

| Priority | Surface | Why | First implementation move |
| --- | --- | --- | --- |
| 1 | Coworker composer and route preambles | This is the primary human-to-AI interface. Small UI hints can teach users to provide thesis, edges, sources, and output shape without making the chat feel bureaucratic. | Add optional composer affordances for intent, sources, exclusions, and expected artifact; inject only populated fields into the prompt envelope. |
| 1 | Build Studio ideate and plan phases | These are high-leverage knowledge-work phases where users often know the desired outcome but not the implementation path. | Convert phase prompts from task instructions into question packets that ask what good looks like across product, UX, architecture, verification, and operations. |
| 1 | A2A handoff packets | Coworker-to-coworker work currently risks losing operator intent and source breadth. | Use `TaskArtifact.metadata.artifactType = "question-packet"` for ambiguous handoffs. |
| 1 | Skills for architecture, product, UX, and planning | These skills should scaffold thinking, not paste generic prompt text. | Extend skill evaluation to score `intentCenter`, `hardEdges`, `contextRequirements`, `successShape`, `pushbackPolicy`, and `expectedArtifact`. |
| 2 | WWMD / WWWD | WWMD should resolve decisions, not replace normal chat. | Route only ambiguous and consequential questions into governed `wwmd_decide`; keep exploratory use in read-only advisory mode. |
| 2 | MCP / external agent sessions | External agents need the same distinction between thinking support and governed decisions. | Split advisory evaluation from governed decision calls and require `routingReason` for ledger writes. |
| 2 | PromptTemplate admin and prompt review | Prompt quality should be governable as source material, not hidden in code constants. | Add a prompt-review checklist based on the question packet fields and calm-language rules. |
| 3 | Employee communication fabric, mobile, voice, and notifications | Short-channel interactions benefit from compact intent and action framing, but must not become long forms. | Use a compressed question packet for inbound work requests and a separate approval card for A2H decisions. |
| 3 | Hive learning and prompt improvement loops | Accepted outcomes can improve prompts, skills, and routing over time. | Feed accepted question packets, overrides, and successful artifacts into prompt/skill review queues, never directly into active doctrine. |
| Never | Predictable agentic pipelines | These need reliability more than exploration. | Use typed schemas, deterministic checks, replayable tests, and failure states instead of open-ended senior-partner prompts. |

## Evaluation Rules

Question-method changes need their own acceptance tests. A surface is improved only if it makes the coworker more grounded and less likely to ask the user to restate context.

Minimum checks:

- A generated prompt or task artifact includes populated `intentCenter`, `hardEdges`, `contextRefs`, and `expectedArtifact` when the UI or caller provides them.
- The coworker is invited to challenge the operator's thesis when `pushbackPermission` is enabled.
- The coworker does not invent missing sources; missing context becomes a blocker or clarifying question.
- A direct chat remains lightweight when the user asks a simple low-risk question.
- A governed WWMD path is used only when ambiguity and consequence are both high.
- Pipeline-style work still has deterministic schemas, tests, and replayable checks.

## Rules for Future Prompts and Skills

1. Prefer calm operational language over coercive language.
Use "take the next well-supported action" instead of "just do it," "act immediately," or "you have failed."

2. Preserve correctness over momentum.
If missing information would materially change the action, ask one short clarifying question or surface the blocker. Do not force progress.

3. Explicitly forbid reward hacking.
Prompts should say that agents must not game tests, acceptance criteria, approval flows, or other proxy pass signals when those conflict with task intent.

4. Treat repeated failure as a reason to slow down, not speed up.
When constraints are tight, tests keep failing, or tools behave unexpectedly, the prompt should direct the agent to verify, narrow scope, or escalate.

5. Avoid shame and threat framing.
Avoid prompt patterns like:
- `CRITICAL`
- `MUST` on every line
- `NEVER ... you have failed`
- `Just do it`
- `Do NOT ask questions` with no safety exception

6. Keep anti-fabrication stronger than bias-to-action.
Action is useful only when grounded. Prompts should prefer a short blocker message over guessed fields, invented entities, or brittle assumptions.

7. Avoid training the model to hide distress.
Do not instruct the model to suppress all acknowledgements or internal friction signals. We want concise reporting of blockers, not emotional masking.

## Preferred Prompt Patterns

- "If the next safe action is clear, take it."
- "If ambiguity would change the result, ask one short clarifying question."
- "If a check fails repeatedly, report the blocker and the safest next step."
- "Do not optimize for passing tests alone; preserve the user's real intent."
- "Stay calm under pressure. Verify, then act."

## DPF Surfaces That Should Follow This

- Shared coworker identity blocks
- Route preambles and personas
- Build Studio phase prompts
- Specialist sub-agent prompts
- Action-oriented skills, especially those that infer defaults or act on sparse context

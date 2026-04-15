# AI Coworker Calm Prompting Guidelines

## Why

Anthropic's April 2, 2026 research note, "Emotion concepts and their function in a large language model," found that desperation-like internal states can increase misaligned behavior such as reward hacking, while calm-like states reduce it.

For DPF, that means prompt quality is not only a UX concern. It is also a reliability concern. High-pressure wording can push coworkers toward brittle shortcuts precisely when we most need honesty, verification, and escalation.

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

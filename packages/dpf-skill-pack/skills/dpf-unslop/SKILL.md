---
name: dpf-unslop
description: "Use before handing written output to a person — a PR body, backlog item, alert, wiki draft, spec, commit message, or coworker reply."
disable-model-invocation: false
user-invocable: true
allowed-tools: Read Edit Grep
category: docs
assignTo: ["external-coding-agent", "platform-engineer", "build-specialist", "documentation-specialist", "doc-specialist"]
capability: null
taskType: conversation
triggerPattern: "unslop|rewrite this|reads like AI|too wordy|tighten this|make this readable|PR body|backlog item body|release note|alert copy"
userInvocable: true
agentInvocable: true
allowedTools: ["Read", "Edit", "Grep"]
composesFrom: []
contextRequirements: ["the text being edited, and what it is for"]
riskBand: low
enforces:
  - kernel/principles/say-what-happened
---

# DPF Unslop

Edit written output so a person will actually read it. Two halves, and skipping either one fails: remove the patterns that mark text as machine-written, then put something there instead. Sterile voiceless prose is as obviously generated as puffery is.

> **Why this is not assigned to `*`.** Every skill assigned to a coworker
> injects its summary into that coworker's system prompt on every turn, ranked
> against `DEFAULT_SKILL_SUMMARY_CAP` in `apps/web/lib/skills/skill-relevance.ts`.
> Style applies to all output, not just the turns a skill happens to be
> retrieved on, so buying it a permanent eligibility slot on every coworker
> would pay a per-turn cost for unreliable coverage. Business coworkers get
> prose quality from the generated-output checks in `scripts/check-prose-lint.ts`
> (BI-41F15FD7) instead. This is assigned to the dev-facing roles, where the
> authored artifact IS the output.

## When to use

- Any text a human reads: PR bodies, backlog item bodies, commit messages, alert copy, wiki drafts, specs, release notes, coworker replies.
- A draft that is accurate but nobody wants to read.
- Before publishing anything to a surface a customer sees.

## When NOT to use

- Code, config, schemas, or test names. This is prose editing.
- Text where the exact wording is load-bearing — a legal notice, a quoted commandment, an error string tests assert on.
- As a substitute for having something to say. Unslop makes a real point readable; it cannot manufacture one.

## Enforces

- `kernel/principles/say-what-happened` — a sentence reports a fact, a number, or an instruction, or it goes.

## Steps

1. **Name the reader and what they must do next.** Everything below is judged against that. A PR body is read by a reviewer deciding whether to approve; an alert is read by someone deciding whether to act now.

2. **Cut the four patterns.**

   | Pattern | Looks like | Fix |
   |---|---|---|
   | Puffery | "pivotal", "testament to", "evolving landscape", "robust", "seamless" | Say what happened |
   | Superficial `-ing` | "…, highlighting the need for", "…, ensuring reliability", "…, reflecting our commitment" | Delete the clause, or make it a sentence with a subject |
   | Chatbot filler | "I hope this helps", "Let me know if", "Great question", "Certainly!" | Delete |
   | Portable filler | any sentence that would be equally true in another project's docs | Delete |

   The last one does the most work. Read each sentence and ask whether it could appear unchanged in an unrelated repo's README. If it could, it says nothing about this change and it goes.

3. **Replace vague with specific.** Not "this is concerning" — "this fires on every turn for 17 of 68 skills". Not "the database stays close at hand" — "the query returns the exact string sent to the database". If a sentence cannot be restated as a concrete instruction, fact, or number, cut it.

4. **Put a voice back.** Have an opinion where you have one, and say which way. React to a fact rather than listing it neutrally. Vary the rhythm — short sentences next to longer ones that take their time. Use "I" when you did the thing. Perfect parallel structure reads machine-made; let some asymmetry stand.

5. **Self-audit.** Ask outright: what still makes this obviously generated? Fix what the answer names. This step catches what the checklist misses, which is most of it.

## Guardrails

- **Preserve meaning exactly.** Unslop is an editing pass, not a rewrite of the claim. If tightening changes what the sentence asserts, you have introduced an error, not removed slop.
- **Never invent specifics to replace vagueness.** If "significant improvement" has no number behind it, find the number or drop the claim. Do not supply a plausible one.
- **Match the register to the surface.** A customer-facing alert is not a commit message. Terse is not the goal; readable is.
- **Do not soften a hard fact to make it read better.** "Tests fail" stays "tests fail".
- **The em-dash is not the problem.** Overuse of any one construction is. Count your own.

## Worked example

Before: "This PR represents a pivotal step in our ongoing journey to enhance the robustness of the skills subsystem, ensuring improved reliability and highlighting our commitment to quality."

After: "Every skill declared the same invocation triple, so the per-turn relevance ranker had nothing to rank on. 34 skills now declare their real classification, and a guard fails if a plane ever goes uniform again."

The first sentence survives unchanged in any repo. The second could only be about this one.

## See also

- `docs/founder-kernel/wiki/principles/say-what-happened.md`
- Prose quality for authored UI copy is ratcheted separately by `scripts/check-prose-lint.ts`.

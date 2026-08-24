---
name: add-skill
description: "Help define and create a new `.skill.md` quick action for the current page's coworker when the user needs a repeatable, governed agent behavior."
category: universal
assignTo: ["*"]
capability: null
taskType: code_generation
triggerPattern: "add skill|new skill|create skill|custom action|add button|quick action"
userInvocable: true
agentInvocable: false
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Add a Skill

Guide the user from a vague desired quick action to a well-structured `.skill.md` file that can be seeded into `SkillDefinition` and assigned to the right coworker. A good skill is routed by description, bounded by "do not use" rules, and specific about tools and output.

Do not use this for one-off help; use the most relevant existing skill instead. Do not use this for marketplace ingestion or external tool adoption; use the governed tool evaluation path instead.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Existing skills | skills/**/*.skill.md | Naming, category, frontmatter, and body structure |
| Route context | PAGE DATA | Current route, coworker, category, and likely assignment |
| Skill seed path | packages/db/src/seed-skills.ts | Supported frontmatter fields and assignment behavior |
| DPF rules | AGENTS.md | Skills belong to coworkers, not routes; prompts live in seeded files |
| Cost model | dpf-writing-skills (dpf-platform pack) | What an assignment and a description actually cost |

## Steps

1. Ask what repeatable action the skill should perform if the user has not already said it.
2. Search existing skills for overlap before creating a new one.
3. Generate a unique kebab-case `name`, description, category, assignment, task type, trigger pattern, allowed tools, and risk band. Two rules carry most of the weight: the description's only job is to make the right coworker load the skill, so fill it with the words a caller would use and put explanation in the body; and every coworker in `assignTo` spends one of that coworker's twelve per-turn skill slots, so assign to the roles that will actually invoke it. Never use `["*"]` to avoid choosing — it charges all 31 coworkers.
4. Confirm the definition when the action could affect data, permissions, or workflow authority.
5. Create the `.skill.md` file with read-first sources, steps, output template, guidelines, and example.
6. Name any route-context or seed follow-up required for the skill to appear in the UI.

## Output Template

- Skill id: `<kebab-case name>`
- Category: `<category>`
- Assigned to: `<coworker ids>`
- Task type: `<conversation, analysis, action, code_generation>`
- Allowed tools: `<tool names or none>`
- File: `<skills/category/name.skill.md>`
- Follow-up: `<route/seed/test work, if any>`

## Guidelines

- Reject vague prompts such as "help me" and convert them into one concrete action.
- Keep one skill to one repeatable procedure.
- Include a routing boundary in the body: "Do not use this for X; use Y instead."
- Do not grant tools casually; list only tools needed for the skill.
- Keep a coworker-plane skill short and declarative — around 2 KB. These run on coworkers that may be on a local model, where a long multi-phase procedure is followed partially rather than refused.
- For a dev-agent pack skill, or any change to an existing skill's description or assignment, use `dpf-writing-skills` first: those touch a frozen byte budget and a per-turn cap that CI enforces.

## Example

Input: "Add a button that checks whether this customer account is stale."

Output: Define `customer-staleness-check`, assign it to `customer-advisor`, include read-first PAGE DATA and customer account sources, and create a structured `.skill.md` that reports stale signals and next action.

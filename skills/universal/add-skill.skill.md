---
name: add-skill
description: "Add a new skill (quick-action button) to this page's agent by creating a .skill.md file"
category: universal
assignTo: ["*"]
capability: null
taskType: code_generation
triggerPattern: "add skill|new skill|create skill|custom action|add button"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Add a Skill

Guide the user through creating a new skill for the current page's agent, then generate the skill file.

## What This Skill Does

A skill is a quick-action button in the agent panel that triggers a specific prompt. This skill walks the user through defining a new one, then creates the `.skill.md` file and registers it in the route context.

## Instructions

1. **Ask the user what the skill should do.** Prompt with:
   - "What should this skill do? Describe the action in one sentence."
   - If the user is vague, suggest 2-3 concrete options based on the current page type.

2. **Gather the skill definition:**
   - **Name**: Generate a kebab-case ID from the description (e.g., "export-to-csv")
   - **Label**: Short button text (3-5 words)
   - **Description**: One sentence explaining when to use it
   - **Task type**: `conversation`, `code_generation`, or `analysis`
   - **Prompt**: The instruction the agent receives when the skill is triggered
   - **Category**: Derive from the current route (e.g., "portfolio", "build", "admin")

3. **Confirm the definition** with the user before creating anything.

4. **Create the `.skill.md` file** using `propose_file_change`:
   - Path: `skills/<category>/<name>.skill.md`
   - Include full YAML frontmatter matching the project pattern
   - Write rich instructions below the frontmatter

5. **Update the route context** to include the new skill in the appropriate route's skill list.

## Guidelines

- Every skill needs a clear, specific prompt. Reject vague prompts like "help me" -- push the user to be concrete.
- Skill names must be unique across the entire skills directory.
- Keep prompts under 200 words. If the user describes something complex, split it into multiple skills.
- Set `riskBand` based on what the skill does: "low" for read-only, "medium" for creating/updating data, "high" for destructive actions.
- Match the frontmatter format exactly -- see existing `.skill.md` files in `skills/universal/` for reference.

## Frontmatter Template

```yaml
---
name: skill-id-here
description: "When to use this skill"
category: derived-from-route
assignTo: ["route-agent-id"]
capability: null
taskType: conversation
triggerPattern: "keyword1|keyword2"
userInvocable: true
agentInvocable: false
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---
```

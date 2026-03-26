---
name: writing-skills
description: Use when creating new skills, editing existing skills, or verifying skills work before deployment
source: superpowers v5.0.5
---

# Writing Skills

Writing skills IS Test-Driven Development applied to process documentation.

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

## The Iron Law

```
NO SKILL WITHOUT A FAILING TEST FIRST
```

## SKILL.md Structure

```markdown
---
name: Skill-Name-With-Hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview — Core principle in 1-2 sentences
## When to Use — Symptoms and use cases
## Core Pattern — Before/after comparison
## Quick Reference — Table for scanning
## Common Mistakes — What goes wrong + fixes
```

## RED-GREEN-REFACTOR for Skills

### RED: Write Failing Test (Baseline)
Run pressure scenario WITHOUT skill. Document exact agent behavior and rationalizations.

### GREEN: Write Minimal Skill
Address those specific rationalizations. Run same scenarios WITH skill — agent should comply.

### REFACTOR: Close Loopholes
New rationalization found? Add explicit counter. Re-test until bulletproof.

## Claude Search Optimization (CSO)

- Description = ONLY triggering conditions, NOT workflow summary
- Start with "Use when..."
- Include concrete triggers, symptoms, situations
- NEVER summarize the skill's process in the description

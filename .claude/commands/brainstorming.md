---
name: brainstorming
description: Use before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements and design before implementation.
source: superpowers v5.0.5
---

# Brainstorming Ideas Into Designs

Help turn ideas into fully formed designs and specs through natural collaborative dialogue.

Start by understanding the current project context, then ask questions one at a time to refine the idea. Once you understand what you're building, present the design and get user approval.

## HARD-GATE

Do NOT invoke any implementation skill, write any code, scaffold any project, or take any implementation action until you have presented a design and the user has approved it.

## Checklist

1. **Explore project context** — check files, docs, recent commits
2. **Offer visual companion** (if topic will involve visual questions)
3. **Search first** — look external for examples, practices, opensource and commercial solutions to leverage
4. **Ask clarifying questions** — one at a time, understand purpose/constraints/success criteria
5. **Propose 2-3 approaches** — with trade-offs and your recommendation
6. **Present design** — in sections scaled to their complexity, get user approval after each section
7. **Write design doc** — save to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and commit
8. **Spec review loop** — dispatch spec-document-reviewer subagent; fix issues and re-dispatch until approved (max 3 iterations)
9. **User reviews written spec** — ask user to review before proceeding
10. **Transition to implementation** — invoke writing-plans skill

## Key Principles

- **One question at a time** — Don't overwhelm with multiple questions
- **Multiple choice preferred** — Easier to answer than open-ended when possible
- **YAGNI ruthlessly** — Remove unnecessary features from all designs
- **Explore alternatives** — Always propose 2-3 approaches before settling
- **Incremental validation** — Present design, get approval before moving on
- **Research always before invent** — Don't re-invent things, research first
- **Standardize over invention** — Seek to conform to standards where possible

## Design for Isolation and Clarity

- Break the system into smaller units that each have one clear purpose
- Communicate through well-defined interfaces
- Can be understood and tested independently
- Smaller, well-bounded units are easier to work with

## After the Design

1. Write spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
2. Run spec review loop (max 3 iterations)
3. User review gate
4. Invoke writing-plans skill (the ONLY next skill)

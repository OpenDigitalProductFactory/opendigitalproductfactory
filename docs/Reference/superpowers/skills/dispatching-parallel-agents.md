---
name: dispatching-parallel-agents
description: Use when facing 2+ independent tasks that can be worked on without shared state or sequential dependencies
source: superpowers v5.0.5
---

# Dispatching Parallel Agents

When you have multiple unrelated problems, investigating them sequentially wastes time. Each investigation is independent and can happen in parallel.

**Core principle:** Dispatch one agent per independent problem domain. Let them work concurrently.

## When to Use

- 3+ problems with different root causes
- Each problem can be understood independently
- No shared state between investigations

## The Pattern

1. **Identify independent domains** — group failures by what's broken
2. **Create focused agent tasks** — specific scope, clear goal, constraints, expected output
3. **Dispatch in parallel**
4. **Review and integrate** — verify fixes don't conflict, run full test suite

## Agent Prompt Structure

Good prompts are: Focused (one problem), Self-contained (all needed context), Specific about output (what to return).

## When NOT to Use

- Failures are related (fix one might fix others)
- Need to understand full system state
- Agents would interfere (editing same files)
